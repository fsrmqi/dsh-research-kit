import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { catalog, composeWorkflow, searchCatalog, itemById, selectedCatalogItem, databaseMetadata, recommendedWorkflowsForResources } from '../src/catalog.js'
import { validateCatalogItems, readDirectQueryIds, loadCatalogFromDisk, compareShardsWithEntries } from '../scripts/validate-catalog-lib.mjs'
import { loadCatalogEntries, readShards } from '../scripts/lib/catalog-entries.mjs'

test('目录包含三类科研资源', () => {
  assert.ok(catalog.some(item => item.type === 'workflow'))
  assert.ok(catalog.some(item => item.type === 'skill'))
  assert.ok(catalog.some(item => item.type === 'database'))
})

test('工作流替换必填参数，并拒绝缺失参数', () => {
  const workflow = catalog.find(item => item.id === 'write-introduction')
  assert.throws(() => composeWorkflow(workflow), /论文主题或研究问题/)
  const result = composeWorkflow(workflow, { topic: '单细胞转录组学' })
  assert.match(result.prompt, /单细胞转录组学/)
})

test('目录搜索覆盖名称与标签', () => {
  assert.ok(searchCatalog({ query: '统计', type: 'workflow' }).some(item => item.id === 'analysis-plan'))
})

test('筛选后不保留已被筛掉的历史选择', () => {
  const skills = searchCatalog({ type: 'skill' })
  const selected = selectedCatalogItem(skills, 'review-paper')
  assert.ok(selected)
  assert.equal(selected.type, 'skill')
  assert.equal(selected.id, skills[0].id)
  assert.equal(selectedCatalogItem([], 'review-paper'), null)
})

test('可选占位符缺失时替换为可读默认值', () => {
  const workflow = catalog.find(item => item.id === 'review-paper')
  const { prompt } = composeWorkflow(workflow, {})
  assert.ok(!prompt.includes('{focus}'))
  assert.match(prompt, /综合方式处理/)
})

test('所有 id 唯一且为 kebab-case', () => {
  const ids = catalog.map(item => item.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/)
})

test('每条公共字段完整，tags 非空', () => {
  for (const item of catalog) {
    for (const field of ['id', 'type', 'name', 'description', 'category', 'tags']) {
      assert.ok(item[field] !== undefined && item[field] !== '', `${item.id} 缺少 ${field}`)
    }
    assert.ok(Array.isArray(item.tags) && item.tags.length > 0, `${item.id} tags 为空`)
  }
})

test('工作流占位符与 Prompt 双向一致', () => {
  for (const item of catalog.filter(item => item.type === 'workflow')) {
    const declared = new Set((item.placeholders || []).map(field => field.key))
    const used = [...item.prompt.matchAll(/\{([a-zA-Z0-9_-]+)\}/g)].map(match => match[1])
    for (const key of used) assert.ok(declared.has(key), `${item.id} 的 Prompt 使用了未声明占位符 {${key}}`)
    for (const key of declared) assert.ok(used.includes(key), `${item.id} 的占位符 ${key} 未出现在 Prompt 中`)
  }
})

test('工作流 Prompt 含防编造或待核验边界', () => {
  const guard = /核验|不得编造|不编造|待核验|待补充|需作者确认|需人工|待确认|需补充|不得虚构|禁止虚构/
  for (const item of catalog.filter(item => item.type === 'workflow')) {
    // 与 validate-catalog-lib 的 GUARD 契约一致：prompt 或 limitations 任一携带边界即可
    //（predictive-model 等英文工作流把边界写在 limitations 中）。
    assert.ok(guard.test(item.prompt) || guard.test((item.limitations || []).join(' ')), `${item.id} 的 Prompt 缺少防编造边界`)
  }
})

test('skill 与 database 的 availability 合法且保守', () => {
  const legal = {
    skill: ['prompt-guidance', 'requires-host-capability'],
    database: ['reference-only', 'requires-mcp', 'available-in-plugin', 'available-in-host']
  }
  for (const item of catalog) {
    if (item.type === 'skill') {
      assert.ok(legal.skill.includes(item.availability), `${item.id} availability 非法`)
      assert.ok(item.guidance, `${item.id} 缺少 guidance`)
    }
    if (item.type === 'database') {
      assert.ok(legal.database.includes(item.availability), `${item.id} availability 非法`)
      assert.ok(item.accessNote, `${item.id} 缺少 accessNote`)
      assert.notEqual(item.availability, 'available-in-host', `${item.id} 尚未实现能力探测，不得标注 available-in-host`)
    }
  }
})

