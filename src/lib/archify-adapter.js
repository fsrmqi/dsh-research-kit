// archify viewer 适配层 —— 把本仓库的 diagram IR / 组装 trace 转换为 vendored archify viewer
// （vendor/archify/template.html，MIT，契约见 NOTICE）所需的 SVG data-* 约定与模板槽位。
// 纯字符串与几何运算，浏览器与 Node 通用；i18n 目录来自 vendor/archify/i18n.mjs
// （bundle 中由 build-client 前置拼接，Node 下原生 ESM 解析）。
// 诚实边界：本适配层只做格式转换，不新增事实；图上每个节点都来自 IR/trace 的真实声明。

import { localizeTemplate, resolveLocale, viewerCatalog } from '../../vendor/archify/i18n.mjs'

// 我们的 kind → archify 架构语义角色（模板 CSS 按角色配色：c-backend/c-frontend/…）。
const KIND_ROLE = {
  workflow: 'backend', finding: 'frontend', file: 'cloud',
  skill: 'messagebus', database: 'database',
  boundary: 'security', guard: 'security',
  params: 'external', step: 'external',
}
const KIND_GLYPH = { workflow: '▶', params: '✎', skill: '✦', database: '⛁', boundary: '⚑', guard: '⚑', step: '·', file: '▤', finding: '✳' }
const GLYPH_FONT = 9.5
const LABEL_FONT = 11
const NOTE_FONT = 9
const LINE_H = 14
const NOTE_LINE_H = 11.5
const PAD_X = 10
const HEADER_H = 15
const PAD_BOTTOM = 8

export function archifyKindRole(kind) {
  return KIND_ROLE[kind] || 'external'
}

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function scriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
}

// 宽字符（CJK/全角）按约 2 倍字宽估算——节点据此自适应尺寸，避免文字挤出盒子或相互重叠。
function charWidth(ch, fontSize) {
  const wide = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch)
  return (wide ? 1.0 : 0.56) * fontSize
}

function textWidth(text, fontSize) {
  let width = 0
  for (const ch of String(text)) width += charWidth(ch, fontSize)
  return width
}

// 按像素宽度换行；超出 maxLines 时末行加省略号（原文仍在 title 与说明卡片里，不静默丢失）。
function wrapByWidth(text, fontSize, maxWidth, maxLines) {
  const source = String(text ?? '')
  if (!source) return []
  const lines = []
  let line = ''
  for (const ch of source) {
    if (line && textWidth(line + ch, fontSize) > maxWidth) {
      lines.push(line)
      line = ch
      if (lines.length === maxLines) break
    } else {
      line += ch
    }
  }
  if (lines.length < maxLines && line) lines.push(line)
  const consumed = lines.join('').length
  if (consumed < source.length && lines.length) {
    let last = lines[lines.length - 1]
    while (last && textWidth(last + '…', fontSize) > maxWidth) last = last.slice(0, -1)
    lines[lines.length - 1] = last + '…'
  }
  return lines
}

// 节点自适应尺寸：先按内容排版，再决定盒子大小（标签与说明分行，永不重叠）。
export function archifyNodeSize(node) {
  const maxTextWidth = 132
  const labelLines = wrapByWidth(node.label, LABEL_FONT, maxTextWidth, 2)
  const noteLines = node.note ? wrapByWidth(node.note, NOTE_FONT, maxTextWidth - 6, 2) : []
  const contentWidth = Math.max(
    74,
    ...labelLines.map(line => textWidth(line, LABEL_FONT)),
    ...noteLines.map(line => textWidth(line, NOTE_FONT)),
  )
  const width = Math.max(Number(node.w) || 0, Math.ceil(contentWidth) + PAD_X * 2 + 6, 124)
  const height = Math.max(
    Number(node.h) || 0,
    Math.ceil(HEADER_H + labelLines.length * LINE_H + (noteLines.length ? noteLines.length * NOTE_LINE_H + 4 : 0) + PAD_BOTTOM),
    42,
  )
  return { w: width, h: height, labelLines, noteLines }
}

// 行布局：按实际宽度顺序排布（弹窗自动布局用），返回带 x/y 的节点。
export function archifyLayoutRow(nodes, { y = 60, gap = 46, x = 40 } = {}) {
  let cursor = x
  return (nodes || []).map(node => {
    const placed = { ...node, x: cursor, y }
    cursor += archifyNodeSize(placed).w + gap
    return placed
  })
}

