import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  detectIdentifier, normalizeEvidenceEntry, normalizeTags, statusCounts, filterEvidence,
  formatEvidenceCitations, planCitationWrite, EVIDENCE_STATUSES,
  dedupeKey, findDuplicate, serializeEvidenceBackup, parseEvidenceBackup, mergeEntries,
} from '../src/lib/evidence-vault-core.js'
import { createEvidenceVaultStore } from '../src/evidence-vault-store.js'
import { installFakeIndexedDB } from './helpers/fake-indexeddb.js'

test('稳定标识符能从标题、链接与元数据里认出来', () => {
  assert.deepEqual(detectIdentifier('10.1038/s41586-021-03819-2'), { kind: 'doi', value: '10.1038/s41586-021-03819-2' })
  assert.deepEqual(detectIdentifier('https://pubmed.ncbi.nlm.nih.gov/33790466/'), { kind: 'pmid', value: '33790466' })
  assert.deepEqual(detectIdentifier('NCT04368728'), { kind: 'nct', value: 'NCT04368728' })
  assert.deepEqual(detectIdentifier('arXiv:2104.09864v1'), { kind: 'arxiv', value: '2104.09864v1' })
  // 认不出来不是失败，标记为 none 由 UI 提示缺少可追溯标识符。
  assert.deepEqual(detectIdentifier('某篇没有标识符的报道'), { kind: 'none', value: '' })
  assert.deepEqual(detectIdentifier(''), { kind: 'none', value: '' })
})

test('DOI 尾部标点被剥掉（直接拼接句子时不带入句号）', () => {
  assert.equal(detectIdentifier('见 10.1038/s41586-021-03819-2。').value, '10.1038/s41586-021-03819-2')
})

test('条目规范化：字段完整，且默认落到未核验', () => {
  const entry = normalizeEvidenceEntry({
    title: 'A single-cell atlas',
    sourceDatabase: 'PubMed',
    url: 'https://pubmed.ncbi.nlm.nih.gov/33790466/',
    project: '肿瘤队列',
    tags: '单细胞, 图谱, 单细胞',
    reason: '方法部分可复用',
    note: '需要核对批次信息',
  })
  assert.equal(entry.status, 'unverified', '保存不等于认可，新条目必须是未核验')
  assert.equal(entry.identifierKind, 'pmid')
  assert.equal(entry.identifier, '33790466')
  assert.deepEqual(entry.tags, ['单细胞', '图谱'], '标签需去重')
  assert.equal(entry.project, '肿瘤队列')
  assert.ok(entry.id && entry.savedAt)
  for (const key of ['title', 'sourceDatabase', 'identifier', 'url', 'savedAt', 'project', 'tags', 'reason', 'note', 'status']) {
    assert.ok(key in entry, `字段缺失：${key}`)
  }
})

test('无法追溯的来源不入库（缺标题 / 缺链接与标识符）', () => {
  assert.throws(() => normalizeEvidenceEntry({ url: 'https://example.org' }), /缺少标题/)
  assert.throws(() => normalizeEvidenceEntry({ title: '只有标题' }), /无法追溯/)
})

test('只接受 http(s) 链接，挡掉 javascript: 等注入', () => {
  const entry = normalizeEvidenceEntry({ title: '带危险链接', url: 'javascript:alert(1)', identifier: '10.1000/abc' })
  assert.equal(entry.url, '', '危险协议必须被清空而不是原样保存')
})

test('长文本被裁剪，守住「不收全文」的隐私边界', () => {
  const entry = normalizeEvidenceEntry({ title: 'x'.repeat(500), url: 'https://example.org/a', note: 'y'.repeat(5000) })
  assert.ok(entry.title.length <= 300)
  assert.ok(entry.note.length <= 2000, '笔记长度上限应为 2000')
})

test('筛选：按核验状态分组与关键词命中', () => {
  const rows = [
    normalizeEvidenceEntry({ title: 'alpha 队列', url: 'https://a.org/1', status: 'verified' }),
    normalizeEvidenceEntry({ title: 'beta 实验', url: 'https://b.org/2' }),
  ]
  assert.deepEqual(filterEvidence(rows, { filter: 'verified' }).map(item => item.title), ['alpha 队列'])
  assert.equal(filterEvidence(rows, { query: 'beta' }).length, 1)
  assert.equal(filterEvidence(rows, { query: '队列' }).length, 1)
  assert.equal(filterEvidence(null, {}).length, 0)
  const counts = statusCounts(rows)
  assert.equal(counts.all, 2)
  assert.equal(counts.unverified, 1)
  assert.equal(counts.verified, 1)
})

