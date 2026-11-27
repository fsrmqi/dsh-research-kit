import { C } from './theme.js'
import {
  EVIDENCE_NODE_COLORS, GRAPH_NODE_WIDTH, GRAPH_NODE_HEIGHT,
} from './lib/evidence-graph-core.js'
import { downloadText } from './lib/download.js'

export const GRAPH_EXPORT_SCOPE = '仅含图上已显示的节点标题、来源库、稳定标识符、核验状态与关系；不含笔记、全文、检索词、附件或输入框草稿。'

export function graphKindColor(kind) { return EVIDENCE_NODE_COLORS[kind] || C.lineStrong }

const GRADE_NODE_COLORS = { empirical: '#27AE60', inference: '#F39C12', missing: '#E74C3C' }
const GRADE_STROKE_DASH = { inference: '4,2', missing: '2,2' }

export function nodeStrokeColor(node) {
  if (node.kind === 'evidence' && node.grade && GRADE_NODE_COLORS[node.grade]) return GRADE_NODE_COLORS[node.grade]
  return graphKindColor(node.kind)
}

export function nodeStrokeDash(node) {
  if (node.kind === 'evidence' && node.grade && GRADE_STROKE_DASH[node.grade]) return GRADE_STROKE_DASH[node.grade]
  return null
}

function graphEscape(value) {
  return String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
}

export function graphLabel(value, max = 18) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// 导出到独立文件后 CSS 变量不再有定义，必须先把当前主题解析成真实色值，
// 否则导出物里的 fill="var(--rk-surface)" 会退化成黑块。
export function readGraphTheme() {
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

export function buildGraphSvgMarkup(layout, routes, theme) {
  const edges = routes.map(route => `<path d="${route.d}" fill="none" stroke="${theme.line}" stroke-width="1.5" marker-end="url(#rk-arrow)"/>`).join('\n  ')
  const nodes = layout.nodes.map(node => {
    const color = nodeStrokeColor(node)
    const dash = nodeStrokeDash(node)
    const agentBadge = node.agentProduced ? `<circle cx="${GRAPH_NODE_WIDTH - 12}" cy="10" r="4" fill="#3498DB"/>` : ''
    return `<g transform="translate(${node.x - GRAPH_NODE_WIDTH / 2},${node.y})">`
      + `<rect width="${GRAPH_NODE_WIDTH}" height="${GRAPH_NODE_HEIGHT}" rx="9" fill="${theme.surface}" stroke="${color}" stroke-width="1.5"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
      + `<text x="10" y="22" font-size="12" fill="${theme.ink}">${graphEscape(graphLabel(node.label))}</text>`
      + `<text x="10" y="40" font-size="10" fill="${color}">${graphEscape(node.kind)}</text>`
      + agentBadge + `</g>`
  }).join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img" aria-label="研究证据图谱">`
    + `<title>研究证据图谱</title>`
    + `<defs><marker id="rk-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="${theme.line}"/></marker></defs>`
    + `<rect width="${layout.width}" height="${layout.height}" fill="${theme.canvas}"/>`
    + `\n  ${edges}\n  ${nodes}\n</svg>`
}

export function downloadGraphFile(text, type, filename) {
  return downloadText(text, type, filename)
}

export function exportEvidenceGraphFile(format, layout, routes) {
  const theme = readGraphTheme()
  const svg = buildGraphSvgMarkup(layout, routes, theme)
  if (format === 'svg') downloadGraphFile(svg, 'image/svg+xml', 'research-evidence-chain.svg')
  else downloadGraphFile(`<!doctype html><meta charset="utf-8"><title>科研证据链路</title><style>body{margin:0;padding:28px;background:${theme.canvas};color:${theme.ink};font:14px system-ui}h1{font-size:17px;margin:0 0 6px}p{margin:0 0 18px;opacity:.7}</style><h1>科研证据链路</h1><p>${GRAPH_EXPORT_SCOPE}</p>${svg}`, 'text/html', 'research-evidence-chain.html')
}

export function knowledgeBackupStamp() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}

export function downloadKnowledgeJson(text, filename) {
  downloadGraphFile(text, 'application/json', filename)
}
