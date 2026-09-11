import test from 'node:test'
import assert from 'node:assert/strict'
import { traceSegments, buildReplaySvgMarkup } from '../src/route-replay.js'

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

test('buildReplaySvgMarkup：动画锚点、边界站配色、用户输入转义', () => {
  const theme = { ink: '#000', muted: '#666', line: '#ccc', teal: '#0f766e', amber: '#b45309', canvas: '#fff', surface: '#fff', tealTint: '#f1faf8', amberTint: '#fff7ed' }
  const { markup } = buildReplaySvgMarkup(trace, theme, { lit: 0, reduced: false })
  assert.match(markup, /pathLength="1"/, '连线必须 pathLength 归一化')
  assert.match(markup, /rk-replay-draw/, '缺少 dashoffset 绘制动画')
  assert.match(markup, /620ms/, '步进时长应与 STEP_MS 一致')
  assert.match(markup, /fill="#fff7ed"/, '边界站应使用琥珀底色')
  const hostile = [{ ...trace[1], detail: '<script>alert(1)</script>' }]
  const hardened = buildReplaySvgMarkup(hostile, theme, { lit: 0, reduced: true }).markup
  assert.ok(!hardened.includes('<script>'), '参数值进 SVG 前必须转义')
  assert.match(hardened, /&lt;script&gt;/, '转义后应保留可读文本')
})

test('buildReplaySvgMarkup：静态模式整条点亮且无动画类', () => {
  const theme = { ink: '#000', muted: '#666', line: '#ccc', teal: '#0f766e', amber: '#b45309', canvas: '#fff', surface: '#fff', tealTint: '#f1faf8', amberTint: '#fff7ed' }
  const { markup } = buildReplaySvgMarkup(trace, theme, { lit: trace.length, reduced: true })
  assert.match(markup, /lit-static/, '静态模式应直接点亮连线')
  assert.ok(!markup.includes('animation:'), '静态模式不得携带动画声明')
})
