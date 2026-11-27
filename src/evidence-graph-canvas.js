import React from 'react'
import { h, C } from './theme.js'
import { GRAPH_NODE_WIDTH, GRAPH_NODE_HEIGHT } from './lib/evidence-graph-core.js'
import { graphKindColor, nodeStrokeColor, nodeStrokeDash, graphLabel } from './evidence-graph-export.js'

const GRAPH_FRAME_HEIGHT = 520

export function EvidenceGraphCanvas({
  layout, routes, view, pan, setPan, scale, clampPanFor, zoomBy,
  flowing, highlighted, onSelectNode, onDoubleClickNode,
}) {
  const frameRef = React.useRef(null)
  const dragRef = React.useRef(null)
  const cameraAnimRef = React.useRef(0)
  const viewWidth = layout.width / scale
  const viewHeight = layout.height / scale
  const renderedBoxRef = React.useRef({ x: pan.x, y: pan.y, w: viewWidth, h: viewHeight })

  // 缩放、复位或迷你地图跳转时平滑推拉镜头，拖拽或再次操作时立刻中断并从当前帧接续。
  React.useEffect(() => {
    const svg = frameRef.current
    const target = { x: pan.x, y: pan.y, w: viewWidth, h: viewHeight }
    if (cameraAnimRef.current && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(cameraAnimRef.current)
      cameraAnimRef.current = 0
    }
    const from = renderedBoxRef.current
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const delta = Math.abs(target.x - from.x) + Math.abs(target.y - from.y) + Math.abs(target.w - from.w) + Math.abs(target.h - from.h)
    if (!svg || dragRef.current || reduce || typeof requestAnimationFrame !== 'function' || delta < 0.5) {
      renderedBoxRef.current = target
      svg?.setAttribute('viewBox', `${target.x} ${target.y} ${target.w} ${target.h}`)
      return undefined
    }
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const duration = 220
    const step = now => {
      const elapsed = Math.max(0, (typeof performance !== 'undefined' ? now : Date.now()) - startTime)
      const progress = Math.min(1, elapsed / duration)
      const eased = 1 - Math.pow(1 - progress, 3.2)
      const cur = {
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        w: from.w + (target.w - from.w) * eased,
        h: from.h + (target.h - from.h) * eased,
      }
      renderedBoxRef.current = cur
      svg.setAttribute('viewBox', `${cur.x} ${cur.y} ${cur.w} ${cur.h}`)
      if (progress < 1) cameraAnimRef.current = requestAnimationFrame(step)
      else cameraAnimRef.current = 0
    }
    cameraAnimRef.current = requestAnimationFrame(step)
    return () => {
      if (cameraAnimRef.current && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(cameraAnimRef.current)
        cameraAnimRef.current = 0
      }
    }
  }, [pan.x, pan.y, viewWidth, viewHeight])

  const onPointerDown = event => {
    if (event.button !== 0) return
    if (cameraAnimRef.current && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(cameraAnimRef.current)
      cameraAnimRef.current = 0
    }
    const basePan = { x: renderedBoxRef.current.x, y: renderedBoxRef.current.y }
    dragRef.current = { x: event.clientX, y: event.clientY, pan: basePan, pending: { ...basePan }, frame: 0 }
    if (frameRef.current) frameRef.current.style.cursor = 'grabbing'
    if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = event => {
    const drag = dragRef.current
    if (!drag) return
    const rect = frameRef.current && frameRef.current.getBoundingClientRect()
    if (!rect || !rect.width) return
    const unit = viewWidth / rect.width
    drag.pending = clampPanFor({ x: drag.pan.x - (event.clientX - drag.x) * unit, y: drag.pan.y - (event.clientY - drag.y) * unit }, scale)
    const paint = () => {
      drag.frame = 0
      const next = drag.pending
      renderedBoxRef.current = { x: next.x, y: next.y, w: viewWidth, h: viewHeight }
      frameRef.current?.setAttribute('viewBox', `${next.x} ${next.y} ${viewWidth} ${viewHeight}`)
    }
    if (!drag.frame) {
      if (typeof requestAnimationFrame === 'function') drag.frame = requestAnimationFrame(paint)
      else paint()
    }
  }
  const onPointerUp = event => {
    const drag = dragRef.current
    if (drag?.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(drag.frame)
    if (drag?.pending) {
      renderedBoxRef.current = { x: drag.pending.x, y: drag.pending.y, w: viewWidth, h: viewHeight }
      setPan(drag.pending)
    }
    dragRef.current = null
    if (frameRef.current) frameRef.current.style.cursor = 'grab'
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

  const minimapWidth = 148
  const minimapHeight = Math.min(180, Math.max(70, Math.round((minimapWidth * layout.height) / Math.max(1, layout.width))))
  const frameHeight = Math.min(GRAPH_FRAME_HEIGHT, Math.max(320, layout.height))

  // 迷你地图密度模式：节点 > 50 时用聚合色块代替逐节点矩形，
  // 避免 193 个节点挤在一起变成无信息量的实心色墙。
  const nodeCount = layout.nodes.length
  const useDensityMode = nodeCount > 50
  const densityGridSize = 12
  const densityCells = React.useMemo(() => {
    if (!useDensityMode) return null
    const cellW = layout.width / densityGridSize
    const cellH = layout.height / Math.max(1, Math.ceil(densityGridSize * layout.height / layout.width))
    const grid = new Map()
    for (const node of layout.nodes) {
      const cx = Math.floor((node.x - GRAPH_NODE_WIDTH / 2) / cellW)
      const cy = Math.floor(node.y / cellH)
      const key = `${cx},${cy}`
      grid.set(key, (grid.get(key) || 0) + 1)
    }
    const maxCount = Math.max(...grid.values())
    return { cellW, cellH, grid, maxCount }
  }, [useDensityMode, layout])

  const canvas = h('svg', {
    key: 'canvas',
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
        onPointerDown: event => event.stopPropagation(),
        onClick: event => {
          event.preventDefault()
          onSelectNode(node)
        },
        onDoubleClick: event => {
          event.preventDefault()
          onDoubleClickNode(node)
        },
      }, h('g', { transform: `translate(${node.x - GRAPH_NODE_WIDTH / 2},${node.y})` }, [
        h('title', { key: 'accessible-title' }, `聚焦 ${node.label}`),
        h('rect', {
          key: 'box', width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT, rx: 9, fill: C.surface,
          stroke: nodeStrokeColor(node), strokeWidth: 1.5,
          ...(nodeStrokeDash(node) ? { strokeDasharray: nodeStrokeDash(node) } : {}),
        }),
        h('text', { key: 'title', x: 10, y: 22, fill: C.ink, fontSize: 12, fontWeight: 700 }, graphLabel(node.label)),
        h('text', { key: 'kind', x: 10, y: 40, fill: nodeStrokeColor(node), fontSize: 10 }, node.kind),
        ...(node.agentProduced ? [h('circle', { key: 'agent-badge', cx: GRAPH_NODE_WIDTH - 12, cy: 10, r: 4, fill: '#3498DB' })] : []),
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
    ...(useDensityMode && densityCells
      ? [...densityCells.grid.entries()].map(([key, count]) => {
          const [cx, cy] = key.split(',').map(Number)
          const intensity = count / densityCells.maxCount
          return h('rect', {
            key: `density-${key}`,
            x: cx * densityCells.cellW,
            y: cy * densityCells.cellH,
            width: densityCells.cellW,
            height: densityCells.cellH,
            rx: 2,
            fill: C.teal,
            opacity: 0.15 + intensity * 0.65,
          })
        })
      : layout.nodes.map(node => h('rect', {
          key: node.id,
          x: node.x - GRAPH_NODE_WIDTH / 2,
          y: node.y,
          width: GRAPH_NODE_WIDTH,
          height: GRAPH_NODE_HEIGHT,
          rx: 6,
          fill: graphKindColor(node.kind),
          opacity: highlighted && !highlighted.has(node.id) ? 0.25 : 0.75
        }))),
    h('rect', { key: 'viewport', x: pan.x, y: pan.y, width: viewWidth, height: viewHeight, fill: 'none', stroke: C.accent, strokeWidth: Math.max(3, layout.width / 140) })
  ]), useDensityMode ? h('div', {
    key: 'density-label',
    style: { position: 'absolute', bottom: 4, left: 8, fontSize: 9, color: C.muted, pointerEvents: 'none' },
  }, `${nodeCount} 节点 · 密度视图`) : null)

  return h('div', { style: { position: 'relative' } }, [canvas, minimap])
}
