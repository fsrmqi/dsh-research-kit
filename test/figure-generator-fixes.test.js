
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateFigure, listFigureStyles } from '../mcp/execution/figure-generator.js'

test('风格兜底：line_training_curve 必须有独立的 plotCode 分支，不能落到 radar', async () => {
  const result = generateFigure('line_training_curve', {
    series: { a: { x: [1, 2, 3], y: [4, 5, 6] } },
  })
  assert.equal(result.error, undefined, '应成功生成脚本')
  assert.ok(result.data.script.includes("DATA['series']"), '应读取 series')
  // line_training_curve 是折线图，绝不能包含极坐标或 categories
  assert.equal(
    result.data.script.includes("projection='polar'"),
    false,
    'line_training_curve 不应使用极坐标投影（radar 模板）',
  )
  assert.equal(
    result.data.script.includes("DATA['categories']"),
    false,
    'line_training_curve 不应读取 categories（该风格不校验 categories）',
  )
})

test('data 校验：null 与数字字符串必须被拒绝，不能污染 Python 脚本', async () => {
  // null 在数值数组中 → Python None → np.asarray 变 NaN
  const r1 = generateFigure('bar_paired_delta', {
    categories: ['a', 'b'],
    baseline: [null, 20],
    method: [9, 25],
  })
  assert.ok(r1.error, 'baseline 含 null 必须报错')
  assert.ok(r1.message.includes('非空数值'), '错误消息应说明需要数值')

  // 数字字符串 → Python 引号 → matplotlib 类型错误
  const r2 = generateFigure('bar_paired_delta', {
    categories: ['a', 'b'],
    baseline: ['10', '20'],
    method: ['9', '25'],
  })
  assert.ok(r2.error, 'baseline 为字符串必须报错')

  // zoom/break_x 显式 null → Python None.get()
  const r3 = generateFigure('line_loss_with_inset', {
    series: { a: { x: [1, 2], y: [1, 2] } },
    zoom: null,
  })
  assert.ok(r3.error, 'zoom 显式 null 必须报错')

  const r4 = generateFigure('scatter_broken_axis', {
    series: { a: { x: [1, 2], y: [1, 2] } },
    break_x: null,
  })
  assert.ok(r4.error, 'break_x 显式 null 必须报错')
})

test('dpi/figsize 必须为正数', async () => {
  const r1 = generateFigure('bar_grouped_hatch', {
    categories: ['a'],
    series: { m: [1] },
  }, { dpi: 0 })
  assert.ok(r1.error, 'dpi=0 必须报错')

  const r2 = generateFigure('bar_grouped_hatch', {
    categories: ['a'],
    series: { m: [1] },
  }, { figsize: [0, 0] })
  assert.ok(r2.error, 'figsize=[0,0] 必须报错')

  const r3 = generateFigure('bar_grouped_hatch', {
    categories: ['a'],
    series: { m: [1] },
  }, { figsize: [-3, 4] })
  assert.ok(r3.error, 'figsize 含负数必须报错')
})

test('bar_paired_delta：负增益标成 "+-X%" 且 baseline==0 时把绝对差当百分比', async () => {
  const neg = generateFigure('bar_paired_delta', {
    categories: ['退步'],
    baseline: [10],
    method: [9],
  })
  assert.equal(neg.error, undefined)
  // ratio = -10%，新代码用 sign 变量控制前缀
  assert.ok(
    neg.data.script.includes("sign = '+' if method[i] >= baseline[i] else ''"),
    '负增益标注应使用 sign 变量控制前缀',
  )

  const zero = generateFigure('bar_paired_delta', {
    categories: ['零基线'],
    baseline: [0],
    method: [5],
  })
  assert.equal(zero.error, undefined)
  // baseline==0 时的标注不带 % 符号（这是绝对差）
  assert.ok(
    zero.data.script.includes("ax.annotate(f'{method[i]:+.1f}'") || zero.data.script.includes("f'{value:+.1f}'"),
    'baseline==0 时的标注不应带 % 符号（这是绝对差）',
  )
})

test('apa_style：colors.palette 必须被实际读取，否则 schema 承诺的色盲安全调色板是谎言', async () => {
  const apa = generateFigure('bar_grouped_hatch', {
    categories: ['a', 'b'],
    series: { m1: [1, 2], m2: [3, 4] },
    apa_style: true,
  })
  assert.equal(apa.error, undefined)
  // apa_style 写入 colors.palette，但没有任何绘图分支读它
  // 验证脚本里是否有 palette 的使用（如 palette[i%len(palette)]）
  assert.ok(
    apa.data.script.includes('palette[') || apa.data.script.includes("STYLE_COLORS.get('ablation')"),
    'apa_style 必须实际使用 Okabe-Ito 调色板（脚本中应有 palette 相关代码）',
  )
})