// 贝塞尔连线几何：边界锚点收缩 + 平滑曲线。
export function archifyEdgeGeometry(nodes, edges) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const sizeOf = n => {
    const size = archifyNodeSize(n)
    return [size.w, size.h]
  }
  return edges.map((edge, index) => {
    const a = byId.get(edge.from), b = byId.get(edge.to)
    if (!a || !b) return null
    const [aw, ah] = sizeOf(a), [bw, bh] = sizeOf(b)
    const acx = a.x + aw / 2, acy = a.y + ah / 2, bcx = b.x + bw / 2, bcy = b.y + bh / 2
    const dx = bcx - acx, dy = bcy - acy
    const clamp = (cx, cy, hw, hh, direction = 1) => {
      if (dx === 0 && dy === 0) return [cx, cy]
      const t = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity)
      return [cx + direction * dx * t, cy + direction * dy * t]
    }
    const [x1, y1] = clamp(acx, acy, aw / 2 + 4, ah / 2 + 4)
    const [x2, y2] = clamp(bcx, bcy, bw / 2 + 7, bh / 2 + 7, -1)
    const mx1 = x1 + (x2 - x1) * 0.42, my1 = y1 + (y2 - y1) * 0.08
    const mx2 = x1 + (x2 - x1) * 0.58, my2 = y1 + (y2 - y1) * 0.92
    return {
      ...edge, index,
      d: `M ${Math.round(x1)} ${Math.round(y1)} C ${Math.round(mx1)} ${Math.round(my1)}, ${Math.round(mx2)} ${Math.round(my2)}, ${Math.round(x2 - Math.sign(dx || 0) * 8)} ${Math.round(y2 - Math.sign(dy || 0) * 8)}`,
    }
  }).filter(Boolean)
}

// 生成符合 archify viewer 契约的 SVG：
// svg[data-animation][data-preset] + title/desc + path[data-edge-*][data-animate="edge"] + g[data-node-id][data-animate="node"]
export function buildArchifySvg({ nodes, edges, title, subtitle = '', locale = 'zh-CN', preset = 'classic', animation = 'trace', metrics = {} }) {
  const metricName = { workflows: '工作流', skills: '技能', databases: '数据源', families: '流程族' }
  const sized = nodes.map(n => {
    let suffix = ''
    for (const c of n.computed || []) {
      if (metrics[c.metric] != null) suffix += ` (${metricName[c.metric] || c.metric} ${metrics[c.metric]})`
    }
    const withLabel = { ...n, label: String(n.label) + suffix }
    return { ...withLabel, ...archifyNodeSize(withLabel) }
  })
  const geo = archifyEdgeGeometry(sized, edges)
  const svgAttrs = [
    'role="img"', `lang="${esc(resolveLocale(locale))}"`,
    'aria-labelledby="archify-diagram-title archify-diagram-description"',
    animation === 'trace' ? 'data-animation="trace"' : '',
    `data-preset="${esc(preset)}"`, 'data-quality-profile="standard"',
  ].filter(Boolean).join(' ')
  const parts = []
  parts.push(`<title id="archify-diagram-title">${esc(title)}</title>`)
  parts.push(`<desc id="archify-diagram-description">${esc(subtitle)}</desc>`)
  geo.forEach(edge => {
    const attrs = [
      `id="edge-${esc(edge.id)}"`,
      `data-edge-id="${esc(edge.id)}"`,
      `data-edge-from="${esc(edge.from)}"`,
      `data-edge-to="${esc(edge.to)}"`,
      edge.label ? ` data-edge-label="${esc(edge.label)}"` : '',
      `data-edge-key="${esc(edge.index)}"`,
    ].join('')
    const animate = animation === 'trace' ? ` data-animate="edge" style="--step:${edge.index}"` : ''
    parts.push(`<path ${attrs}${animate} d="${edge.d}" class="a-default" stroke-width="1.6" fill="none" marker-end="url(#arrowhead)"/>`)
  })
  sized.forEach((n, index) => {
    const role = archifyKindRole(n.kind)
    const animate = animation === 'trace' ? ` data-animate="node" style="--step:${index}"` : ''
    const aria = `${n.label}${n.note ? '，' + n.note : ''}`
    const labelTop = n.y + HEADER_H + LABEL_FONT
    parts.push(`<g id="node-${esc(n.id)}" data-node-id="${esc(n.id)}" data-node-label="${esc(n.label)}" data-node-kind="${esc(n.kind)}" tabindex="0" role="button" aria-label="${esc(aria)}" aria-pressed="false"${animate}>`)
    parts.push(`<title>${esc(n.label)}${n.note ? ' · ' + esc(n.note) : ''}</title>`)
    parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="7" class="c-mask"/>`)
    parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="7" class="c-${role}"${animate} stroke-width="1.5"/>`)
    parts.push(`<text x="${n.x + PAD_X}" y="${n.y + 12}" class="t-muted" font-size="${GLYPH_FONT}">${esc((KIND_GLYPH[n.kind] || '·') + ' ' + (index + 1))}</text>`)
    n.labelLines.forEach((line, li) => {
      parts.push(`<text data-node-label="" x="${n.x + PAD_X}" y="${Math.round(labelTop + li * LINE_H)}" class="t-primary" font-size="${LABEL_FONT}" font-weight="600">${esc(line)}</text>`)
    })
    if (n.noteLines.length) {
      const noteTop = labelTop + n.labelLines.length * LINE_H + 2
      n.noteLines.forEach((line, li) => {
        parts.push(`<text data-detail="context" x="${n.x + PAD_X}" y="${Math.round(noteTop + li * NOTE_LINE_H)}" class="t-muted" font-size="${NOTE_FONT}">${esc(line)}</text>`)
      })
    }
    if (n.source) parts.push(`<text x="${n.x + n.w - 7}" y="${n.y + n.h - 6}" class="t-muted" font-size="8.5" text-anchor="end">SRC</text>`)
    parts.push(`</g>`)
  })
  const canvasW = Math.max(...sized.map(n => n.x + n.w), 320) + 40
  const canvasH = Math.max(...sized.map(n => n.y + n.h), 160) + 40
  return `<svg ${svgAttrs} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(canvasW)} ${Math.round(canvasH)}">\n        ${parts.join('\n        ')}\n      </svg>`
}

