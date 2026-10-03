import test from 'node:test'
import assert from 'node:assert/strict'
import { searchCatalog, catalogMatch } from '../src/catalog.js'
import { buildEvidenceGraph } from '../src/lib/evidence-graph-core.js'
import { parseBibliography, serializeBibliography, normalizeBibliography } from '../src/lib/bibliography.js'
import { normalizeEvidenceEntry, serializeEvidenceBackup, parseEvidenceBackup } from '../src/lib/evidence-vault-core.js'
import { createEvidenceVaultStore } from '../src/evidence-vault-store.js'
import { installFakeIndexedDB } from './helpers/fake-indexeddb.js'
import { projectClaimProjection, synchronizeResearchClaims, synchronizeClaimScopes, requestResearchClaims } from '../src/lib/claim-review-client.js'

const bib = '@article{rice, title={A {Rice} study}, author={Li, Jia and Wang, Yu}, year={2024}, journal={Nature}, doi={10.9999/rice}, volume={3}, pages={12--15}}'

test('资源搜索优先名称，并保持同分结果顺序稳定', () => {
  const rows = searchCatalog({ query: '文献综述' })
  assert.ok(rows[0].name.includes('文献综述'))
  assert.ok(rows.findIndex(row => row.id === 'literature-review') < rows.findIndex(row => row.id === 'paper-structure'))
  assert.deepEqual(rows.map(row => row.id), searchCatalog({ query: '文献综述' }).map(row => row.id))
  assert.equal(catalogMatch(rows[0], '文献综述').reason, '名称匹配')
})

test('目录同义词覆盖英文综述与 RNA-seq 别名，类型过滤不丢失', () => {
  assert.ok(searchCatalog({ query: 'literature review' }).some(row => row.id === 'literature-review'))
  assert.ok(searchCatalog({ query: 'rna seq', type: 'workflow' }).some(row => /rna/i.test(row.id)))
  assert.ok(searchCatalog({ query: '转录组', type: 'skill' }).every(row => row.type === 'skill'))
})

test('图谱按 URL 和标识符取并集，同一候选只连接一次', () => {
  const graph = buildEvidenceGraph({ queries: [{ id: 'q', sources: [{ id: 'doi-1', url: 'https://a', title: 'A' }, { id: 'doi-2', url: 'https://a', title: 'B' }] }],
    savedEvidence: [{ id: 'e', identifier: 'doi-1', url: 'https://a' }] })
  const edges = graph.edges.filter(edge => edge.kind === 'saved-copy')
  assert.deepEqual(edges.map(edge => edge.to), ['source:doi-1', 'source:doi-2'])
})

test('Claim 审核状态与逐边立场保持两个独立维度', () => {
  const claim = projectClaimProjection({ id: 'c', project: 'p', state: 'verified', statement: '声明', evidence_ids: ['e'],
    links: [{ evidenceId: 'e', stance: 'refutes' }], updated_at: '2024-01-01T00:00:00Z' }, 'p')
  const graph = buildEvidenceGraph({ savedEvidence: [{ id: 'e' }], researchClaims: [claim] })
  assert.equal(graph.nodes.find(row => row.id === 'research-claim:c').state, 'verified')
  assert.ok(graph.edges.some(row => row.kind === 'refutes'))
})

test('BibTeX 嵌套大括号、作者和引用元数据可往返', () => {
  const parsed = parseBibliography(bib)
  assert.equal(parsed.warnings.length, 0)
  assert.equal(parsed.entries[0].title, 'A {Rice} study')
  assert.deepEqual(parsed.entries[0].bibliography.authors, ['Li, Jia', 'Wang, Yu'])
  assert.deepEqual(parseBibliography(serializeBibliography(parsed.entries)).entries, parsed.entries)
})

test('RIS 导入忽略摘要，支持两位作者和页码，往返保留 DOI', () => {
  const parsed = parseBibliography('TY  - JOUR\nTI  - 水稻\nAU  - 李\nAU  - 王\nPY  - 2024/01/01\nDO  - 10.9999/ris\nSP  - 12\nEP  - 19\nAB  - 不应保存的全文\nER  -\n')
  assert.equal(parsed.entries[0].bibliography.pages, '12-19')
  assert.equal(parsed.entries[0].bibliography.year, '2024')
  const restored = parseBibliography(serializeBibliography(parsed.entries, 'ris'))
  assert.deepEqual(restored.entries, parsed.entries)
  assert.ok(!JSON.stringify(parsed).includes('不应保存'))
})

test('引用导入对缺来源、重复、宏和损坏条目给出可解释反馈', () => {
  const parsed = parseBibliography(bib + '\n' + bib + '\n@article{bad,title={无来源}}\n@article{macro,title=unknown,doi={10.9/x}}')
  assert.equal(parsed.entries.length, 1)
  assert.ok(parsed.warnings.some(row => row.includes('重复')))
  assert.ok(parsed.warnings.some(row => row.includes('缺少')))
  assert.ok(parsed.warnings.some(row => row.includes('宏')))
  assert.throws(() => parseBibliography('x'.repeat(2000001)), /2 MB/)
  assert.throws(() => parseBibliography('中'.repeat(700000)), /2 MB/)
  assert.equal(parseBibliography('% 文献导出备注\n' + bib).entries.length, 1)
  assert.equal(parseBibliography('TY  - JOUR\nTI  - 不完整').entries.length, 0)
})

