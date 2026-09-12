// 组装回放面板 —— 把 composeWorkflow 返回的 trace 逐段点亮，与 Prompt 文本互证。
// 设计契约见 docs-internal/research-route-visualization.md §5.5/§6。
// 动画手感对齐 archify（MIT，只借鉴机制不复制代码）：
// - 彗星流光覆盖层：跑光画在 overlay 上，原图稳定，跑完淡出（intent-trace 机制）；
// - 节点到达辉光脉冲：drop-shadow glow 一次性脉冲后落定（story-beat-node 机制）；
// - 高级缓动 cubic-bezier(0.22,1,0.36,1)；完成后 lit 连线带 ambient 缓慢流动；
// - prefers-reduced-motion 或读者切「静态」：整条点亮、序号标注、零动画声明。

import React from 'react'
import { h, C } from './theme.js'
import { buildArchifySvg, archifyApplyTemplate, archifyLayoutRow } from './lib/archify-adapter.js'

const STEP_MS = 620
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

// 主题色值烘焙：导出物里 CSS 变量不再有定义，必须解析成真实色值。
function readTheme() {
  if (typeof document === 'undefined') {
    return { ink: '#17212b', muted: '#607080', line: '#d8e1e8', teal: '#0f766e', amber: '#b45309', canvas: '#f4f7f9', surface: '#fff', tealTint: '#f1faf8', amberTint: '#fff7ed' }
  }
  const style = getComputedStyle(document.body)
  const read = name => style.getPropertyValue(name).trim()
  return {
    ink: read('--rk-ink'), muted: read('--rk-muted'), line: read('--rk-line-strong'),
    teal: read('--rk-teal'), amber: read('--rk-amber'), canvas: read('--rk-canvas'),
    surface: read('--rk-surface'), tealTint: read('--rk-teal-tint'), amberTint: read('--rk-amber-tint'),
  }
}

function prefersReduced() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// SVG 文本转义：trace 里带用户填写的参数值，进 markup 前必须转义。
function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// 每个 trace 步骤在 prompt 中的锚点（用于「动画点亮 ↔ 文本高亮」互证）。
export function traceSegments(trace, prompt) {
  const text = String(prompt || '')
  const nextOccurrence = new Map()
  const anchors = (trace || []).map(step => {
    let needle = null
    if (step.step === 'workflow') return { ...step, anchorStart: 0, anchorEnd: 0, found: true }
    if (step.step === 'guard') needle = '通用科研边界'
    else if (step.step === 'param') needle = String(step.detail || (step.empty ? `[${step.label}]` : '')).slice(0, 16)
    else needle = `【${step.label}】`
    const start = needle ? text.indexOf(needle, nextOccurrence.get(needle) || 0) : -1
    if (start >= 0) nextOccurrence.set(needle, start + needle.length)
    return { ...step, anchorStart: start, anchorEnd: start >= 0 ? start + needle.length : -1, found: start >= 0 }
  })
  const cuts = [0, ...anchors.filter(a => a.found && a.anchorEnd > 0).flatMap(a => [a.anchorStart, a.anchorEnd]).filter(cut => cut > 0 && cut < text.length).sort((a, b) => a - b)]
  const points = [...new Set(cuts)]
  const segments = []
  for (let i = 0; i < points.length; i++) {
    const end = i + 1 < points.length ? points[i + 1] : text.length
    if (end > points[i]) segments.push({ text: text.slice(points[i], end), stepIndex: anchors.findIndex(step => step.found && step.anchorStart <= points[i] && step.anchorEnd >= end && step.anchorEnd > step.anchorStart) })
  }
  return { segments, steps: anchors }
}

const STATION_GLYPH = { workflow: '▶', param: '✎', skill: '✦', database: '⛁', boundary: '⚑', guard: '⚑', step: '·', file: '▤', finding: '✳' }

