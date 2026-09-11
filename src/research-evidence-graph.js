import React from 'react'
import { h, C } from './theme.js'
import { Page, PageHead, Toolbar, Button, Card, EmptyState, Modal, Notice, Segmented } from './ui.js'
import {
  buildEvidenceGraph, EVIDENCE_NODE_COLORS,
  layoutEvidenceGraph, routeEvidenceEdges, evidenceNeighborhood, findEvidencePath,
  encodeGraphView, decodeGraphView, clampGraphScale,
  GRAPH_NODE_WIDTH, GRAPH_NODE_HEIGHT, GRAPH_SCALE_RANGE
} from './lib/evidence-graph-core.js'
import { createResearchSelectionStore } from './research-selection-store.js'
import { createEvidenceStore } from './evidence-store.js'
import { catalog, itemById } from './catalog.js'
import { evidenceVaultStore, subscribeEvidenceVault } from './research-evidence-vault.js'

const GRAPH_VIEW_MODES = [
  { value: 'all', label: '全部' },
  { value: 'upstream', label: '上游' },
  { value: 'downstream', label: '下游' },
  { value: 'path', label: '两点路径' }
]

// 导出物会被转发出去，读者需要先知道它含什么、不含什么。这段话同时出现在导出
// 提示弹窗与导出文件正文里——提示不是装饰，它是本能力的验收项之一。
const GRAPH_EXPORT_SCOPE = '仅含图上已显示的节点标题、来源库、稳定标识符、核验状态与关系；不含笔记、全文、检索词、附件或输入框草稿。'
const GRAPH_FRAME_HEIGHT = 520

function graphKindColor(kind) { return EVIDENCE_NODE_COLORS[kind] || C.lineStrong }

function graphEscape(value) {
  return String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
}

function graphLabel(value, max = 18) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// 导出到独立文件后 CSS 变量不再有定义，必须先把当前主题解析成真实色值，
// 否则导出物里的 fill="var(--rk-surface)" 会退化成黑块。
function readGraphTheme() {
  const fallback = { surface: '#ffffff', ink: '#17212b', line: '#b6c6d1', canvas: '#f4f7f9' }
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const style = getComputedStyle(document.documentElement)
  const read = (name, backup) => (style.getPropertyValue(name) || '').trim() || backup
  return {
    surface: read('--rk-surface', fallback.surface),
    ink: read('--rk-ink', fallback.ink),
    line: read('--rk-line-strong', fallback.line),
    canvas: read('--rk-canvas', fallback.canvas)
  }
}

function buildGraphSvgMarkup(layout, routes, theme) {
  const edges = routes.map(route => `<path d="${route.d}" fill="none" stroke="${theme.line}" stroke-width="1.5" marker-end="url(#rk-arrow)"/>`).join('\n  ')
  const nodes = layout.nodes.map(node => {
    const color = graphKindColor(node.kind)
    return `<g transform="translate(${node.x - GRAPH_NODE_WIDTH / 2},${node.y})">`
      + `<rect width="${GRAPH_NODE_WIDTH}" height="${GRAPH_NODE_HEIGHT}" rx="9" fill="${theme.surface}" stroke="${color}" stroke-width="1.5"/>`
      + `<text x="10" y="22" font-size="12" fill="${theme.ink}">${graphEscape(graphLabel(node.label))}</text>`
      + `<text x="10" y="40" font-size="10" fill="${color}">${graphEscape(node.kind)}</text></g>`
  }).join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img" aria-label="研究证据图谱">`
    + `<title>研究证据图谱</title>`
    + `<defs><marker id="rk-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="${theme.line}"/></marker></defs>`
    + `<rect width="${layout.width}" height="${layout.height}" fill="${theme.canvas}"/>`
    + `\n  ${edges}\n  ${nodes}\n</svg>`
}