test('引用元数据经证据规范化与 JSON 备份保留，超长字段被约束', () => {
  const entry = normalizeEvidenceEntry(parseBibliography(bib).entries[0])
  const backup = parseEvidenceBackup(serializeEvidenceBackup({ entries: [entry] }))
  assert.deepEqual(backup.entries[0].bibliography, entry.bibliography)
  assert.equal(normalizeBibliography({ authors: Array(150).fill('A'), journal: 'x'.repeat(300) }).authors.length, 100)
  assert.equal(normalizeBibliography({ journal: 'x'.repeat(300) }).journal.length, 200)
})

for (const mode of ['memory', 'indexeddb']) test(`证据分页 ${mode}：同时间戳不重复、不丢失，隔离项目并支持筛选`, async () => {
  const fake = mode === 'indexeddb' ? installFakeIndexedDB() : null
  try {
    const store = createEvidenceVaultStore()
    for (let index = 0; index < 127; index++) await store.save({ id: `e-${String(index).padStart(3, '0')}`, title: `来源 ${index}`, url: `https://a/${index}`,
      project: index < 120 ? 'p' : 'other', savedAt: 100, status: index % 2 ? 'verified' : 'unverified' })
    let cursor = null; const rows = []
    do { const page = await store.listPage({ project: 'p', limit: 50, cursor }); rows.push(...page.rows); cursor = page.nextCursor } while (cursor)
    assert.equal(rows.length, 120); assert.equal(new Set(rows.map(row => row.id)).size, 120)
    assert.equal((await store.evidenceSummary({ project: 'p' })).all, 120)
    const first = await store.listPage({ project: 'p', limit: 10 })
    await assert.rejects(() => store.listPage({ project: 'other', cursor: first.nextCursor }), /分页条件/)
    assert.equal((await store.listPage({ project: 'p', filter: 'verified', query: '来源 1' })).rows.every(row => row.status === 'verified'), true)
    assert.equal((await store.listPage({ project: 'p', screenedIds: rows.slice(0, 110).map(row => row.id) })).rows.length, 10)
    assert.equal((await store.getMany(['e-000', 'e-119', 'missing'])).length, 2)
  } finally { fake?.restore() }
})

test('Claim 本地迁移幂等并读取多页台账，权威状态覆盖离线投影', async () => {
  const original = globalThis.fetch
  const store = createEvidenceVaultStore()
  await store.save({ id: 'e', title: '来源', url: 'https://a', project: 'p' })
  await store.saveResearchClaim({ id: 'c-local', statement: '本地声明', project: 'p', links: [{ evidenceId: 'e', stance: 'unassessed' }] })
  let imports = 0
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'POST') { imports++; assert.equal(JSON.parse(options.body).claims[0].id, 'c-local'); return { ok: true, json: async () => ({ ok: true }) } }
    const offset = new URL(url, 'https://a').searchParams.get('offset')
    return { ok: true, json: async () => ({ ok: true, claims: [{ id: offset === '0' ? 'c-local' : 'c-backend', project: 'p', statement: '声明', state: 'verified', evidence_ids: ['e'] }], next_offset: offset === '0' ? 200 : null, evidence: [] }) }
  }
  try {
    const result = await synchronizeResearchClaims(store, 'p')
    assert.equal(result.claims.length, 2); assert.equal(result.claims[0].state, 'verified')
    assert.equal((await store.listResearchClaims({ project: 'p' }))[0].reviewSource, 'file-ledger')
    await synchronizeResearchClaims(store, 'p'); assert.equal(imports, 1)
  } finally { globalThis.fetch = original }
})

test('无证据的 MCP 课题也会进入完整 Claim 图谱范围；HTTP 错误不伪造成功', async () => {
  const original = globalThis.fetch; const store = createEvidenceVaultStore()
  globalThis.fetch = async url => ({ ok: true, json: async () => String(url).includes('projects=1') ? { ok: true, projects: ['empty-project'] } : { ok: true, claims: String(url).includes('empty-project') ? [{ id: 'c', project: 'empty-project', statement: '假设', state: 'extracted', evidence_ids: [] }] : [], evidence: [] } })
  try {
    assert.equal((await synchronizeClaimScopes(store)).length, 1)
    globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: '版本冲突' }) })
    await assert.rejects(() => requestResearchClaims('p', {}), /版本冲突/)
  } finally { globalThis.fetch = original }
})

test('BibTeX 注释、宏定义与前言不会吞掉后续文献', () => {
  const parsed = parseBibliography('@comment{备注 {嵌套} 文本}\n@string{j = "Nature"}\n@preamble{"前言"}\n' + bib)
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.warnings.length, 0)
})

test('项目迁移采用文件 Claim 投影，后续同步不误阻止撤销', async () => {
  const store = createEvidenceVaultStore()
  const before = projectClaimProjection({ id: 'organize-c', project: '旧项目', state: 'verified', statement: '已核验论断', revision: 2, updated_at: '2024-01-01', evidence_ids: [] }, '旧项目')
  await store.cacheResearchClaims([before])
  const after = projectClaimProjection({ ...before, project: '新项目', workspace_id: 'workspace:new', revision: 3, updated_at: '2024-01-02' }, '新项目')
  const snapshot = await store.remapProjects([{ from: '旧项目', to: '新项目' }], { claimProjections: [after] })
  await store.cacheResearchClaims([after])
  await store.restoreProjectOrganization(snapshot)
  assert.deepEqual((await store.listResearchClaims())[0], before)
})
