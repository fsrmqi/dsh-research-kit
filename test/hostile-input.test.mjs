// 敌意输入回归：这些形状**不是**假想——索引库可能被旧版本或手工编辑写坏，
// 上游公开 API 会改返回结构，备份文件可能来自别的版本，localStorage 里可能是别的东西写的。
//
// 共同约定（本次加固的验收标准）：
//   1. 一条坏记录最多少一条数据，绝不让整个面板 / 整个图谱 / 整条查询链路抛异常；
//   2. 不可用的输入要么被剔除，要么升级成**领域错误**（可以提示用户），而不是 TypeError；
//   3. 上游形状异常时，研究查询走 Agent 回退，不把上游的怪形状升级成 502 插件故障。
//
// 边界说明：这里覆盖的是**序列化数据**能携带的形状（null / 原始值 / 非数组容器）。
// 抛异常 getter 属于「同进程代码故意构造」，不属于持久化与网络数据的形状，故不在范围内。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEvidenceStore } from '../src/evidence-store.js'
import { createCatalogStorage } from '../src/catalog-storage.js'
import { filterAssets, pendingVerificationCount } from '../src/lib/vault-core.js'
import {
  normalizeEvidenceEntry, statusCounts, filterEvidence, mergeEntries, dedupeKey,
} from '../src/lib/evidence-vault-core.js'
import { buildEvidenceGraph, layoutEvidenceGraph } from '../src/lib/evidence-graph-core.js'
import { workspaceIdForProject } from '../src/lib/research-workspaces.js'
import { createEvidenceVaultStore } from '../src/evidence-vault-store.js'
import { createKnowledgeStore } from '../src/knowledge-store.js'
import { runDatabaseQuery } from '../dsh/database-query.js'
import databases from '../catalog/resources/index.js'
import { installFakeIndexedDB } from './helpers/fake-indexeddb.js'

const database = id => databases.find(item => item.id === id)
const jsonResult = value => ({ statusCode: 200, body: { kind: 'text', content: JSON.stringify(value) }, truncated: false })

// ── 1. 证据条目规范化：坏输入 → 领域错误 ─────────────────────────────────────
test('证据条目规范化：null / 原始值给出领域错误，而不是 TypeError', () => {
  for (const hostile of [null, undefined, 'not-an-object', 42, true, []]) {
    assert.throws(
      () => normalizeEvidenceEntry(hostile),
      error => error instanceof Error && !(error instanceof TypeError) && /缺少标题/.test(error.message),
      `输入 ${JSON.stringify(hostile)} 应报「缺少标题」领域错误`,
    )
  }
  // 正常输入不受影响。
  assert.equal(normalizeEvidenceEntry({ title: 'A', url: 'https://example.test/a' }).title, 'A')
})

test('证据库筛选与计数：null 元素被剔除，而不是让整库崩掉', () => {
  const valid = normalizeEvidenceEntry({ title: '有效条目', url: 'https://example.test/ok', project: 'p' })
  const rows = [null, 'nope', 7, valid]
  assert.equal(statusCounts(rows).all, 1, 'all 计数应只数合法条目')
  assert.equal(statusCounts(rows).unverified, 1)
  assert.deepEqual(filterEvidence(rows).map(item => item.title), ['有效条目'])
  assert.equal(filterEvidence(null).length, 0)
  // 排序键缺失也不是崩溃点。
  assert.equal(filterEvidence([{ id: 'x', status: 'unverified' }, null]).length, 1)
})

test('证据合并：已有的坏行不会中断恢复流程，非法新行计入 invalid', () => {
  const valid = normalizeEvidenceEntry({ title: '已有条目', url: 'https://example.test/old', project: 'p' })
  const incoming = normalizeEvidenceEntry({ title: '新增条目', url: 'https://example.test/new', project: 'p' })
  const result = mergeEntries([null, 'nope', valid], [null, undefined, incoming, valid])
  assert.equal(result.rows.length, 2, '坏行不该被写入，合法的两条应留下')
  assert.deepEqual(result.rows.map(item => item.title).sort(), ['已有条目', '新增条目'])
  assert.equal(result.invalid, 2, 'null / undefined 应计为非法，而不是抛错')
  assert.equal(result.skipped, 1, '重复条目跳过')
  assert.equal(result.added, 1)
  assert.equal(dedupeKey(null), '', '去重键对空值返回空串，表示不参与去重')
})

