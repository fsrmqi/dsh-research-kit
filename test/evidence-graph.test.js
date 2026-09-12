import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEvidenceGraph, layoutEvidenceGraph, routeEvidenceEdges,
  evidenceNeighborhood, findEvidencePath,
  encodeGraphView, decodeGraphView, clampGraphScale,
  GRAPH_SCALE_RANGE, GRAPH_NODE_WIDTH, GRAPH_NODE_HEIGHT
} from '../src/lib/evidence-graph-core.js'

test('研究证据图谱连接资源、工作流、查询来源与派生资产', () => {
  const graph = buildEvidenceGraph({
    resources: [{ id: 'pubmed', type: 'database', name: 'PubMed', description: '文献库' }],
    workflows: [{ id: 'literature-review', name: '文献综述', resourceIds: ['pubmed'], at: 1 }],
    queries: [{ id: 'q1', databaseId: 'pubmed', databaseName: 'PubMed', mode: 'direct', at: 2, sources: [{ id: '123', title: '论文 A', url: 'https://example.test/123', meta: '2026' }] }],
    assets: [{ id: 'a2', title: '结论', parentId: 'a1', relatedIds: ['a1'] }, { id: 'a1', title: '假设' }]
  })
  assert.ok(graph.nodes.some(node => node.id === 'resource:pubmed'))
  assert.ok(graph.nodes.some(node => node.id === 'source:123'))
  assert.ok(graph.edges.some(edge => edge.from === 'workflow:literature-review' && edge.to === 'resource:pubmed' && edge.kind === 'uses'))
  assert.ok(graph.edges.some(edge => edge.from === 'query:q1' && edge.to === 'source:123' && edge.kind === 'returns'))
  assert.ok(graph.edges.some(edge => edge.from === 'asset:a2' && edge.to === 'asset:a1' && edge.kind === 'derives'))
})

test('证据图谱不包含检索词或资产正文', () => {
  const graph = buildEvidenceGraph({ queries: [{ id: 'q', databaseId: 'pubmed', databaseName: 'PubMed', query: '敏感检索词', sources: [] }], assets: [{ id: 'a', title: '安全标题', body: '不应进入图谱的正文' }] })
  const serialized = JSON.stringify(graph)
  assert.ok(!serialized.includes('敏感检索词'))
  assert.ok(!serialized.includes('不应进入图谱的正文'))
})

test('已保存证据按来源库和查询来源接入图谱，且不暴露笔记', () => {
  const graph = buildEvidenceGraph({
    resources: [{ id: 'pubmed', type: 'database', name: 'PubMed' }],
    queries: [{ id: 'q', databaseId: 'pubmed', databaseName: 'PubMed', sources: [{ id: '42', title: '论文', url: 'https://example.test/42' }] }],
    savedEvidence: [{ id: 'ev1', title: '已保存论文', sourceDatabase: 'PubMed', identifier: '42', url: 'https://example.test/42', status: 'unverified', note: '不应进入图谱' }],
  })
  assert.ok(graph.nodes.some(node => node.id === 'evidence:ev1' && node.kind === 'evidence'))
  assert.ok(graph.edges.some(edge => edge.from === 'evidence:ev1' && edge.to === 'resource:pubmed' && edge.kind === 'saved-from'))
  assert.ok(graph.edges.some(edge => edge.from === 'evidence:ev1' && edge.to === 'source:42' && edge.kind === 'saved-copy'))
  assert.ok(!JSON.stringify(graph).includes('不应进入图谱'))
})

// ── 布局：确定性 + 稳定性 ─────────────────────────────────────────────────────
const sampleGraph = () => buildEvidenceGraph({
  resources: [{ id: 'pubmed', type: 'database', name: 'PubMed' }, { id: 'crossref', type: 'database', name: 'Crossref' }],
  workflows: [{ id: 'lit', name: '文献综述', resourceIds: ['pubmed'] }],
  queries: [{ id: 'q1', databaseId: 'pubmed', databaseName: 'PubMed', sources: [{ id: 's1', title: '来源一', url: 'https://example.test/1' }] }],
  assets: [{ id: 'a1', title: '假设' }],
  savedEvidence: [{ id: 'ev1', title: '已保存', sourceDatabase: 'PubMed', identifier: '42', url: 'https://example.test/1', status: 'unverified' }]
})

test('布局是确定性的：同一份图重复布局结果完全相等', () => {
  const graph = sampleGraph()
  assert.deepEqual(layoutEvidenceGraph(graph), layoutEvidenceGraph(graph))
})

test('布局是稳定的：新增节点不让已有节点跳位', () => {
  const graph = sampleGraph()
  const before = layoutEvidenceGraph(graph)
  const after = layoutEvidenceGraph({ nodes: [...graph.nodes, { id: 'evidence:zzz', kind: 'evidence', label: '新证据' }], edges: graph.edges })
  const positionOf = layout => new Map(layout.nodes.map(node => [node.id, `${node.x},${node.y}`]))
  const previous = positionOf(before)
  for (const node of after.nodes) {
    if (node.id === 'evidence:zzz') continue
    assert.equal(previous.get(node.id), `${node.x},${node.y}`, `${node.id} 位置不应变化`)
  }
})

