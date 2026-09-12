import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { traceSegments, buildReplaySvgMarkup } from '../src/route-replay.js'
import { buildArchifySvg, archifyApplyTemplate, archifyNodeSize, archifyLayoutRow, archifyEdgeGeometry } from '../src/lib/archify-adapter.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('连线终点位于目标迎向来源的一侧，正向与反向均不穿过目标节点', () => {
  const nodes = [{ id: 'a', x: 0, y: 0, label: 'A' }, { id: 'b', x: 300, y: 0, label: 'B' }]
  const [forward, reverse] = archifyEdgeGeometry(nodes, [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
  const endX = edge => Number(edge.d.split(' ').at(-2))
  assert.ok(endX(forward) < 300)
  assert.ok(endX(reverse) > archifyNodeSize(nodes[0]).w)
})

test('回放能定位可选空值与重复参数，并分别高亮各自出现位置', () => {
  const repeated = [
    { step: 'param', label: '范围', detail: '未指定（请按综合方式处理）', empty: true },
    { step: 'param', label: '甲', detail: '水稻' },
    { step: 'param', label: '乙', detail: '水稻' },
  ]
  const { steps, segments } = traceSegments(repeated, '未指定（请按综合方式处理）：水稻与水稻')
  assert.ok(steps.every(step => step.found))
  assert.notEqual(steps[1].anchorStart, steps[2].anchorStart)
  assert.equal(segments.filter(segment => segment.stepIndex === 1).map(segment => segment.text).join(''), '水稻')
  assert.equal(segments.filter(segment => segment.stepIndex === 2).map(segment => segment.text).join(''), '水稻')
})

// 回放面板的纯函数契约：锚点定位、文本互证、SVG markup 的动画锚点与转义。
// 组件的 React 部分由渲染级测试与 MANUAL-QA O6 覆盖。

const trace = [
  { step: 'workflow', id: 'w1', label: '写引言', detail: '从材料到引言' },
  { step: 'param', id: 'topic', label: '主题', detail: '单细胞转录组学' },
  { step: 'param', id: 'scope', label: '范围', detail: '[范围]', empty: true },
  { step: 'skill', id: 'citation-hygiene', label: '引用核验', detail: '引用必须逐条核验' },
  { step: 'database', id: 'crossref', label: 'Crossref', detail: '公开 DOI 元数据' },
  { step: 'guard', id: 'generic-guard', label: '科研边界', detail: '不得编造' },
]
const prompt = '请为「单细胞转录组学」撰写引言。范围：[范围]。\n\n通用科研边界：仅基于已提供材料。\n\n附加技能指导：\n- 【引用核验】引用必须逐条核验。\n\n研究资源提示：\n- 【Crossref】公开 DOI 元数据。'

test('traceSegments：每个步骤都能在 Prompt 中定位锚点', () => {
  const { steps } = traceSegments(trace, prompt)
  for (const step of steps) {
    assert.ok(step.found, `步骤 ${step.step}:${step.label} 应能在 Prompt 中找到锚点`)
  }
})

test('traceSegments：分段拼接后与原文逐字节一致', () => {
  const { segments } = traceSegments(trace, prompt)
  assert.equal(segments.map(seg => seg.text).join(''), prompt, '分段不得增删任何字符')
})

test('buildReplaySvgMarkup：彗星覆盖层、辉光脉冲、贝塞尔连线、用户输入转义', () => {
  const theme = { ink: '#000', muted: '#666', line: '#ccc', teal: '#0f766e', amber: '#b45309', canvas: '#fff', surface: '#fff', tealTint: '#f1faf8', amberTint: '#fff7ed' }
  const { markup } = buildReplaySvgMarkup(trace, theme, { lit: 2, reduced: false })
  assert.match(markup, /pathLength="1"/, '连线必须 pathLength 归一化')
  assert.match(markup, /rk-replay-comet-run/, '缺少彗星流光覆盖层（overlay 跑光机制）')
  assert.match(markup, /rk-replay-beat/, '缺少节点到达辉光脉冲')
  assert.match(markup, /rk-replay-ambient/, '缺少完成后 ambient 流动')
  assert.match(markup, / C /, '连线应为贝塞尔曲线')
  assert.match(markup, /cubic-bezier\(0\.22, 1, 0\.36, 1\)/, '缺少高级缓动曲线')
  assert.match(markup, /fill="#fff7ed"/, '边界站应使用琥珀底色')
  assert.match(markup, /⚑/, '边界站应有边界图标')
  const hostile = [{ ...trace[1], detail: '<script>alert(1)</script>' }]
  const hardened = buildReplaySvgMarkup(hostile, theme, { lit: 0, reduced: true }).markup
  assert.ok(!hardened.includes('<script>'), '参数值进 SVG 前必须转义')
  assert.match(hardened, /&lt;script&gt;/, '转义后应保留可读文本')
})

test('buildReplaySvgMarkup：静态模式整条点亮且无动画声明', () => {
  const theme = { ink: '#000', muted: '#666', line: '#ccc', teal: '#0f766e', amber: '#b45309', canvas: '#fff', surface: '#fff', tealTint: '#f1faf8', amberTint: '#fff7ed' }
  const { markup } = buildReplaySvgMarkup(trace, theme, { lit: trace.length, reduced: true })
  assert.match(markup, /lit-static/, '静态模式应直接点亮连线')
  assert.ok(!markup.includes('animation'), '静态模式不得携带任何动画声明')
  assert.ok(!markup.includes('<style>'), '静态模式不得注入样式块')
})