test('引用块保留来源与人工核验责任，不写成已证实结论', () => {
  const entry = normalizeEvidenceEntry({ title: '某队列研究', url: 'https://c.org/3', identifier: '10.1000/xyz' })
  const text = formatEvidenceCitations([entry])
  assert.match(text, /尚未经逐条核验/)
  assert.match(text, /不得据此直接断言结论/)
  assert.match(text, /https:\/\/c\.org\/3/)
  assert.equal(formatEvidenceCitations([]), '')
})

test('标签规范化：支持中英文分隔符与数组输入，超出上限截断', () => {
  assert.deepEqual(normalizeTags('a，b;c,d'), ['a', 'b', 'c', 'd'])
  assert.deepEqual(normalizeTags([' x ', '', 'y']), ['x', 'y'])
  assert.equal(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length, 12)
})

test('状态集合与标签一一对应（新增状态必须同步标签，否则 UI 显示 undefined）', () => {
  for (const status of EVIDENCE_STATUSES) {
    assert.ok(status.length > 0)
  }
  assert.deepEqual(EVIDENCE_STATUSES, ['unverified', 'verified', 'disputed', 'stale'])
})

test('存储：IndexedDB 不可用时降级为内存，接口保持可用', async () => {
  const store = createEvidenceVaultStore()
  const { entry } = await store.save({ title: '内存回退条目', url: 'https://d.org/4' })
  assert.equal(entry.status, 'unverified')
  const rows = await store.list()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, '内存回退条目')
  // Node 测试环境没有 indexedDB，必然走降级分支——顺带钉住「降级必须可观测」。
  assert.equal(store.isDegraded(), true)
  await store.remove(entry.id)
  assert.equal((await store.list()).length, 0)
})

test('存储：非法条目在降级模式下同样被拒（两条路径行为必须一致）', async () => {
  const store = createEvidenceVaultStore()
  await assert.rejects(() => store.save({ url: 'https://d.org/5' }), /缺少标题/)
  assert.equal((await store.list()).length, 0)
})

test('存储：list 按保存时间倒序，最近的在前', async () => {
  const store = createEvidenceVaultStore()
  await store.save({ id: 'old', title: '较早', url: 'https://d.org/6', savedAt: 1000 })
  await store.save({ id: 'new', title: '较晚', url: 'https://d.org/7', savedAt: 2000 })
  const rows = await store.list()
  assert.deepEqual(rows.map(item => item.id), ['new', 'old'])
  await store.clear()
  assert.equal((await store.list()).length, 0)
})

// ── 4b 去重 ──────────────────────────────────────────────────

test('去重键：DOI 大小写与 URL 尾斜杠归一化后视为同一条', () => {
  const a = { project: 'P', identifierKind: 'doi', identifier: '10.1038/ABC', url: '' }
  const b = { project: 'P', identifierKind: 'doi', identifier: '10.1038/abc', url: '' }
  assert.equal(dedupeKey(a), dedupeKey(b))
  // 没有标识符时退化为按链接判重，协议与 #片段不参与比较。
  const c = { project: 'P', identifier: '', url: 'https://www.example.org/a/' }
  const d = { project: 'P', identifier: '', url: 'http://example.org/a#top' }
  assert.equal(dedupeKey(c), dedupeKey(d))
})

test('去重键：项目隔离优先，同标识符跨项目不算重复', () => {
  const inA = { project: '项目A', identifierKind: 'doi', identifier: '10.1038/abc', url: '' }
  const inB = { project: '项目B', identifierKind: 'doi', identifier: '10.1038/abc', url: '' }
  assert.notEqual(dedupeKey(inA), dedupeKey(inB))
  // 既无标识符又无链接的条目不参与去重——无法判定，交给用户。
  assert.equal(dedupeKey({ project: 'P', identifier: '', url: '' }), '')
})

test('findDuplicate：同项目命中、跨项目不命中、自己不算自己的重复', () => {
  const existing = normalizeEvidenceEntry({ id: 'e1', title: '已有', url: 'https://x.org/1', identifier: '10.1000/same', project: 'P' })
  const sameProject = normalizeEvidenceEntry({ id: 'e2', title: '再来一次', url: 'https://x.org/2', identifier: '10.1000/SAME', project: 'P' })
  const otherProject = normalizeEvidenceEntry({ id: 'e3', title: '另一个项目', url: 'https://x.org/3', identifier: '10.1000/same', project: 'Q' })
  assert.equal(findDuplicate([existing], sameProject)?.id, 'e1')
  assert.equal(findDuplicate([existing], otherProject), null)
  assert.equal(findDuplicate([existing], existing), null, '更新自身不应被判为重复')
})