test('布局按 kind 分列：资源在最左列，已保存证据在最右列', () => {
  const layout = layoutEvidenceGraph(sampleGraph())
  const byId = new Map(layout.nodes.map(node => [node.id, node]))
  assert.ok(byId.get('resource:pubmed').x < byId.get('workflow:lit').x, '资源应在工作流左侧')
  assert.ok(byId.get('workflow:lit').x < byId.get('query:q1').x, '工作流应在查询左侧')
  assert.ok(byId.get('query:q1').x < byId.get('evidence:ev1').x, '查询应在已保存证据左侧')
  assert.ok(layout.width > 0 && layout.height > 0, '布局应给出非零画布尺寸')
})

test('布局同列按 id 字典序，不沿用输入顺序', () => {
  const layout = layoutEvidenceGraph({ nodes: [{ id: 'resource:zzz', kind: 'database', label: 'Z' }, { id: 'resource:aaa', kind: 'database', label: 'A' }], edges: [] })
  const first = layout.nodes.find(node => node.id === 'resource:aaa')
  const second = layout.nodes.find(node => node.id === 'resource:zzz')
  assert.ok(first.y < second.y, '字典序在前的节点应排在上方')
})

// ── 端口路由 ──────────────────────────────────────────────────────────────────
test('同源多条边使用不同端口，不在节点边缘重叠', () => {
  const graph = { nodes: [{ id: 'a', kind: 'workflow' }, { id: 'b', kind: 'database' }, { id: 'c', kind: 'database' }], edges: [{ from: 'a', to: 'b', kind: 'uses' }, { from: 'a', to: 'c', kind: 'uses' }] }
  const routes = routeEvidenceEdges(graph, layoutEvidenceGraph(graph))
  assert.equal(routes.length, 2)
  assert.notEqual(routes[0].y1, routes[1].y1, '同源出端口 y 必须不同')
})

test('端点落在节点边缘且路径是可绘制的三次贝塞尔', () => {
  const graph = { nodes: [{ id: 'a', kind: 'workflow' }, { id: 'b', kind: 'database' }], edges: [{ from: 'a', to: 'b', kind: 'uses' }] }
  const layout = layoutEvidenceGraph(graph)
  const byId = new Map(layout.nodes.map(node => [node.id, node]))
  const [route] = routeEvidenceEdges(graph, layout)
  assert.equal(route.forward, false, '工作流列在资源列右侧，故为逆向边')
  assert.equal(route.x1, byId.get('a').x - GRAPH_NODE_WIDTH / 2)
  assert.equal(route.x2, byId.get('b').x + GRAPH_NODE_WIDTH / 2)
  assert.match(route.d, /^M[\d.]+,[\d.]+ C/)
})

test('路由是确定性的：重复调用结果一致', () => {
  const graph = sampleGraph()
  const layout = layoutEvidenceGraph(graph)
  assert.deepEqual(routeEvidenceEdges(graph, layout), routeEvidenceEdges(graph, layout))
})

// ── 邻域与路径 ────────────────────────────────────────────────────────────────
test('上下游邻域沿箭头方向取可达集，且含起点自身', () => {
  const graph = { nodes: [], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'x', to: 'b' }] }
  const downstream = evidenceNeighborhood(graph, 'a', 'downstream')
  assert.deepEqual([...downstream].sort(), ['a', 'b', 'c'])
  const upstream = evidenceNeighborhood(graph, 'b', 'upstream')
  assert.deepEqual([...upstream].sort(), ['a', 'b', 'x'])
  assert.deepEqual([...evidenceNeighborhood(graph, 'c', 'downstream')], ['c'])
})

test('两点路径忽略箭头方向，且无路径时返回空数组', () => {
  const graph = { nodes: [], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] }
  assert.deepEqual(findEvidencePath(graph, 'a', 'c'), ['a', 'b', 'c'])
  assert.deepEqual(findEvidencePath(graph, 'c', 'a'), ['c', 'b', 'a'], '逆向两点之间也应给出路径')
  assert.deepEqual(findEvidencePath(graph, 'a', 'a'), ['a'])
  assert.deepEqual(findEvidencePath(graph, 'a', 'isolated'), [])
})

// ── URL 视图状态 ──────────────────────────────────────────────────────────────
test('视图状态可往返编解码，且只含视图参数', () => {
  const encoded = encodeGraphView({ focus: 'evidence:ev1', mode: 'path', from: 'query:q1', to: 'evidence:ev1', scale: 1.5 })
  const decoded = decodeGraphView(encoded)
  assert.equal(decoded.focus, 'evidence:ev1')
  assert.equal(decoded.mode, 'path')
  assert.equal(decoded.from, 'query:q1')
  assert.equal(decoded.to, 'evidence:ev1')
  assert.equal(decoded.scale, 1.5)
  assert.ok(!encoded.includes('已保存'), '链接不得编码任何证据内容')
})