test('archify 适配：SVG 符合 vendored viewer 的 data-* 契约', () => {
  const nodes = [
    { id: 'w1', kind: 'workflow', label: '写引言', x: 40, y: 60 },
    { id: 's1', kind: 'skill', label: '引用核验', x: 280, y: 60 },
    { id: 'b1', kind: 'boundary', label: '待人工核验', x: 520, y: 60 },
  ]
  const edges = [{ id: 'e1', from: 'w1', to: 's1' }, { id: 'e2', from: 's1', to: 'b1' }]
  const svg = buildArchifySvg({ nodes, edges, title: '契约图', subtitle: '只回放声明事实', preset: 'classic', animation: 'trace', metrics: {} })
  assert.match(svg, /data-animation="trace"/)
  assert.match(svg, /data-preset="classic"/)
  assert.match(svg, /data-node-id="w1"/, '节点缺少 data-node-id')
  assert.match(svg, /data-edge-from="w1"/, '边缺少 data-edge-from')
  assert.match(svg, /data-animate="node"/, '节点缺少 ambient 动画钩子')
  assert.match(svg, /class="c-backend"/, '工作流节点应映射 backend 角色')
  assert.match(svg, /class="c-security"/, '边界节点应映射 security 角色')
})

test('archify 适配：模板槽位全部替换且注入转义', () => {
  const template = readFileSync(join(root, 'vendor', 'archify', 'template.html'), 'utf8')
  const nodes = [{ id: 'a', kind: 'workflow', label: '<script>alert(1)</script>', x: 40, y: 60 }]
  const svg = buildArchifySvg({ nodes, edges: [], title: '标题', locale: 'zh-CN', preset: 'classic', animation: 'trace', metrics: {} })
  const html = archifyApplyTemplate({
    template, title: '弹窗标题', subtitle: '只回放真实的组装事实', svg,
    cards: [{ dot: 'amber', title: '使用边界', items: ['结果需人工核验'] }],
    locale: 'zh-CN', visualPreset: 'classic',
    guidedViews: [{ id: 'replay', label: '组装回放路线', focus: ['a'] }],
  })
  assert.ok(!html.includes('[VISUAL PRESET]'), '预设占位符未替换')
  assert.ok(!html.includes('[Subtitle description]'), '字幕占位符未替换')
  assert.ok(!html.includes('ARCHIFY:SVG_SLOT_START'), 'SVG 槽位未替换')
  assert.match(html, /<title>弹窗标题<\/title>/)
  assert.match(html, /archify-guided-views-data/)
  assert.match(html, /只回放真实的组装事实/)
  assert.ok(!html.includes('<script>alert(1)</script>'), '恶意 label 必须被转义')
})

test('archify 适配：注入运行时 i18n 目录（否则工具栏显示原始 key）', () => {
  const template = readFileSync(join(root, 'vendor', 'archify', 'template.html'), 'utf8')
  const svg = buildArchifySvg({ nodes: [{ id: 'a', kind: 'workflow', label: '审阅论文', x: 40, y: 60 }], edges: [], title: 't', locale: 'zh-CN', preset: 'classic', animation: 'trace', metrics: {} })
  const html = archifyApplyTemplate({ template, title: 't', subtitle: 's', svg, cards: [], locale: 'zh-CN', visualPreset: 'classic', guidedViews: [] })
  assert.match(html, /"messages":\{/, '缺少运行时文案目录')
  assert.match(html, /"viewer\.theme\.dark":"深色"/, '运行时文案必须是中文而非原始 key')
  assert.match(html, /"viewer\.guided\.playStory":"播放故事"/, '章节文案缺失')
})

test('archify 适配：节点按内容自适应，标签与说明互不重叠且不越出盒子', () => {
  const rich = archifyNodeSize({ kind: 'skill', label: '科学写作', note: '写作纪律：使用克制、正式的学术表达' })
  const plain = archifyNodeSize({ kind: 'params', label: '重点审查方向' })
  assert.ok(rich.h > plain.h, '带说明的节点应高于纯标签节点')
  const node = { id: 'a', kind: 'skill', label: '科学写作', note: '写作纪律：使用克制、正式的学术表达', x: 40, y: 60 }
  const svg = buildArchifySvg({ nodes: [node], edges: [], title: 't', metrics: {} })
  const box = /<rect x="40" y="60" width="(\d+)" height="(\d+)"/.exec(svg)
  const height = Number(box[2])
  const labelY = Number(/<text data-node-label=""[^>]*y="(\d+)"/.exec(svg)[1])
  const noteY = Number(/<text data-detail="context"[^>]*y="(\d+)"/.exec(svg)[1])
  assert.ok(noteY > labelY + 8, `说明行应在标签行之下（label ${labelY} / note ${noteY}）`)
  const ys = [...svg.matchAll(/<text[^>]*\sy="(\d+)"/g)].map(m => Number(m[1]))
  assert.ok(Math.max(...ys) <= 60 + height - 4, '文字不得越出节点盒底边')
})

test('archify 适配：行布局按实际宽度排布且不重叠', () => {
  const placed = archifyLayoutRow([
    { id: 'a', kind: 'workflow', label: '审阅论文' },
    { id: 'b', kind: 'skill', label: '科学写作', note: '写作纪律：使用克制、正式的学术表达' },
    { id: 'c', kind: 'boundary', label: '科研边界' },
  ], { y: 60, gap: 48 })
  for (let i = 1; i < placed.length; i++) {
    const prev = placed[i - 1]
    const prevRight = prev.x + archifyNodeSize(prev).w
    assert.ok(placed[i].x >= prevRight + 48 - 1, `节点 ${i} 与前一个重叠`)
  }
})