test('目录标注的「插件可直查」与实现里的适配器完全一致', () => {
  const direct = readDirectQueryIds()
  // 先锁住提取结果本身：10 条 DIRECT_ADAPTERS + PubMed 独立分支 = 11。
  // 提取正则若漂移，会先在这里失败，而不是让下面的一致性断言空转通过。
  assert.deepEqual(
    [...direct].sort(),
    ['clinicaltrials', 'crossref', 'europe-pmc', 'gbif', 'inaturalist', 'openalex', 'openfda', 'pubchem', 'pubmed', 'semantic-scholar', 'uniprot'],
    `从查询实现中提取到的直查来源不符：${direct.join(', ')}`
  )
  const declared = catalog
    .filter(item => item.type === 'database' && item.availability === 'available-in-plugin')
    .map(item => item.id)
  assert.deepEqual([...declared].sort(), [...direct].sort(), '目录标注的插件可直查来源与实现里的适配器不一致')
})

test('契约校验能抓住漏标与虚标「插件可直查」', () => {
  const base = { type: 'database', name: '演示库', description: '演示数据源', category: '文献研究', tags: ['演示'], accessNote: '演示说明。' }
  const silent = validateCatalogItems([{ ...base, id: 'pubmed', availability: 'requires-mcp' }], { directQueryIds: ['pubmed'] })
  assert.ok(silent.some(error => error.includes('已实现直查适配器')), '漏标 available-in-plugin 未被发现')
  const empty = validateCatalogItems([{ ...base, id: 'pubmed', availability: 'available-in-plugin' }], { directQueryIds: [] })
  assert.ok(empty.some(error => error.includes('没有对应的直查适配器')), '无适配器却标为可直查未被发现')
  const orphan = validateCatalogItems([{ ...base, id: 'pubmed', availability: 'available-in-plugin' }], { directQueryIds: ['missing-source'] })
  assert.ok(orphan.some(error => error.includes('不在目录中')), '适配器指向不存在的目录条目未被发现')
})

test('每个数据库均归入一个研究入口，并具备访问和引用指引', () => {
  // 「其他研究数据源」是 databaseMetadata() 的设计内兜底入口：农业/作物与生命科学等
  // 近期新增来源尚未定义专属研究入口，先经兜底组正常展示与检索（后续扩充入口组）。
  const expectedGroups = new Set(['文献与引文', '临床与公共卫生', '基因组与遗传变异', '组学与表达数据', '蛋白质、结构与通路', '化学、药物与毒理', '天文与空间科学', '生物多样性与生态', '气候、地球与环境', '地理空间与社会数据', '其他研究数据源'])
  for (const item of catalog.filter(item => item.type === 'database')) {
    const meta = databaseMetadata(item)
    assert.ok(expectedGroups.has(meta.group), `${item.id} 未进入受控研究入口`)
    assert.ok(meta.dataKind && meta.queryExample && meta.citationRule && meta.accessMode && meta.toolHint, `${item.id} 缺少数据库使用元数据`)
  }
})

test('数据库搜索覆盖研究入口与数据类型', () => {
  assert.ok(searchCatalog({ query: '蛋白注释' }).some(item => item.id === 'uniprot'))
  assert.ok(searchCatalog({ query: '临床与公共卫生' }).some(item => item.id === 'clinicaltrials'))
})

test('数据库选择能给出同领域的可启动工作流建议', () => {
  const recommendations = recommendedWorkflowsForResources(['clinvar', 'gnomad'])
  assert.ok(recommendations.some(item => item.id === 'variant-annotation'))
  assert.ok(recommendations.every(item => item.type === 'workflow'))
})

test('关联资源 ID 均真实存在', () => {
  const ids = new Set(catalog.map(item => item.id))
  for (const item of catalog) {
    for (const ref of [...(item.suggestedSkillIds || []), ...(item.suggestedDatabaseIds || [])]) {
      assert.ok(ids.has(ref), `${item.id} 关联了不存在的资源 ${ref}`)
    }
  }
})

test('目录规模达到 Phase 1 目标（12–20+ 条高质量工作流）', () => {
  const count = catalog.filter(item => item.type === 'workflow').length
  assert.ok(count >= 12, `当前仅 ${count} 条工作流`)
})

test('目录分片与聚合入口一致（防止只改产物不改源）', async () => {
  const { workflows, skills, resources } = await loadCatalogEntries()
  for (const kind of ['workflows', 'skills', 'resources']) {
    const shards = readShards(kind)
    assert.ok(shards.length > 0, `${kind} 没有任何分片`)
    for (const shard of shards) assert.ok(Array.isArray(shard.entries), `${kind}/${shard.file} 不是数组`)
  }
  assert.deepEqual(compareShardsWithEntries(loadCatalogFromDisk(), [...workflows, ...skills, ...resources]), [])
})

test('构建产物内联完整目录（分片 ↔ 入口 ↔ 产物三向断言）', async () => {
  const { workflows, skills, resources } = await loadCatalogEntries()
  const bundle = readFileSync(new URL('../ui/client.js', import.meta.url), 'utf8')
  const inline = name => {
    const match = new RegExp(`^\\s*const ${name} = (\\[.*\\])$`, 'm').exec(bundle)
    assert.ok(match, `构建产物缺少内联目录 ${name}`)
    return JSON.parse(match[1])
  }
  assert.deepEqual(inline('workflows'), workflows, '产物内联的工作流与聚合入口不一致')
  assert.deepEqual(inline('skills'), skills, '产物内联的技能与聚合入口不一致')
  assert.deepEqual(inline('resources'), resources, '产物内联的数据源与聚合入口不一致')
})