test('存储：重复来源默认拒绝，并可显式选择覆盖或另存', async () => {
  const store = createEvidenceVaultStore()
  const first = await store.save({ id: 'a', title: '首次', url: 'https://x.org/1', identifier: '10.1000/dup', project: 'P', note: '初始笔记' })
  assert.equal(first.duplicate, null)

  await assert.rejects(
    () => store.save({ id: 'b', title: '重复', url: 'https://x.org/2', identifier: '10.1000/dup', project: 'P' }),
    error => error.code === 'DUPLICATE' && error.duplicate.id === 'a',
  )
  assert.equal((await store.list()).length, 1, '被拒绝的重复条目不得入库')

  // 覆盖：沿用原 id 与首次保存时间，更新其余字段。
  const updated = await store.save(
    { id: 'b', title: '重复', url: 'https://x.org/2', identifier: '10.1000/dup', project: 'P', note: '新笔记' },
    { onDuplicate: 'update' },
  )
  assert.equal(updated.updated, true)
  assert.equal(updated.entry.id, 'a')
  assert.equal(updated.entry.note, '新笔记')
  assert.equal(updated.entry.savedAt, first.entry.savedAt, '覆盖不该让条目在列表里跳到最前')
  assert.equal((await store.list()).length, 1)

  // 另存：用户确有理由保留两份时不做拦截。
  const forced = await store.save(
    { id: 'c', title: '刻意另存', url: 'https://x.org/3', identifier: '10.1000/dup', project: 'P' },
    { onDuplicate: 'new' },
  )
  assert.equal(forced.updated, false)
  assert.equal((await store.list()).length, 2)
})

// ── 4b 项目隔离 ──────────────────────────────────────────────

test('存储：按项目过滤与列出项目名，未归类条目只在全量视图出现', async () => {
  const store = createEvidenceVaultStore()
  await store.save({ id: 'p1', title: '甲项目', url: 'https://x.org/p1', project: '甲' })
  await store.save({ id: 'p2', title: '乙项目', url: 'https://x.org/p2', project: '乙' })
  await store.save({ id: 'p3', title: '未归类', url: 'https://x.org/p3' })

  assert.deepEqual((await store.list({ project: '甲' })).map(item => item.id), ['p1'])
  assert.equal((await store.list()).length, 3)
  assert.equal((await store.list({ project: '' })).length, 1, "project '' 表示未归类")
  assert.deepEqual(new Set(await store.listProjects()), new Set(['甲', '乙']), '项目名需去重')
})

test('存储：按项目彻底删除不影响其他项目', async () => {
  const store = createEvidenceVaultStore()
  await store.save({ id: 'q1', title: '甲一', url: 'https://x.org/q1', project: '甲' })
  await store.save({ id: 'q2', title: '甲二', url: 'https://x.org/q2', project: '甲' })
  await store.save({ id: 'q3', title: '乙一', url: 'https://x.org/q3', project: '乙' })
  assert.equal(await store.removeByProject('甲'), 2)
  assert.deepEqual((await store.list()).map(item => item.id), ['q3'])
})

test('存储：当前项目可持久化，重建 store 后仍读得到', () => {
  const pairs = new Map()
  const had = 'localStorage' in globalThis
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => (pairs.has(key) ? pairs.get(key) : null),
    setItem: (key, value) => pairs.set(key, String(value)),
    removeItem: key => pairs.delete(key),
  }
  try {
    const first = createEvidenceVaultStore()
    assert.equal(first.getActiveProject(), '', '未设置时默认为全部项目')
    first.setActiveProject('肿瘤队列')
    // 新实例 = 新会话：能读回同一个项目才算持久化成功。
    assert.equal(createEvidenceVaultStore().getActiveProject(), '肿瘤队列')
  } finally {
    if (had) globalThis.localStorage = previous
    else delete globalThis.localStorage
  }
})

// ── 4b 持久化 ────────────────────────────────────────────────