// ── 2. 灵感资产：列表里的坏行 ────────────────────────────────────────────────
test('灵感资产筛选与待验证计数：null 元素被剔除', () => {
  const rows = [null, 'nope', { title: '假设 A', body: '正文', verification: { status: 'pending' } }]
  assert.equal(filterAssets(rows).length, 1)
  assert.equal(filterAssets(rows, { query: '假设' }).length, 1)
  assert.equal(filterAssets(rows, { filter: 'to_verify' }).length, 1)
  assert.equal(pendingVerificationCount(rows), 1)
  assert.equal(pendingVerificationCount(null), 0)
  assert.deepEqual(filterAssets([null, 3], { query: 'x' }), [])
})

// ── 3. 会话内证据索引：外部检索结果与工作流数据 ──────────────────────────────
test('证据索引：sources / stages / resourceIds 给 null 或夹带坏行都不抛', () => {
  const store = createEvidenceStore('hostile-session')
  store.clear()
  // 整体传 null：以前在解构参数上直接抛 TypeError。
  assert.doesNotThrow(() => store.recordQuery(null))
  assert.doesNotThrow(() => store.recordWorkflow(null))
  assert.doesNotThrow(() => store.recordPlan(null))
  // 字段不是数组：以前 sources.slice 会抛。
  store.recordQuery({ databaseId: 'pubchem', sources: null })
  store.recordQuery({ databaseId: 'pubchem', sources: 'nope' })
  store.recordWorkflow({ id: 'w1', resourceIds: null })
  store.recordPlan({ workflowId: 'w1', name: '计划', stages: null })
  // 数组里夹 null / 原始值：只有合法行能进索引。
  const state = store.recordQuery({
    databaseId: 'pubchem', databaseName: 'PubChem',
    sources: [null, 'nope', 42, { id: 'CID:2244', title: 'aspirin', url: 'https://example.test/1' }],
  })
  assert.equal(state.queries[0].sources.length, 1, '坏来源必须被剔除')
  assert.equal(state.queries[0].sources[0].id, 'CID:2244')
  assert.equal(state.queries.at(-1).sources.length, 0, 'null 数组按空列表处理')

  const plan = store.recordPlan({ workflowId: 'w2', name: '计划', stages: ['查询', '筛选', null] })
  assert.deepEqual(plan.plans[0].stages.map(stage => stage.label), ['查询', '筛选', null], '字符串阶段标签保持原语义，null 包成无标签阶段')
  assert.equal(plan.plans[0].stages[1].done, false)

  // 越界与坏 stages 的切换也不该抛。
  assert.doesNotThrow(() => store.togglePlanStage('w1', 99))
  assert.doesNotThrow(() => store.togglePlanStage('missing', 0))
  const toggled = store.recordPlan({ workflowId: 'w3', name: '计划', stages: ['查询', '筛选'] })
  const before = toggled.plans.find(plan => plan.id === 'w3')
  assert.deepEqual(before.stages.map(stage => stage.label), ['查询', '筛选'])
  assert.equal(store.togglePlanStage('w3', 0).plans.find(plan => plan.id === 'w3').stages[0].done, true)
  // 阶段数与上一版不同、且新阶段标签为 undefined 时，不能拿上一版缺失的 stage 去解引用。
  assert.doesNotThrow(() => store.recordPlan({ workflowId: 'w3', name: '计划', stages: ['查询', undefined] }))
  const grown = store.recordPlan({ workflowId: 'w3', name: '计划', stages: ['查询', '筛选', undefined] })
  assert.deepEqual(grown.plans.find(plan => plan.id === 'w3').stages.map(stage => stage.done), [true, false, false])
})