test('默认值不写进链接，非法模式与越界缩放被收敛', () => {
  assert.equal(encodeGraphView({}), '#research-evidence-graph')
  assert.equal(encodeGraphView({ scale: 1 }), '#research-evidence-graph')
  assert.equal(decodeGraphView('#research-evidence-graph').mode, 'all')
  assert.equal(decodeGraphView('#research-evidence-graph&mode=evil').mode, 'all')
  assert.equal(clampGraphScale(99), GRAPH_SCALE_RANGE.max)
  assert.equal(clampGraphScale(0.01), GRAPH_SCALE_RANGE.min)
  assert.equal(clampGraphScale('abc'), 1)
  assert.equal(decodeGraphView('#research-evidence-graph&scale=99').scale, GRAPH_SCALE_RANGE.max)
})

test('路径模式才编码两端，其它模式不带 from/to', () => {
  const encoded = encodeGraphView({ mode: 'upstream', from: 'query:q1', to: 'evidence:ev1' })
  assert.ok(!encoded.includes('from='), '非路径模式不应带上路径端点')
  assert.ok(encoded.includes('mode=upstream'))
})

test('节点高度常量与端口计算基准一致', () => {
  assert.equal(GRAPH_NODE_HEIGHT, 54)
  assert.equal(GRAPH_NODE_WIDTH, 136)
})

// ── 导出脱敏（源码接线断言） ──────────────────────────────────────────────────
// 导出物只允许消费「图上已显示的布局与路由」，绝不能回读证据库原文或笔记。
// 纯逻辑层已断言图谱本身不含笔记，这里钉住导出没有另开一条读原文的路径。
test('导出只消费图上已显示的布局与路由，不读取证据原文', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/research-evidence-graph.js', import.meta.url), 'utf8')
  const start = source.indexOf('function buildGraphSvgMarkup')
  const end = source.indexOf('function downloadGraphFile')
  assert.ok(start > 0 && end > start, '未能定位导出构建函数')
  const body = source.slice(start, end)
  assert.ok(body.includes('layout.nodes'), '导出应遍历布局节点')
  assert.ok(body.includes('routes'), '导出应遍历已解析路由')
  assert.ok(!/savedEvidence|\.note\b|entry\./.test(body), '导出不得读取证据库原文或笔记')
})

// ── 自动沉淀知识接入 ──────────────────────────────────────────────────────────
test('知识图谱：节点、关系、来源消息与证据支持边接入图谱', () => {
  const graph = buildEvidenceGraph({
    savedEvidence: [{ id: 'ev1', title: '已保存论文', sourceDatabase: '会话回答', identifier: '10.1038/x', status: 'unverified' }],
    knowledge: {
      nodes: [
        { id: 'kn-gene', kind: 'entity', entityKind: 'gene', label: 'Ghd7', status: 'to_verify', sources: [{ sessionId: 's1', seq: 3, at: 1000 }] },
        { id: 'kn-trait', kind: 'entity', entityKind: 'trait', label: '耐盐性', status: 'to_verify', sources: [] },
        { id: 'kn-finding', kind: 'finding', label: 'Ghd7 可能影响耐盐性', status: 'to_verify', evidenceIds: ['ev1'] },
      ],
      claims: [
        { id: 'kc1', from: 'kn-gene', to: 'kn-trait', relation: 'may-affect', polarity: 'uncertain' },
        { id: 'kc2', from: 'kn-finding', to: 'kn-gene', relation: 'about', polarity: 'neutral' },
      ],
    },
  })
  assert.ok(graph.nodes.some(node => node.id === 'kn-gene' && node.kind === 'entity'))
  assert.ok(graph.nodes.some(node => node.id === 'message:s1:3' && node.kind === 'message'), '来源消息应成为图谱节点')
  assert.ok(graph.edges.some(edge => edge.from === 'message:s1:3' && edge.to === 'kn-gene' && edge.kind === 'records'))
  assert.ok(graph.edges.some(edge => edge.from === 'kn-gene' && edge.to === 'kn-trait' && edge.kind === 'may-affect'))
  assert.ok(graph.edges.some(edge => edge.from === 'evidence:ev1' && edge.to === 'kn-finding' && edge.kind === 'supports'))
  const layout = layoutEvidenceGraph(graph)
  const byId = new Map(layout.nodes.map(node => [node.id, node]))
  assert.ok(byId.get('message:s1:3').x < byId.get('kn-finding').x, '来源消息应在发现节点左侧')
  // 端点缺失的关系必须被剔除，不允许悬挂
  const dangling = buildEvidenceGraph({ knowledge: { nodes: [], claims: [{ id: 'kc', from: 'kn-a', to: 'kn-b', relation: 'relates' }] } })
  assert.equal(dangling.edges.length, 0)
})

test('知识节点的图数据不含来源摘录（导出物脱敏的前提）', () => {
  const graph = buildEvidenceGraph({
    knowledge: { nodes: [{ id: 'kn-x', kind: 'finding', label: '结论', status: 'to_verify', sources: [{ sessionId: 's', seq: 1, excerpt: '不应进入图数据的摘录' }] }], claims: [] },
  })
  assert.ok(!JSON.stringify(graph).includes('不应进入图数据'), '来源摘录不得进入图数据')
})