// routes（边序列）→ archify guidedViews（章节故事，≤5 章，viewer 按 focus 顺序推导节拍）。
export function archifyGuidedViews(routes, edges) {
  const byId = new Map((edges || []).map(e => [e.id, e]))
  return (Array.isArray(routes) ? routes : []).slice(0, 5).map(route => {
    const focus = []
    for (const edgeId of route.edgeIds || []) {
      const e = byId.get(edgeId)
      if (!e) continue
      if (!focus.includes(e.from)) focus.push(e.from)
      if (!focus.includes(e.to)) focus.push(e.to)
    }
    const view = { id: route.id, label: String(route.label || route.id).slice(0, 48), focus }
    if (route.note) view.note = String(route.note).slice(0, 140)
    return view
  }).filter(view => view.focus.length >= 1)
}

// 槽位替换（镜像 vendored 模板的哨兵契约，见 archify/renderers/shared/utils.mjs applyTemplate）。
const SVG_SLOT_RE = /      <!-- ARCHIFY:SVG_SLOT_START -->[\s\S]*?      <!-- ARCHIFY:SVG_SLOT_END -->/
const CARDS_SLOT_RE = /    <!-- ARCHIFY:CARDS_SLOT_START -->[\s\S]*?    <!-- ARCHIFY:CARDS_SLOT_END -->/
const SUBTITLE_SLOT_RE = /^([ \t]*)<p class="subtitle">\[Subtitle description\]<\/p>[ \t]*(\r?\n)?/m
const GUIDED_VIEWS_PLACEHOLDER = '<!-- ARCHIFY:GUIDED_VIEWS_DATA -->'
const I18N_PLACEHOLDER = '    <!-- ARCHIFY:I18N_DATA -->'

export function archifyApplyTemplate({ template, title, subtitle, svg, cards, locale = 'zh-CN', visualPreset = 'classic', guidedViews = [] }) {
  if (!SVG_SLOT_RE.test(template)) throw new Error('archify-adapter: 模板缺少 SVG_SLOT 哨兵')
  if (!CARDS_SLOT_RE.test(template)) throw new Error('archify-adapter: 模板缺少 CARDS_SLOT 哨兵')
  const resolvedLocale = resolveLocale(locale)
  const localized = localizeTemplate(template, resolvedLocale)
  // 运行时文案（工具栏/章节/透镜/雷达）由 viewer 从 #archify-i18n-data 读取；
  // 缺 messages 时它会原样显示 key（实测：viewer.theme.dark），故必须完整注入目录。
  const i18nData = `    <script id="archify-i18n-data" type="application/json">${scriptJson({ locale: resolvedLocale, messages: viewerCatalog(resolvedLocale) })}</script>`
  const withI18n = localized.includes(I18N_PLACEHOLDER)
    ? localized.replace(I18N_PLACEHOLDER, () => i18nData)
    : localized.replace(GUIDED_VIEWS_PLACEHOLDER, () => `${i18nData}\n    ${GUIDED_VIEWS_PLACEHOLDER}`)
  const cardList = Array.isArray(cards) ? cards : []
  const cardsMarkup = `    <!-- Info Cards -->
    <div class="cards">
${cardList.map(card => `      <div class="card">
        <div class="card-header">
          <div class="card-dot ${esc(card.dot)}"></div>
          <h3>${esc(card.title)}</h3>
        </div>
        <ul>
${card.items.map(item => `          <li>&bull; ${esc(item)}</li>`).join('\n')}
        </ul>
      </div>`).join('\n\n')}
    </div>`
  const renderedSubtitle = subtitle && String(subtitle).trim()
    ? `<p class="subtitle">${esc(subtitle)}</p>`
    : ''
  return withI18n
    .replace('<html lang="en" data-theme="dark" data-preset="[VISUAL PRESET]">', () => `<html lang="${esc(resolvedLocale)}" data-theme="dark" data-preset="${esc(visualPreset)}">`)
    .replace('<title>[PROJECT NAME] Architecture Diagram</title>', () => `<title>${esc(title)}</title>`)
    .replace('<h1>[PROJECT NAME] Architecture</h1>', () => `<h1>${esc(title)}</h1>`)
    .replace(SUBTITLE_SLOT_RE, () => renderedSubtitle)
    .replace(SVG_SLOT_RE, () => svg)
    .replace(CARDS_SLOT_RE, () => cardsMarkup)
    .replace(GUIDED_VIEWS_PLACEHOLDER, () => `<script id="archify-guided-views-data" type="application/json">${scriptJson(guidedViews)}</script>`)
}