test('存储：IndexedDB 可用时不降级，且重建 store 后数据仍在（跨刷新等价）', async () => {
  const installed = installFakeIndexedDB()
  try {
    const first = createEvidenceVaultStore()
    const { entry } = await first.save({ title: '跨刷新条目', url: 'https://x.org/keep', project: '甲', identifier: '10.1000/keep' })
    assert.equal(first.isDegraded(), false, '有可用 IndexedDB 时不该降级')

    const reopened = createEvidenceVaultStore()
    const rows = await reopened.list()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, entry.id)
    assert.equal(rows[0].project, '甲')

    await reopened.remove(entry.id)
    assert.equal((await createEvidenceVaultStore().list()).length, 0, '删除同样要落盘')
  } finally {
    installed.restore()
  }
})

test('存储：IndexedDB 可用时按项目删除同样生效（不能只在内存里删）', async () => {
  const installed = installFakeIndexedDB()
  try {
    const store = createEvidenceVaultStore()
    await store.save({ id: 'r1', title: '甲一', url: 'https://x.org/r1', project: '甲' })
    await store.save({ id: 'r2', title: '乙一', url: 'https://x.org/r2', project: '乙' })
    assert.equal(await store.removeByProject('甲'), 1)
    assert.deepEqual((await createEvidenceVaultStore().list()).map(item => item.project), ['乙'])
  } finally {
    installed.restore()
  }
})

test('存储：批量导入一次写回，之后可读到', async () => {
  const installed = installFakeIndexedDB()
  try {
    const store = createEvidenceVaultStore()
    const rows = [
      normalizeEvidenceEntry({ id: 'i1', title: '导入一', url: 'https://x.org/i1' }),
      normalizeEvidenceEntry({ id: 'i2', title: '导入二', url: 'https://x.org/i2' }),
    ]
    assert.equal(await store.importMany(rows), 2)
    assert.equal((await createEvidenceVaultStore().list()).length, 2)
    assert.equal(await store.importMany([]), 0)
  } finally {
    installed.restore()
  }
})

// ── 4b 备份导入导出 ──────────────────────────────────────────

test('备份：序列化后可原样解析回来，版本与 kind 用于挡住错文件', () => {
  const entries = [normalizeEvidenceEntry({ title: '备份条目', url: 'https://x.org/1', project: '甲' })]
  const text = serializeEvidenceBackup({ entries, project: '甲' })
  const parsed = parseEvidenceBackup(text)
  assert.equal(parsed.project, '甲')
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0].title, '备份条目')

  assert.throws(() => parseEvidenceBackup(''), /为空/)
  assert.throws(() => parseEvidenceBackup('{ not json'), /合法 JSON/)
  assert.throws(() => parseEvidenceBackup('{"kind":"something-else","version":1,"entries":[]}'), /不是研究证据库的备份/)
  assert.throws(() => parseEvidenceBackup('{"kind":"dsh-research-kit-evidence","version":99,"entries":[]}'), /高于当前支持/)
  assert.throws(() => parseEvidenceBackup('{"kind":"dsh-research-kit-evidence","version":1}'), /缺少 entries/)
})

test('备份恢复是增量合并：已有条目跳过，非法条目单独计数且不中断', () => {
  const existing = [normalizeEvidenceEntry({ id: 'k1', title: '已有', url: 'https://x.org/1', identifier: '10.1000/k1', project: 'P' })]
  const incoming = [
    { id: 'k1', title: '已有', url: 'https://x.org/1', identifier: '10.1000/k1', project: 'P' }, // 完全重复
    { id: 'k2', title: '新的', url: 'https://x.org/2', identifier: '10.1000/k2', project: 'P' },
    { id: 'k3', title: '缺来源' }, // 非法：既无链接也无标识符
  ]
  const merged = mergeEntries(existing, incoming)
  assert.equal(merged.added, 1)
  assert.equal(merged.skipped, 1)
  assert.equal(merged.invalid, 1, '一条坏数据不该让整份备份失败')
  assert.equal(merged.rows.length, 2)
})

test('备份恢复不覆盖已有笔记（恢复是补齐，不是回滚）', () => {
  const existing = [normalizeEvidenceEntry({ id: 'm1', title: '原条目', url: 'https://x.org/1', identifier: '10.1000/m1', project: 'P', note: '恢复之后写的新笔记' })]
  const incoming = [{ id: 'm1', title: '原条目', url: 'https://x.org/1', identifier: '10.1000/m1', project: 'P', note: '备份里的旧笔记' }]
  const merged = mergeEntries(existing, incoming)
  assert.equal(merged.added, 0)
  assert.equal(merged.rows[0].note, '恢复之后写的新笔记')
})