function downloadGraphFile(text, type, filename) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function ResearchEvidenceGraph({ sessionId, assetProvider, embedded = false }) {
  const selection = React.useMemo(() => createResearchSelectionStore(sessionId), [sessionId])
  const evidence = React.useMemo(() => createEvidenceStore(sessionId), [sessionId])
  const [resourceIds, setResourceIds] = React.useState(() => selection.get())
  const [records, setRecords] = React.useState(() => evidence.get())
  const [assets, setAssets] = React.useState([])
  const vault = React.useMemo(() => evidenceVaultStore(), [])
  const [savedEvidence, setSavedEvidence] = React.useState([])
  const [flowing, setFlowing] = React.useState(true)
  const [view, setView] = React.useState(() => decodeGraphView(typeof window === 'undefined' ? '' : window.location.hash))
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  const [notice, setNotice] = React.useState('')
  const [exportOpen, setExportOpen] = React.useState(false)
  const frameRef = React.useRef(null)
  const dragRef = React.useRef(null)

  React.useEffect(() => selection.subscribe(setResourceIds), [selection])
  React.useEffect(() => evidence.subscribe(setRecords), [evidence])
  React.useEffect(() => { assetProvider?.list?.().then(rows => setAssets(rows || [])).catch(() => {}) }, [assetProvider])
  React.useEffect(() => assetProvider?.onChange?.(() => assetProvider.list().then(rows => setAssets(rows || [])).catch(() => {})) || undefined, [assetProvider])
  const refreshSavedEvidence = React.useCallback(() => vault.list().then(rows => setSavedEvidence(rows || [])).catch(() => setSavedEvidence([])), [vault])
  React.useEffect(() => { refreshSavedEvidence(); return subscribeEvidenceVault(refreshSavedEvidence) }, [refreshSavedEvidence])

  // 视图状态写回链接：只写焦点、范围模式、路径两端与缩放，不写任何证据内容。
  React.useEffect(() => {
    if (typeof window !== 'undefined') window.history.replaceState(null, '', encodeGraphView(view))
  }, [view])

  const applyView = React.useCallback(patch => setView(previous => ({ ...previous, ...patch })), [])
  const resources = resourceIds.map(itemById).filter(Boolean)
  const graphResources = React.useMemo(() => {
    const savedDatabases = catalog.filter(item => item.type === 'database' && savedEvidence.some(entry => entry.sourceDatabase === item.name))
    return [...new Map([...resources, ...savedDatabases].map(item => [item.id, item])).values()]
  }, [resources, savedEvidence])
  const graph = React.useMemo(() => buildEvidenceGraph({ resources: graphResources, workflows: records.workflows, queries: records.queries, plans: records.plans, assets, savedEvidence }), [graphResources, records, assets, savedEvidence])
  const layout = React.useMemo(() => layoutEvidenceGraph(graph), [graph])
  const routes = React.useMemo(() => routeEvidenceEdges(graph, layout), [graph, layout])

  const scale = view.scale
  const viewWidth = layout.width / scale
  const viewHeight = layout.height / scale

  // 平移边界：不允许把图拖出视口后找不回来。缩放系数 ≤1 时 viewBox 大于画布，
  // 上限自然收敛为 0，图居中显示。
  const clampPanFor = (next, at) => {
    const width = layout.width / at
    const height = layout.height / at
    return {
      x: Math.min(Math.max(0, layout.width - width), Math.max(0, next.x)),
      y: Math.min(Math.max(0, layout.height - height), Math.max(0, next.y))
    }
  }

  const zoomBy = factor => {
    const next = clampGraphScale(scale * factor)
    if (next === scale) return
    const centerX = pan.x + viewWidth / 2
    const centerY = pan.y + viewHeight / 2
    const ratio = next / scale
    setPan(clampPanFor({ x: centerX - (centerX - pan.x) / ratio, y: centerY - (centerY - pan.y) / ratio }, next))
    applyView({ scale: next })
  }

  const resetView = () => { setPan({ x: 0, y: 0 }); applyView({ scale: 1 }) }

  const onPointerDown = event => {
    if (event.button !== 0) return
    dragRef.current = { x: event.clientX, y: event.clientY, pan: { ...pan } }
    if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = event => {
    const drag = dragRef.current
    if (!drag) return
    const rect = frameRef.current && frameRef.current.getBoundingClientRect()
    if (!rect || !rect.width) return
    const unit = viewWidth / rect.width
    setPan(clampPanFor({ x: drag.pan.x - (event.clientX - drag.x) * unit, y: drag.pan.y - (event.clientY - drag.y) * unit }, scale))
  }
  const onPointerUp = event => {
    dragRef.current = null
    if (event.currentTarget.releasePointerCapture && event.currentTarget.hasPointerCapture && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }
  const onWheel = event => {
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15)
  }
  const onMinimapClick = event => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = ((event.clientX - rect.left) / rect.width) * layout.width
    const y = ((event.clientY - rect.top) / rect.height) * layout.height
    setPan(clampPanFor({ x: x - viewWidth / 2, y: y - viewHeight / 2 }, scale))
  }

  const activateNode = nodeId => {
    if (view.mode === 'path') {
      if (!view.from || view.to) applyView({ from: nodeId, to: '', focus: nodeId })
      else applyView({ to: nodeId })
      return
    }
    applyView({ focus: nodeId })
  }

  // highlighted 为 null 表示「全部可见」；非 null 时不在集合里的节点降透明度而
  // 不是被移除——移除会让用户失去参照物，不知道自己看到的是全图的哪一部分。
  const highlighted = React.useMemo(() => {
    if (view.mode === 'all') return null
    if (view.mode === 'path') return view.from && view.to ? new Set(findEvidencePath(graph, view.from, view.to)) : null
    if (!view.focus) return null
    return evidenceNeighborhood(graph, view.focus, view.mode)
  }, [view, graph])

  const minimapWidth = 148
  const minimapHeight = Math.max(70, Math.round((minimapWidth * layout.height) / Math.max(1, layout.width)))
  const frameHeight = Math.min(GRAPH_FRAME_HEIGHT, Math.max(320, layout.height))

  const canvas = h('svg', {
    ref: frameRef,
    viewBox: `${pan.x} ${pan.y} ${viewWidth} ${viewHeight}`,
    width: '100%',
    height: frameHeight,
    role: 'img',
    'aria-label': '研究证据图谱',
    preserveAspectRatio: 'xMidYMid meet',
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onWheel,
    style: { display: 'block', touchAction: 'none', cursor: 'grab', background: C.surfaceAlt, borderRadius: 12 }
  }, [
    ...routes.map(route => h('path', {
      key: route.key,
      className: flowing ? 'rk-graph-edge rk-graph-edge-flow' : 'rk-graph-edge',
      d: route.d,
      fill: 'none',
      stroke: C.lineStrong,
      strokeWidth: 1.5,
      markerEnd: 'url(#rk-arrow)',
      opacity: highlighted && !(highlighted.has(route.from) && highlighted.has(route.to)) ? 0.18 : 1
    })),
    h('defs', { key: 'defs' }, h('marker', { id: 'rk-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto' }, h('path', { d: 'M0,0 L0,6 L7,3 z', fill: C.lineStrong }))),
    ...layout.nodes.map(node => {
      const marked = view.focus === node.id || node.id === view.from || node.id === view.to
      const dim = highlighted ? !highlighted.has(node.id) : false
      return h('a', {
        key: node.id,
        href: '#research-evidence-graph',
        className: `rk-graph-node${marked ? ' rk-graph-node-focus' : ''}`,
        opacity: dim ? 0.25 : 1,
        'aria-label': `聚焦 ${node.label}`,
        onClick: event => { event.preventDefault(); activateNode(node.id) }
      }, h('g', { transform: `translate(${node.x - GRAPH_NODE_WIDTH / 2},${node.y})` }, [
        h('title', { key: 'accessible-title' }, `聚焦 ${node.label}`),
        h('rect', { key: 'box', width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT, rx: 9, fill: C.surface, stroke: graphKindColor(node.kind), strokeWidth: 1.5 }),
        h('text', { key: 'title', x: 10, y: 22, fill: C.ink, fontSize: 12, fontWeight: 700 }, graphLabel(node.label)),
        h('text', { key: 'kind', x: 10, y: 40, fill: graphKindColor(node.kind), fontSize: 10 }, node.kind)
      ]))
    })
  ])

  const minimap = h('div', {
    key: 'minimap',
    style: { position: 'absolute', right: 14, bottom: 14, padding: 6, border: `1px solid ${C.line}`, borderRadius: 10, background: C.surface, boxShadow: C.shadowCard }
  }, h('svg', {
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    width: minimapWidth,
    height: minimapHeight,
    role: 'img',
    'aria-label': '图谱迷你地图',
    onClick: onMinimapClick,
    style: { display: 'block', cursor: 'crosshair' }
  }, [
    h('rect', { key: 'bg', width: layout.width, height: layout.height, fill: C.surfaceAlt, rx: 6 }),
    ...layout.nodes.map(node => h('rect', {
      key: node.id,
      x: node.x - GRAPH_NODE_WIDTH / 2,
      y: node.y,
      width: GRAPH_NODE_WIDTH,
      height: GRAPH_NODE_HEIGHT,
      rx: 6,
      fill: graphKindColor(node.kind),
      opacity: highlighted && !highlighted.has(node.id) ? 0.25 : 0.75
    })),
    h('rect', { key: 'viewport', x: pan.x, y: pan.y, width: viewWidth, height: viewHeight, fill: 'none', stroke: C.accent, strokeWidth: Math.max(3, layout.width / 140) })
  ]))

  const exportGraph = format => {
    const theme = readGraphTheme()
    const svg = buildGraphSvgMarkup(layout, routes, theme)
    if (format === 'svg') downloadGraphFile(svg, 'image/svg+xml', 'research-evidence-chain.svg')
    else downloadGraphFile(`<!doctype html><meta charset="utf-8"><title>科研证据链路</title><style>body{margin:0;padding:28px;background:${theme.canvas};color:${theme.ink};font:14px system-ui}h1{font-size:17px;margin:0 0 6px}p{margin:0 0 18px;opacity:.7}</style><h1>科研证据链路</h1><p>${GRAPH_EXPORT_SCOPE}</p>${svg}`, 'text/html', 'research-evidence-chain.html')
    setExportOpen(false)
    setNotice(format === 'svg' ? '已导出 SVG 快照。' : '已导出 HTML 快照。')
  }

  const copyViewLink = () => {
    if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) return setNotice('当前环境不支持复制链接，可手动复制地址栏。')
    navigator.clipboard.writeText(window.location.href)
      .then(() => setNotice('已复制当前视图链接；链接只含焦点、范围与缩放，不含任何证据内容。'))
      .catch(() => setNotice('复制失败，可手动复制地址栏。'))
  }

  const content = [
    h(PageHead, {
      key: 'head',
      kicker: 'Research Kit',
      title: '研究证据图谱',
      lead: '连接本会话的资源、工作流和查询来源，并接入已保存证据；不显示检索词、原始文件、全文或笔记。箭头表示关系方向，流动效果只呈现已存在的关系。可缩放、拖拽与框选范围。',
      actions: [
        h(Button, { key: 'motion', variant: 'soft', onClick: () => setFlowing(value => !value) }, flowing ? '暂停链路流动' : '播放链路流动'),
        h(Button, { key: 'export', variant: 'soft', onClick: () => setExportOpen(true) }, '导出快照'),
        h(Button, { key: 'link', variant: 'ghost', onClick: copyViewLink }, '复制视图链接'),
        h(Button, { key: 'clear', variant: 'ghost', onClick: () => evidence.clear() }, '清空本会话查询记录')
      ]
    }),
    graph.nodes.length ? h(Toolbar, { key: 'summary', sticky: true }, [
      h(Segmented, { key: 'modes', value: view.mode, options: GRAPH_VIEW_MODES, onChange: mode => applyView({ mode }), ariaLabel: '图谱范围模式' }),
      h('span', { key: 'nodes', style: { color: C.muted, fontSize: 13 } }, `${graph.nodes.length} 个节点`),
      h('span', { key: 'edges', style: { color: C.muted, fontSize: 13 } }, `${graph.edges.length} 条关系`),
      h('span', { key: 'scale', style: { color: C.muted, fontSize: 13 } }, `${Math.round(scale * 100)}%`),
      h(Button, { key: 'out', size: 'sm', variant: 'soft', disabled: scale <= GRAPH_SCALE_RANGE.min, title: '缩小', onClick: () => zoomBy(1 / 1.2) }, '缩小'),
      h(Button, { key: 'in', size: 'sm', variant: 'soft', disabled: scale >= GRAPH_SCALE_RANGE.max, title: '放大', onClick: () => zoomBy(1.2) }, '放大'),
      h(Button, { key: 'reset', size: 'sm', variant: 'ghost', onClick: resetView }, '复位'),
      h('span', { key: 'hint', style: { marginLeft: 'auto', color: C.muted, fontSize: 12 } }, '按住 Ctrl / ⌘ 滚轮缩放；拖拽平移')
    ]) : null,
    notice ? h(Notice, { key: 'notice', tone: 'info', style: { margin: '0 var(--rk-gutter) 12px' } }, notice) : null,
    graph.nodes.length
      ? h(Card, { key: 'canvas', style: { margin: '18px var(--rk-gutter)', padding: 12, background: C.surfaceAlt } },
          h('div', { style: { position: 'relative' } }, [canvas, minimap]))
      : h(EmptyState, { key: 'empty', text: '尚无可绘制的证据关系', hint: '先选择资源、启动工作流、执行数据库查询或保存研究灵感资产，图谱会自动形成。' }),
    exportOpen ? h(Modal, {
      key: 'export-modal',
      title: '导出证据链路快照',
      subtitle: '导出物离线可打开；确认元数据范围后再下载。',
      onClose: () => setExportOpen(false),
      footer: [
        h(Button, { key: 'cancel', variant: 'ghost', onClick: () => setExportOpen(false) }, '取消'),
        h(Button, { key: 'svg', variant: 'soft', onClick: () => exportGraph('svg') }, '导出 SVG'),
        h(Button, { key: 'html', variant: 'primary', onClick: () => exportGraph('html') }, '导出 HTML')
      ]
    }, [
      h('p', { key: 'scope', style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: C.muted } }, GRAPH_EXPORT_SCOPE),
      h('p', { key: 'count', style: { margin: '10px 0 0', fontSize: 13 } }, `本次将导出 ${graph.nodes.length} 个节点、${graph.edges.length} 条关系。`)
    ]) : null
  ]
  return embedded ? h('div', { className: 'rk-page', style: { padding: '20px var(--rk-gutter) 48px' } }, content) : h(Page, null, content)
}

export function ResearchEvidenceGraphHost({ sessionId, embedded = false }) {
  return h(ResearchEvidenceGraph, { sessionId, assetProvider: researchAssetProvider, embedded })
}