export function buildReplaySvgMarkup(trace = [], theme, { lit = 0, reduced = false } = {}) {
  const gap = 40
  const W = 104, H = 54
  const width = Math.max(W + 8, trace.length * W + (trace.length - 1) * gap + 8)
  const height = 108
  const stationY = 24
  const css = reduced
    ? ''
    : `<style>
.rk-replay-link.lit { stroke: ${theme.teal}; }
.rk-replay-ambient { stroke-dasharray: 0.05 0.12; animation: rk-replay-ambient 1.5s linear infinite; }
@keyframes rk-replay-ambient { to { stroke-dashoffset: -0.34; } }
.rk-replay-comet { stroke-dasharray: 0.16 1; stroke: ${theme.teal}; stroke-width: 2.6; stroke-linecap: round;
  animation: rk-replay-comet-run ${Math.round(STEP_MS * 0.92)}ms ${EASE} forwards; }
@keyframes rk-replay-comet-run { from { stroke-dashoffset: 1.16; opacity: 0.2; } 18% { opacity: 1; } to { stroke-dashoffset: -0.16; opacity: 0; } }
.rk-replay-node.arriving rect { animation: rk-replay-beat ${Math.round(STEP_MS * 0.7)}ms ${EASE} forwards; }
@keyframes rk-replay-beat {
  0% { opacity: 0.55; stroke-width: 1.5; }
  45% { opacity: 1; stroke-width: 2.4; filter: drop-shadow(0 0 7px ${theme.teal}); }
  100% { opacity: 1; stroke-width: 2; filter: drop-shadow(0 0 3px ${theme.teal}); }
}
</style>`
  let parts = []
  let x = 4
  trace.forEach((step, i) => {
    const isBoundary = step.step === 'boundary' || step.step === 'guard'
    if (i > 0) {
      const x1 = x - gap + 6, x2 = x - 6, y1 = stationY + H / 2
      const mid = (x1 + x2) / 2
      const linkLit = lit > i
      const linkClass = linkLit ? (reduced ? 'rk-replay-link lit-static' : 'rk-replay-link lit') : 'rk-replay-link'
      const linkStroke = linkLit && reduced ? theme.teal : theme.line
      parts.push(`<path class="${linkClass}" data-step="${i}" d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y1}, ${x2} ${y1}" stroke="${linkStroke}" stroke-width="1.8" fill="none" pathLength="1"/>`)
      if (linkLit && !reduced) {
        parts.push(`<path class="rk-replay-ambient" d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y1}, ${x2} ${y1}" stroke="${theme.teal}" stroke-width="2.2" fill="none" pathLength="1" opacity="0.85"/>`)
      }
      if (lit - 1 === i && !reduced) {
        parts.push(`<path class="rk-replay-comet" data-step="${i}" d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y1}, ${x2} ${y1}" fill="none" pathLength="1"/>`)
      }
    }
    const isLit = lit > i
    const arriving = lit - 1 === i && !reduced
    const fill = isBoundary ? theme.amberTint : step.step === 'skill' || step.step === 'database' ? theme.tealTint : theme.surface
    const accent = isBoundary ? theme.amber : theme.teal
    const stroke = step.step === 'workflow' ? accent : isLit ? accent : theme.line
    const dash = step.empty ? ' stroke-dasharray="4 3"' : ''
    parts.push(`<g class="rk-replay-node${isLit ? ' lit' : ''}${arriving ? ' arriving' : ''}" data-step="${i}">`)
    parts.push(`<rect x="${x}" y="${stationY}" width="${W}" height="${H}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="${isLit ? 2 : 1.5}"${dash}/>`)
    parts.push(`<rect x="${x}" y="${stationY}" width="${W}" height="4" rx="2" fill="${accent}" opacity="${isLit ? 0.95 : 0.35}"/>`)
    parts.push(`<text x="${x + 10}" y="${stationY + 22}" font-size="10" fill="${accent}">${escapeXml(STATION_GLYPH[step.step] || '·')} ${i + 1}</text>`)
    parts.push(`<text x="${x + 10}" y="${stationY + 38}" font-size="11.5" font-weight="600" fill="${theme.ink}">${escapeXml(String(step.label).slice(0, 8))}</text>`)
    parts.push(`<text x="${x + 10}" y="${stationY + 51}" font-size="9.5" fill="${theme.muted}">${escapeXml(String(step.detail || '').slice(0, 12))}</text>`)
    if (step.empty) parts.push(`<text x="${x + W - 26}" y="${stationY + 22}" font-size="9" fill="${theme.amber}">待填</text>`)
    parts.push(`</g>`)
    x += W + gap
  })
  const current = lit > 0 && lit <= trace.length ? trace[lit - 1] : null
  const caption = current ? `${lit}/${trace.length} · ${current.label} — ${current.detail}` : ''
  const markup = `<svg class="rk-replay-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="组装回放路线">${css}<defs><clipPath id="rk-replay-clip"><rect width="${width}" height="${height}" rx="12"/></clipPath></defs><rect width="${width}" height="${height}" fill="${theme.canvas}"/><g clip-path="url(#rk-replay-clip)">${parts.join('')}</g></svg>`
  return { markup, width, height, caption }
}