// ── 4c 勾选写入 Prompt ────────────────────────────────────────
//
// ROADMAP §4c 的验收第一条就是「未选择不注入」。这条不变式原先只存在于视图
// writeSelected 的提前 return 里，纯逻辑测试测不到「什么都没被注入」；把决策提为
// planCitationWrite 之后，它才成为一个可断言的返回值。

test('4c 未选择不注入：空选择一律不产出可注入文本', () => {
  for (const entries of [[], null, undefined, 'not-an-array', 0]) {
    const plan = planCitationWrite({ entries, canWrite: true })
    assert.equal(plan.action, 'empty', `entries=${JSON.stringify(entries)} 时不得给出写入动作`)
    assert.equal(plan.text, '', `entries=${JSON.stringify(entries)} 时不得产出可注入文本`)
    assert.match(plan.notice, /勾选/, '空选择应提示先勾选，而不是静默无反应')
  }
  // 无参调用也必须落到空选择分支，不能抛错（视图可能拿到尚未初始化的选择）。
  assert.equal(planCitationWrite().action, 'empty')
})

test('4c 宿主不支持写入时不注入，但引用块仍给出来供手工复制', () => {
  const entry = normalizeEvidenceEntry({ title: '某队列研究', url: 'https://c.org/9', identifier: '10.1000/nine' })
  const plan = planCitationWrite({ entries: [entry], canWrite: false })
  assert.equal(plan.action, 'unsupported', '宿主无 setDraft 时不得走写入动作')
  assert.match(plan.text, /https:\/\/c\.org\/9/, '降级不是丢弃：引用块仍要能被复制')
  assert.match(plan.notice, /复制/)
})

test('4c 有选择时可写入，且文本含来源与核验边界', () => {
  const rows = [
    normalizeEvidenceEntry({ title: '甲研究', url: 'https://a.org/1', identifier: '10.1000/one' }),
    normalizeEvidenceEntry({ title: '乙研究', url: 'https://b.org/2', identifier: '10.1000/two' }),
  ]
  const plan = planCitationWrite({ entries: rows, canWrite: true })
  assert.equal(plan.action, 'write', '有选择且宿主可用时必须给出写入动作')
  assert.match(plan.notice, /2 条/, '提示语要报出实际条数，便于用户核对注入了几条')
  assert.match(plan.text, /尚未经逐条核验/)
  assert.match(plan.text, /不得据此直接断言结论/)
  for (const row of rows) assert.ok(plan.text.includes(row.url), `「${row.title}」的来源链接必须出现在引用块里`)
})

test('4c 写入契约：视图经由纯逻辑决策，且 setDraft 只在 action === write 时被调用', () => {
  // 纯逻辑测试只证明决策本身对，还要钉住视图真的走了这条决策——
  // 否则把守卫从视图里删掉，上面的测试仍会全绿（同「目录与实现双向契约」那一课的教训）。
  const view = readFileSync(new URL('../src/research-evidence-vault.js', import.meta.url), 'utf8')
  assert.match(view, /planCitationWrite\(\{\s*entries:\s*selectedEntries,\s*canWrite\s*\}\)/, '视图未把写入决策交给 planCitationWrite')
  assert.match(view, /if \(writePlan\.action === 'write'\)\s*inputActions\.setDraft\(writePlan\.text\)/, "setDraft 未被 action === 'write' 守住")
  assert.match(view, /disabled:\s*!selectedEntries\.length \|\| !canWrite/, '写入按钮在未选择或宿主不支持时未禁用')
  // 视图不得绕过决策内联调用宿主写入：全文件只允许一处 setDraft(。
  assert.equal((view.match(/setDraft\(/g) || []).length, 1, '视图只应有一处 setDraft 调用，且受 action 守卫')
})

test('4c 选择基准：勾选是跨筛选状态，改筛选不撤销已选择', () => {
  // 选择集必须以 entries（全部条目）为基准，而不是 filtered（当前筛选结果）。
  // 否则用户勾选后调整筛选条件，被筛掉的条目会静默退出计数——
  // 那等于让「看见什么」悄悄改写「已选择什么」，且计数与用户认知不符。
  const view = readFileSync(new URL('../src/research-evidence-vault.js', import.meta.url), 'utf8')
  assert.match(view, /selectedEntries\s*=\s*React\.useMemo\(\(\)\s*=>\s*entries\.filter\(/, '选择集必须以全部证据条目为基准')
  assert.doesNotMatch(view, /selectedEntries\s*=\s*React\.useMemo\(\(\)\s*=>\s*filtered\.filter\(/, '选择集不得以筛选结果为基准')
})