// ── 4. 本地历史：localStorage 里的坏行 ───────────────────────────────────────
test('使用历史读取：坏行不进列表，getRecents 不返回非字符串 id', () => {
  const backing = new Map()
  const storage = {
    getItem: key => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: key => backing.delete(key),
  }
  backing.set('dsh-research-kit:history', JSON.stringify([null, 'nope', 7, { id: 'a', name: '甲' }, { name: '无 id' }]))
  const catalogStorage = createCatalogStorage({ storage })
  assert.deepEqual(catalogStorage.getHistory().map(row => row.id), ['a'])
  assert.deepEqual(catalogStorage.getRecents(), ['a'])
  // 坏行不能把新记录挤掉，也不能让写入抛错。
  const next = catalogStorage.recordHistory({ id: 'b', name: '乙', summary: '摘要' })
  assert.deepEqual(next.map(row => row.id), ['b', 'a'])
  // 整体不是数组时按空列表处理。
  backing.set('dsh-research-kit:history', '{"id":"a"}')
  assert.deepEqual(catalogStorage.getHistory(), [])
})

// ── 5. 证据图谱：任何输入都要能画出图 ────────────────────────────────────────
test('建图对所有参数为 null / 夹带坏行都保持 total', () => {
  const graph = buildEvidenceGraph(null)
  assert.deepEqual(graph, { nodes: [], edges: [] })
  const allNull = buildEvidenceGraph({
    resources: null, workflows: null, queries: null, assets: null, savedEvidence: null,
    plans: null, knowledge: null, assetEvidenceLinks: null, researchClaims: null,
  })
  assert.deepEqual(allNull, { nodes: [], edges: [] })
  const messy = buildEvidenceGraph({
    resources: [null, 'nope', { id: 'r1', type: 'database', name: 'PubMed' }],
    queries: [null, { id: 'q1', databaseId: 'r1', sources: null }, { id: 'q2', databaseId: 'r1', sources: [null, 'x'] }],
    plans: [null, { id: 'w1', name: '计划', stages: [null, { label: '查询', done: false }] }],
    assets: [null, { id: 'a1', title: '资产' }],
    savedEvidence: [null, { id: 'e1', title: '证据' }],
    researchClaims: [null, { id: 'c1', statement: '论断', links: [null, { evidenceId: 'e1', stance: 'supports' }] }],
    knowledge: { nodes: [null, { id: 'k1', kind: 'finding', label: '发现' }], claims: [null, { from: 'k1', to: 'e1' }] },
  })
  assert.ok(Array.isArray(messy.nodes) && Array.isArray(messy.edges), '返回图必须能交给布局')
  assert.deepEqual(messy.nodes.map(node => node.id).sort(), [
    'asset:a1', 'evidence:e1', 'k1', 'plan:w1', 'plan:w1:stage:0', 'query:q1', 'query:q2', 'research-claim:c1', 'resource:r1',
  ].sort(), '坏行被剔除，合法行照常建节点')
  // 布局对 null / 半成品图也要给结果，而不是把面板打空。
  for (const input of [null, undefined, {}, { nodes: null, edges: null }, { nodes: [null, { id: 'n', kind: 'query', column: 2 }], edges: [null] }]) {
    const layout = layoutEvidenceGraph(input)
    assert.ok(Array.isArray(layout.nodes), `布局输入 ${JSON.stringify(input)} 应返回节点数组`)
  }
})

