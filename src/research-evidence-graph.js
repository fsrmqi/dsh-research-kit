import React from 'react'
import { h, C } from './theme.js'
import { Page, PageHead, Toolbar, Button, Card, EmptyState } from './ui.js'
import { buildEvidenceGraph, EVIDENCE_NODE_COLORS } from './lib/evidence-graph-core.js'
import { createResearchSelectionStore } from './research-selection-store.js'
import { createEvidenceStore } from './evidence-store.js'
import { itemById } from './catalog.js'

function layout(nodes) {
  const columns = { database: 0, skill: 0, workflow: 1, query: 2, 'agent-query': 2, source: 3, asset: 3 }
  const counts = {}
  return nodes.map(node => {
    const column = columns[node.kind] ?? 3
    const row = counts[column] || 0
    counts[column] = row + 1
    return { ...node, x: 70 + column * 220, y: 58 + row * 82 }
  })
}

export function ResearchEvidenceGraph({ sessionId, assetProvider, embedded = false }) {
  const selection = React.useMemo(() => createResearchSelectionStore(sessionId), [sessionId])
  const evidence = React.useMemo(() => createEvidenceStore(sessionId), [sessionId])
  const [resourceIds, setResourceIds] = React.useState(() => selection.get())
  const [records, setRecords] = React.useState(() => evidence.get())
  const [assets, setAssets] = React.useState([])
  React.useEffect(() => selection.subscribe(setResourceIds), [selection])
  React.useEffect(() => evidence.subscribe(setRecords), [evidence])
  React.useEffect(() => { assetProvider?.list?.().then(rows => setAssets(rows || [])).catch(() => {}) }, [assetProvider])
  React.useEffect(() => assetProvider?.onChange?.(() => assetProvider.list().then(rows => setAssets(rows || [])).catch(() => {})) || undefined, [assetProvider])
  const resources = resourceIds.map(itemById).filter(Boolean)
  const graph = React.useMemo(() => buildEvidenceGraph({ resources, workflows: records.workflows, queries: records.queries, assets }), [resources, records, assets])
  const positioned = React.useMemo(() => layout(graph.nodes), [graph.nodes])
  const byId = React.useMemo(() => new Map(positioned.map(node => [node.id, node])), [positioned])
  const height = Math.max(300, 110 + Math.max(0, ...positioned.map(node => node.y)))
  const canvas = h('svg', { viewBox: `0 0 760 ${height}`, width: '100%', height, role: 'img', 'aria-label': '研究证据图谱', style: { minWidth: 760, overflow: 'visible' } }, [
    ...graph.edges.map((edge, index) => { const from = byId.get(edge.from), to = byId.get(edge.to); return from && to ? h('line', { key: `e${index}`, x1: from.x + 70, y1: from.y + 18, x2: to.x - 70, y2: to.y + 18, stroke: C.lineStrong, strokeWidth: 1.5, markerEnd: 'url(#rk-arrow)' }) : null }),
    h('defs', { key: 'defs' }, h('marker', { id: 'rk-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto' }, h('path', { d: 'M0,0 L0,6 L7,3 z', fill: C.lineStrong }))),
    ...positioned.map(node => h('g', { key: node.id, transform: `translate(${node.x - 68},${node.y})` }, [
      h('rect', { key: 'box', width: 136, height: 54, rx: 9, fill: C.surface, stroke: EVIDENCE_NODE_COLORS[node.kind] || C.lineStrong, strokeWidth: 1.5 }),
      h('text', { key: 'title', x: 10, y: 22, fill: C.ink, fontSize: 12, fontWeight: 700 }, String(node.label).slice(0, 18)),
      h('text', { key: 'kind', x: 10, y: 40, fill: EVIDENCE_NODE_COLORS[node.kind] || C.muted, fontSize: 10 }, node.kind)
    ]))
  ])
  const content = [
    h(PageHead, { key: 'head', kicker: 'Research Kit', title: '研究证据图谱', lead: '连接本会话的资源选择、工作流、插件直查来源、Agent 查询任务与研究灵感资产；不保存原始文件、检索词或完整结果。', actions: [h(Button, { key: 'clear', variant: 'ghost', onClick: () => evidence.clear() }, '清空本会话查询记录')] }),
    h(Toolbar, { key: 'summary', sticky: true }, [
      h('span', { key: 'nodes', style: { color: C.muted, fontSize: 13 } }, `${graph.nodes.length} 个节点`),
      h('span', { key: 'edges', style: { color: C.muted, fontSize: 13 } }, `${graph.edges.length} 条关系`),
      h('span', { key: 'legend', style: { marginLeft: 'auto', color: C.muted, fontSize: 12 } }, '资源 → 工作流 → 查询 → 来源 / 资产')
    ]),
    graph.nodes.length ? h(Card, { key: 'canvas', style: { margin: '18px var(--rk-gutter)', overflowX: 'auto', padding: 18, background: C.surfaceAlt } }, canvas) : h(EmptyState, { key: 'empty', title: '尚无可绘制的证据关系', text: '先选择资源、启动工作流、执行数据库查询或保存研究灵感资产，图谱会自动形成。' }),
  ]
  return embedded ? h('div', { className: 'rk-page', style: { padding: '20px var(--rk-gutter) 48px' } }, content) : h(Page, null, content)
}

export function ResearchEvidenceGraphHost({ sessionId, embedded = false }) {
  return h(ResearchEvidenceGraph, { sessionId, assetProvider: researchAssetProvider, embedded })
}