export function RouteReplay({ trace, prompt }) {
  const reducedInitial = prefersReduced()
  const [still, setStill] = React.useState(reducedInitial)
  const [lit, setLit] = React.useState(0)
  const theme = readTheme()
  const total = (trace || []).length
  React.useEffect(() => { setLit(still ? total : Math.min(1, total)) }, [trace, still, total])
  React.useEffect(() => {
    if (still || lit === 0 || lit >= total) return
    const timer = setTimeout(() => setLit(current => Math.min(total, current + 1)), STEP_MS)
    return () => clearTimeout(timer)
  }, [lit, still, total])
  const play = () => { setLit(0); requestAnimationFrame(() => setLit(Math.min(1, total))) }
  const { segments } = React.useMemo(() => traceSegments(trace, prompt), [trace, prompt])
  const { markup, caption } = buildReplaySvgMarkup(trace, theme, { lit, reduced: still })
  const exportSnapshot = () => {
    const { markup: full } = buildReplaySvgMarkup(trace, theme, { lit: total, reduced: true })
    const html = `<!doctype html><meta charset="utf-8"><title>组装回放快照</title><style>body{margin:0;padding:24px;background:${theme.canvas};color:${theme.ink};font:14px system-ui}h1{font-size:16px;margin:0 0 6px}p{margin:0 0 14px;color:${theme.muted};font-size:12px}</style><h1>组装回放快照</h1><p>本快照只记录一次真实的 Prompt 组装事实（工作流、参数、附加技能、数据源边界），不表示工作流已被执行；结果需人工核验。</p>${full}`
    const blob = new Blob([html], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'route-replay-snapshot.html'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const litSet = new Set(Array.from({ length: lit }, (_, i) => i))
  return h('div', { className: 'rk-replay', style: { border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, background: C.surface, display: 'grid', gap: 10 } }, [
    h('div', { key: 'head', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, [
      h('strong', { key: 't', style: { fontSize: 13 } }, '组装回放'),
      h('span', { key: 'h', style: { fontSize: 12, color: C.muted } }, '只回放本次真实的组装事实；发送与执行由你完成，结果需人工核验。'),
      h('span', { key: 'sp', style: { flex: 1 } }),
      h('button', { key: 'popup', type: 'button', onClick: () => openReplayWindow(trace, '组装回放'), style: buttonStyle(C) }, '弹出回放窗口'),
      h('button', { key: 'mode', type: 'button', onClick: () => setStill(value => !value), style: buttonStyle(C) }, still ? '切到动画' : '切到静态'),
      !still ? h('button', { key: 'play', type: 'button', onClick: play, style: buttonStyle(C) }, '重新播放') : null,
      h('button', { key: 'export', type: 'button', onClick: exportSnapshot, style: buttonStyle(C) }, '导出快照'),
    ]),
    h('div', { key: 'svg', style: { overflowX: 'auto' }, dangerouslySetInnerHTML: { __html: markup } }),
    caption ? h('div', { key: 'caption', style: { fontSize: 12, color: C.teal, fontWeight: 600 } }, caption) : null,
    h('div', { key: 'prompt', style: { maxHeight: 200, overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' } },
      segments.map((seg, i) => h('span', {
        key: i,
        style: seg.stepIndex >= 0 && litSet.has(seg.stepIndex)
          ? { background: C.tealTint, outline: `1px solid ${C.tealLineStrong}`, borderRadius: 3 }
          : null,
      }, seg.text)),
    ),
    h('div', { key: 'legend', style: { fontSize: 11, color: C.muted } },
      `共 ${total} 站；已点亮 ${Math.min(lit, total)} 站。${still ? '静态模式。' : ''}`),
  ])
}

function buttonStyle(C) {
  return { fontSize: 12, padding: '4px 10px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, cursor: 'pointer' }
}

// 弹出回放窗口：trace → archify viewer 契约（vendored 运行时）→ 独立浏览器窗口。
// 窗口里获得完整 viewer 能力（视觉预设/章节故事/透镜/雷达/路线动画）；
// 只回放本次组装事实，不注入任何未声明的内容。
export function openReplayWindow(trace, title) {
  const template = typeof window !== 'undefined' ? window.__ARCHIFY_VIEWER_TEMPLATE__ : null
  if (!template) { alert('回放模板未就绪；请重新构建产物（npm run build）。'); return }
  const steps = (trace || [])
  const nodes = archifyLayoutRow(steps.map((step, i) => ({
    id: `s${i}`,
    kind: step.step === 'guard' ? 'boundary' : step.step === 'workflow' ? 'workflow' : step.step,
    label: step.label,
    note: step.detail,
  })), { y: 60, gap: 48 })
  const edges = []
  for (let i = 1; i < nodes.length; i++) edges.push({ id: `e${i}`, from: nodes[i - 1].id, to: nodes[i].id })
  const svg = buildArchifySvg({
    nodes, edges,
    title: title || '组装回放',
    subtitle: '本窗口只回放一次真实的 Prompt 组装事实；不表示工作流已被执行，结果需人工核验。',
    locale: 'zh-CN', preset: 'classic', animation: 'trace',
  })
  const guidedViews = nodes.length ? [{ id: 'replay', label: '组装回放路线', focus: nodes.map(n => n.id) }] : []
  const html = archifyApplyTemplate({
    template,
    title: title || '组装回放',
    subtitle: '只回放真实的组装事实；发送与执行由你完成，结果需人工核验。',
    svg,
    cards: [
      { dot: 'cyan', title: '组装事实', items: steps.map(step => `${step.label}: ${step.detail}${step.empty ? '（待填）' : ''}`) },
      { dot: 'amber', title: '使用边界', items: ['本窗口不预测执行结果', '发送后由会话 Agent 执行', '产出需人工核验后采用'] },
    ],
    locale: 'zh-CN',
    visualPreset: 'classic',
    guidedViews,
  })
  const popup = window.open('', '_blank')
  if (!popup) { alert('弹窗被浏览器拦截；请允许本站弹窗后重试。'); return }
  popup.document.write(html)
  popup.document.close()
}
