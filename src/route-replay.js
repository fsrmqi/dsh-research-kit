// 组装回放面板 —— 把 composeWorkflow 返回的 trace 逐段点亮，与 Prompt 文本互证。
// 设计契约见 docs-internal/research-route-visualization.md §5.5/§6：
// - 动画只回放已发生的组装事实（trace 每条都能在 prompt 里找到，测试强制）；
// - 步进靠 CSS 动画 onAnimationEnd 链式推进（参考 archify：CSS keyframes + pathLength=1）；
// - prefers-reduced-motion 或读者切「静态」时整条路线直接点亮、按序号标注；
// - 导出物主题色值烘焙（同证据图导出），不含播放运行时。

import { h, C } from './theme.js'

const STEP_MS = 620

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

// 每个 trace 步骤在 prompt 中的锚点（用于「动画点亮 ↔ 文本高亮」互证）。
// 返回 segments: [{ text, stepIndex | -1 }]，steps: [{ anchorStart, anchorEnd, found }]
export function traceSegments(trace, prompt) {
  const text = String(prompt || '')
  const anchors = (trace || []).map(step => {
    let needle = null
    if (step.step === 'workflow') return { ...step, anchorStart: 0, anchorEnd: 0, found: true }
    if (step.step === 'guard') needle = '通用科研边界'
    else if (step.step === 'param') needle = step.empty ? `[${step.label}]` : String(step.detail || '').slice(0, 16)
    else needle = `【${step.label}】`
    const start = needle ? text.indexOf(needle) : -1
    return { ...step, anchorStart: start, anchorEnd: start >= 0 ? start + needle.length : -1, found: start >= 0 }
  })
  const cuts = [0, ...anchors.filter(a => a.found && a.anchorEnd > 0).flatMap(a => [a.anchorStart, a.anchorEnd]).filter(cut => cut > 0 && cut < text.length).sort((a, b) => a - b)]
  const points = [...new Set(cuts)]
  const segments = []
  for (let i = 0; i < points.length; i++) {
    const end = i + 1 < points.length ? points[i + 1] : text.length
    if (end > points[i]) segments.push({ text: text.slice(points[i], end), stepIndex: -1 })
  }
  anchors.forEach((step, index) => {
    if (!step.found) return
    const target = segments.find(seg => seg.text.length && seg.text.includes(text.slice(step.anchorStart, step.anchorEnd).slice(0, Math.min(16, step.anchorEnd - step.anchorStart)) || step.detail))
    if (target) target.stepIndex = index
  })
  return { segments, steps: anchors }
}

function stationSize(step) {
  if (step.step === 'boundary') return [104, 46]
  return [96, 46]
}

// SVG 文本转义：trace 里带用户填写的参数值，进 markup 前必须转义。
function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildReplaySvgMarkup(trace, theme, { lit = 0, reduced = false } = {}) {
  const gap = 34
  const sizes = trace.map(stationSize)
  const width = trace.reduce((sum, _, i) => sum + sizes[i][0], 0) + gap * (trace.length - 1) + 8
  const height = 96
  const stationY = 26
  let parts = []
  let x = 4
  trace.forEach((step, i) => {
    const [w] = sizes[i]
    if (i > 0) {
      const fromEnd = x - gap + 4
      const litClass = lit > i ? (reduced ? 'rk-replay-link lit-static' : 'rk-replay-link lit') : ''
      parts.push(`<line class="${litClass}" data-step="${i}" x1="${fromEnd}" y1="${stationY + 23}" x2="${x - 4}" y2="${stationY + 23}" stroke="${theme.line}" stroke-width="1.8" pathLength="1"/>`)
    }
    const isBoundary = step.step === 'boundary' || step.step === 'guard'
    const isLit = lit > i
    const fill = isBoundary ? theme.amberTint : step.step === 'skill' || step.step === 'database' ? theme.tealTint : theme.surface
    const stroke = isBoundary ? theme.amber : step.step === 'workflow' ? theme.teal : isLit ? theme.teal : theme.line
    const dash = step.empty ? ` stroke-dasharray="4 3"` : ''
    parts.push(`<g class="rk-replay-node${isLit ? ' lit' : ''}" data-step="${i}">`)
    parts.push(`<rect x="${x}" y="${stationY}" width="${w}" height="46" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${isLit ? 2 : 1.5}"${dash}/>`)
    const labelLines = [String(step.label).slice(0, 8), String(step.detail || '').slice(0, 10)]
    parts.push(`<text x="${x + 8}" y="${stationY + 19}" font-size="11" font-weight="600" fill="${theme.ink}">${escapeXml(labelLines[0])}</text>`)
    parts.push(`<text x="${x + 8}" y="${stationY + 35}" font-size="10" fill="${theme.muted}">${escapeXml(labelLines[1])}</text>`)
    parts.push(`<text x="${x + w - 14}" y="${stationY + 15}" font-size="9" fill="${theme.muted}">${i + 1}</text>`)
    parts.push(`</g>`)
    x += w + gap
  })
  const style = reduced
    ? ''
    : `<style>
.rk-replay-link.lit { stroke: ${theme.teal}; stroke-dasharray: 1; animation: rk-replay-draw ${STEP_MS}ms linear forwards; }
@keyframes rk-replay-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
.rk-replay-link.lit-static { stroke: ${theme.teal}; }
.rk-replay-node.lit rect { stroke-width: 2; }
</style>`
  return { markup: `<svg class="rk-replay-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="组装回放路线">${style}<rect width="${width}" height="${height}" fill="${theme.canvas}"/>${parts.join('')}</svg>`, width, height }
}