test('搜索命中新增工作流的模板正文关键词', () => {
  for (const id of ['power-analysis', 'figure-audit', 'systematic-review-protocol']) {
    assert.ok(itemById(id), `缺少工作流 ${id}`)
  }
  assert.ok(searchCatalog({ query: '样本量' }).some(item => item.id === 'power-analysis'))
})

test('每条技能带 promptFragment 与 checklist 模块', () => {
  for (const skill of catalog.filter(item => item.type === 'skill')) {
    assert.ok(skill.promptFragment && skill.promptFragment.length >= 10, `${skill.id} 缺少 promptFragment`)
    assert.ok(Array.isArray(skill.checklist) && skill.checklist.length >= 3, `${skill.id} 缺少 checklist`)
  }
})

test('composeWorkflow 附加勾选技能的指导片段', () => {
  const workflow = itemById('write-introduction')
  const without = composeWorkflow(workflow, { topic: '单细胞转录组学' })
  assert.ok(!without.prompt.includes('附加技能指导'))
  const withSkill = composeWorkflow(workflow, { topic: '单细胞转录组学' }, { extraSkillIds: ['citation-hygiene', 'scientific-writing'] })
  assert.match(withSkill.prompt, /附加技能指导/)
  assert.match(withSkill.prompt, /【引用核验】/)
  assert.match(withSkill.prompt, /【科学写作】/)
  assert.deepEqual(withSkill.attachedSkillIds, ['citation-hygiene', 'scientific-writing'])
})

test('composeWorkflow 忽略未知或非技能的附加 ID', () => {
  const workflow = itemById('write-introduction')
  const result = composeWorkflow(workflow, { topic: 'x' }, { extraSkillIds: ['不存在', 'crossref'] })
  assert.equal(result.attachedSkillIds.length, 0)
  assert.ok(!result.prompt.includes('附加指导'))
})

test('composeWorkflow 可附加数据库访问边界，但不宣称已经检索', () => {
  const workflow = itemById('write-introduction')
  const result = composeWorkflow(workflow, { topic: 'x' }, { extraDatabaseIds: ['pubmed', '不存在'] })
  assert.deepEqual(result.attachedDatabaseIds, ['pubmed'])
  assert.match(result.prompt, /研究资源提示/)
  assert.match(result.prompt, /不得声称已检索/)
})

test('技能正文可被搜索命中', () => {
  assert.ok(searchCatalog({ query: '禁止静默丢弃' }).some(item => item.id === 'data-integrity'))
  assert.ok(searchCatalog({ query: '路径依赖', type: 'skill' }).some(item => item.id === 'statistics-review'))
})

test('校验器：真实目录零错误', () => {
  assert.deepEqual(validateCatalogItems(catalog), [])
})

test('校验器：重复 ID 与非法格式被拒绝', () => {
  const item = () => ({ id: 'demo', type: 'workflow', name: '演示', description: '演示工作流', category: '研究设计', tags: ['演示'], placeholders: [], prompt: '不得编造数据。' })
  let errors = validateCatalogItems([item(), item()])
  assert.ok(errors.some(e => e.includes('id 重复')))
  errors = validateCatalogItems([{ ...item(), id: 'Bad_ID' }])
  assert.ok(errors.some(e => e.includes('kebab-case')))
})

test('校验器：占位符双向不一致与缺失边界被拒绝', () => {
  const base = { id: 'demo', type: 'workflow', name: '演示', description: '演示工作流', category: '研究设计', tags: ['演示'] }
  let errors = validateCatalogItems([{ ...base, placeholders: [{ key: 'topic', label: '主题', required: true }], prompt: '请完成任务，不得编造。' }])
  assert.ok(errors.some(e => e.includes('未出现在 Prompt 中')))
  errors = validateCatalogItems([{ ...base, placeholders: [], prompt: '请完成 {topic} 任务，不得编造。' }])
  assert.ok(errors.some(e => e.includes('未声明的占位符')))
  errors = validateCatalogItems([{ ...base, placeholders: [], prompt: '请进行全面深入的分析。' }])
  assert.ok(errors.some(e => e.includes('防编造')))
})

test('校验器：非法 availability 与悬空关联被拒绝', () => {
  const base = { id: 'demo', type: 'skill', name: '演示', description: '演示技能', category: '研究设计', tags: ['演示'], guidance: '指导', availability: 'available-in-host' }
  let errors = validateCatalogItems([base])
  assert.ok(errors.some(e => e.includes('非法 availability')))
  errors = validateCatalogItems([{ ...base, availability: 'prompt-guidance', suggestedSkillIds: ['不存在'] }])
  assert.ok(errors.some(e => e.includes('关联资源不存在')))
  errors = validateCatalogItems([{ ...base, availability: 'requires-host-capability', promptFragment: '片段内容足够长。' }])
  assert.ok(errors.some(e => e.includes('只有 prompt-guidance')))
})
