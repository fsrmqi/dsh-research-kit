import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  POPOVER_GAP,
  POPOVER_TOP_CLEARANCE,
  POPOVER_MAX_HEIGHT,
  overlayMaxHeight,
} from '../src/lib/overlay-anchor.js'

// 宿主把 conversation.input.overlay 渲染进输入卡片顶边的零高锚点（宿主自身光标菜单用同一锚点）。
// 浮层一旦写死视口坐标就会脱离触发按钮，并在输入框行数变化时错位——这一组断言锁定「相对锚点」契约。

test('浮层可用高度：按锚点到滚动区上沿的距离解算，空间充裕时取上限', () => {
  // 空间充裕 → 取上限，不随窗口无限拉长。
  assert.equal(overlayMaxHeight(900, 0), POPOVER_MAX_HEIGHT)
  // 常规区间 → 精确等于可用空间扣掉间隙与顶部留白。
  assert.equal(overlayMaxHeight(420, 0), 420 - POPOVER_GAP - POPOVER_TOP_CLEARANCE)
  // 滚动区自身有上偏移（会话头部）时必须一并扣除。
  assert.equal(overlayMaxHeight(500, 80), 500 - 80 - POPOVER_GAP - POPOVER_TOP_CLEARANCE)
})

test('浮层可用高度：裁剪边界是硬约束，空间不足时变矮而不是越界', () => {
  // 这是本次缺陷的回归点：上一版允许浮层顶到 620px，越过滚动区上沿后被裁掉标题。
  const cases = [[220, 0], [120, 0], [1000, 900], [80, 40]]
  for (const [anchorTop, boundaryTop] of cases) {
    const height = overlayMaxHeight(anchorTop, boundaryTop)
    const room = anchorTop - boundaryTop - POPOVER_GAP - POPOVER_TOP_CLEARANCE
    assert.ok(
      height + POPOVER_GAP + POPOVER_TOP_CLEARANCE <= anchorTop - boundaryTop,
      `浮层顶边越过了裁剪边界：可用 ${room}px 却给出 ${height}px`
    )
  }
  // 极端情形不得产生负高度。
  assert.equal(overlayMaxHeight(0, 400), 0)
})

test('浮层可用高度：非法输入回落上限，不产生 NaN 高度', () => {
  for (const [anchor, boundary] of [[undefined, 0], [NaN, 0], [0, undefined], ['x', 0]]) {
    assert.equal(overlayMaxHeight(anchor, boundary), POPOVER_MAX_HEIGHT)
  }
})

test('浮层定位：相对输入卡片锚点，不写死视口坐标', () => {
  const source = readFileSync(new URL('../src/composer-overlay.js', import.meta.url), 'utf8')
  const popover = /key: 'popover',[\s\S]*?style: \{([\s\S]*?)\n {6}\},/.exec(source)
  assert.ok(popover, '未定位到浮层根节点的样式块')
  // 去掉行内注释再做断言：注释里会引用旧写法作为反面说明，不应被当成实际声明。
  const style = popover[1].replace(/\/\/[^\n]*/g, '')
  // 锚点定位：绝对定位 + 贴卡片上沿 + 左缘对齐卡片；一旦回到 fixed/left/bottom 像素值即回归旧缺陷。
  assert.match(style, /position: 'absolute'/, '浮层必须相对锚点绝对定位，而不是钉在视口上')
  assert.doesNotMatch(style, /position: 'fixed'/, '浮层不得使用视口固定定位')
  assert.match(style, /left: 0,/, '浮层左缘应与输入卡片左缘对齐')
  assert.match(style, /bottom: `calc\(100% \+ \$\{POPOVER_GAP\}px\)`/, '浮层底边应由锚点高度与间隙解算')
  assert.doesNotMatch(style, /left: [1-9]/, '浮层水平位置不得写死像素坐标')
  assert.doesNotMatch(style, /bottom: [1-9]/, '浮层垂直位置不得写死像素坐标')
  // 尺寸自适应：宽度相对锚点，高度取实测值而非固定表达式。
  assert.match(style, /width: 'min\(560px, 100%\)'/, '浮层宽度应相对锚点解算，而非 100vw')
  assert.match(style, /maxHeight: popoverHeight == null \? POPOVER_MAX_HEIGHT : popoverHeight/, '浮层高度应由实测可用空间驱动')
  assert.doesNotMatch(style, /100vh/, '浮层不得再以视口高度近似可用空间')
  assert.doesNotMatch(style, /100vw/, '浮层不得以视口宽度近似可用宽度')
})

test('浮层锚点：测量挂到卡片上并随布局变化重算', () => {
  const source = readFileSync(new URL('../src/composer-overlay.js', import.meta.url), 'utf8')
  assert.match(source, /ref: popoverRef/, '浮层根节点未挂 ref，无法测量')
  assert.match(source, /closest\('\[data-composer-card\]'\)/, '未以输入卡片作为锚点基准')
  assert.match(source, /findScrollport\(anchor\)/, '未以滚动裁剪区作为高度边界')
  assert.match(source, /ResizeObserver/, '未监听卡片尺寸变化，输入框变高后浮层不会重算')
  assert.match(source, /observer\?\.observe\(scrollport\)/, '未监听滚动区尺寸变化，可用空间收缩后浮层不会重算')
  assert.match(source, /window\.addEventListener\('resize', measure\)/, '未监听窗口尺寸变化')
  // 锚点缺失时必须放弃测量：否则会以浮层自身的矩形当锚点，形成自反馈的高度抖动。
  assert.match(source, /const anchor = node\?\.closest\('\[data-composer-card\]'\)\n {4}if \(!anchor\) return/, '锚点缺失时未放弃测量')
})