export function RouteReplay({ trace, prompt }) {
  const reducedInitial = prefersReduced()
  const [still, setStill] = React.useState(reducedInitial)
  const [lit, setLit] = React.useState(0)
  const theme = readTheme()
  const total = (trace || []).length
  React.useEffect(() => { setLit(still || reducedInitial ? total : 0) }, [trace, still])
  const play = () => { setLit(1) }
  const { segments, steps } = React.useMemo(() => traceSegments(trace, prompt), [trace, prompt])
  const { markup } = buildReplaySvgMarkup(trace, theme, { lit, reduced: still })
  const advance = event => {
    const done = Number(event.target?.dataset?.step || 0)
    setLit(current => Math.max(current, done + 2))
  }
  const exportSnapshot = () => {
    const { markup: full } = buildReplaySvgMarkup(trace, theme, { lit: total, reduced: true })
    const html = `<!doctype html><meta charset="utf-8"><title>组装回放快照</title><style>body{margin:0;padding:24px;background:${theme.canvas};color:${theme.ink};font:14px system-ui}h1{font-size:16px;margin:0 0 6px}p{margin:0 0 14px;color:${theme.muted};font-size:12px}</style><h1>组装回放快照</h1><p>本快照只记录一次真实的 Prompt 组装事实（工作流、参数、附加技能、数据源边界），不表示工作流已被执行；结果需人工核验。</p>${full}`
    const blob = new Blob([html], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'route-replay-snapshot.html'
    a.click()
  }
  const litSet = new Set(Array.from({ length: lit }, (_, i) => i))
  return h('div', { className: 'rk-replay', style: { border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, background: C.surface, display: 'grid', gap: 10 } }, [
    h('div', { key: 'head', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, [
      h('strong', { key: 't', style: { fontSize: 13 } }, '组装回放'),
      h('span', { key: 'h', style: { fontSize: 12, color: C.muted } }, '只回放本次真实的组装事实；发送与执行由你完成，结果需人工核验。'),
      h('span', { key: 'sp', style: { flex: 1 } }),
      h('button', { key: 'mode', type: 'button', onClick: () => setStill(value => !value), style: buttonStyle(C) }, still ? '切到动画' : '切到静态'),
      !still ? h('button', { key: 'play', type: 'button', onClick: play, style: buttonStyle(C) }, '重新播放') : null,
      h('button', { key: 'export', type: 'button', onClick: exportSnapshot, style: buttonStyle(C) }, '导出快照'),
    ]),
    h('div', { key: 'svg', style: { overflowX: 'auto' }, dangerouslySetInnerHTML: { __html: markup } }),
    h('div', { key: 'prompt', style: { maxHeight: 200, overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' } },
      segments.map((seg, i) => h('span', {
        key: i,
        style: seg.stepIndex >= 0 && litSet.has(seg.stepIndex)
          ? { background: C.tealTint, outline: `1px solid ${C.tealLineStrong}`, borderRadius: 3 }
          : null,
      }, seg.text)),
    ),
    h('div', { key: 'legend', style: { fontSize: 11, color: C.muted } },
      `共 ${total} 站；已点亮 ${Math.min(lit, total)} 站。${steps.some(s => !s.found) ? '（部分步骤未在文本中定位到锚点，仅路线点亮）' : ''}`),
  ])
}

function buttonStyle(C) {
  return { fontSize: 12, padding: '4px 10px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, cursor: 'pointer' }
}