// ── 6. 研究查询：上游形状异常 → Agent 回退，不是 502 ─────────────────────────
test('上游返回结构异常时回退给 Agent，而不是把怪形状升级成插件故障', async () => {
  const hostileBodies = [
    null, 42, 'text', [],
    { message: { items: {} } },        // Crossref 的 items 从数组变成对象
    { results: 'nope' },               // OpenAlex / GBIF 的 results 不是数组
    { resultList: { result: { a: 1 } } },
    { studies: [null, 'x'] },          // ClinicalTrials 数组里夹坏行
    { PropertyTable: { Properties: null } },
  ]
  for (const body of hostileBodies) {
    const web = { async fetch() { return jsonResult(body) } }
    const result = await runDatabaseQuery({ web, database: database('crossref'), query: 'genomics' })
    assert.equal(result.mode, 'agent-fallback', `包体 ${JSON.stringify(body)} 应走 Agent 回退`)
    assert.deepEqual(result.sources, [])
    assert.match(result.prompt, /不得编造/)
    assert.match(result.reason, /上游|检索词|直查/)
    assert.doesNotThrow(() => JSON.stringify(result), '回退结果必须可序列化发给界面')
  }
})

test('直查返回 0 条也回退（不替上游断言「没有这条记录」），关掉回退时如实返回空直查', async () => {
  const empty = { async fetch() { return jsonResult({ results: [] }) } }
  const fallback = await runDatabaseQuery({ web: empty, database: database('gbif'), query: 'lion' })
  assert.equal(fallback.mode, 'agent-fallback')
  assert.match(fallback.reason, /没有返回可解析记录/)
  const noFallback = await runDatabaseQuery({ web: empty, database: database('gbif'), query: 'lion', allowAgentFallback: false })
  assert.equal(noFallback.mode, 'direct')
  assert.deepEqual(noFallback.sources, [])
})

test('部分坏行的公开 API 响应仍能解析出合法记录', async () => {
  const web = { async fetch() { return jsonResult({ results: [null, 'x', { key: 1, scientificName: 'Panthera leo', country: 'KE' }] }) } }
  const result = await runDatabaseQuery({ web, database: database('gbif'), query: 'lion' })
  assert.equal(result.mode, 'direct')
  assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0].url, 'https://www.gbif.org/occurrence/1')
})

// ── 7. 索引库里的坏行：整条读取链路 ─────────────────────────────────────────
test('证据库读取：索引库里混入 null / 原始值时只丢坏行', async () => {
  const installed = installFakeIndexedDB()
  try {
    const store = createEvidenceVaultStore()
    await store.list() // 先连库并建表
    const rows = installed.fake._databases.get('dsh-research-kit-evidence').stores.get('evidence')
    rows.set('bad-null', null)
    rows.set('bad-string', 'nope')
    rows.set('ok', { id: 'ok', title: '有效证据', project: '肿瘤队列', savedAt: 7 })
    const list = await store.list()
    assert.deepEqual(list.map(item => item.id), ['ok'])
    assert.equal(list[0].workspaceId, workspaceIdForProject('肿瘤队列'), '合法行照常补 workspaceId')
    assert.deepEqual(await store.listProjects(), ['肿瘤队列'])
    // 项目过滤路径（走索引）同样要容忍坏行。
    assert.deepEqual((await store.list({ project: '肿瘤队列' })).map(item => item.id), ['ok'])
    assert.deepEqual(await store.list({ project: '不存在的项目' }), [])
  } finally {
    installed.restore()
  }
})

test('知识库读取：索引库里混入 null 行时排序不抛 TypeError', async () => {
  const installed = installFakeIndexedDB()
  try {
    const store = createKnowledgeStore()
    await store.listNodes()
    const nodes = installed.fake._databases.get('dsh-research-kit-knowledge').stores.get('nodes')
    nodes.set('bad-null', null)
    nodes.set('bad-primitive', 42)
    nodes.set('k2', { id: 'k2', key: 'b', kind: 'finding', label: '发现 B' })
    nodes.set('k1', { id: 'k1', key: 'a', kind: 'finding', label: '发现 A' })
    const listed = await store.listNodes()
    assert.deepEqual(listed.map(row => row.id), ['k1', 'k2'], '坏行被剔除，合法行按 key 排序')
    assert.deepEqual((await store.listNodes({ kind: 'finding' })).length, 2)
    assert.deepEqual((await store.listClaims()).map(row => row.id), [])
  } finally {
    installed.restore()
  }
})
