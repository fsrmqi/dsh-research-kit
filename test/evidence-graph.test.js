import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEvidenceGraph } from '../src/lib/evidence-graph-core.js'

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
