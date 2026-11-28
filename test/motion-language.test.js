import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('theme.js 统一动效令牌、减少动态效果全局兜底与大图节点性能守卫', () => {
  const theme = read('../src/theme.js')
  for (const token of ['--rk-ease-out', '--rk-ease-spring', '--rk-ease-in', '--rk-dur-instant', '--rk-dur-fast', '--rk-dur-base', '--rk-dur-slow']) {
    assert.ok(theme.includes(token), `缺少统一动效令牌 ${token}`)
  }
  assert.match(theme, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\[class\*="rk-"\]/, '减少动态效果必须覆盖全部 rk-* 类，避免新增动效遗漏')
  assert.match(theme, /\.rk-seg > button:hover:not\(:disabled\)\s*\{\s*transform:\s*none\s*\}/, '分段控件按钮悬停不得上浮脱离滑动胶囊')
  const graphNodeRule = /\.rk-graph-node\s*\{([^}]*)\}/.exec(theme)
  assert.ok(graphNodeRule, '缺少 .rk-graph-node 规则')
  assert.doesNotMatch(graphNodeRule[1], /filter/, '证据图谱节点不得对 filter 做逐帧过渡，防止大图缩放掉帧')
  assert.match(theme, /\.rk-pop-leave\b/, '弹层缺少退场动画类 .rk-pop-leave')
  assert.match(theme, /\.rk-backdrop-leave\b/, '弹层遮罩缺少退场动画类 .rk-backdrop-leave')
  assert.match(theme, /\.rk-spinner-ring\b/, 'Spinner 应走样式类 .rk-spinner-ring 以便在减少动态效果下停转')
  assert.match(theme, /\.rk-num-tick\b/, '缺少数值变化微过渡类 .rk-num-tick')
})

test('ui.js 基础组件具备弹层退场、Escape 关闭、Spinner 降级与数值过渡', () => {
  const ui = read('../src/ui.js')
  assert.match(ui, /className:\s*'rk-spinner-ring'/, 'Spinner 应使用 .rk-spinner-ring 而非内联 animation')
  assert.doesNotMatch(ui, /animation:\s*'rk-spin/, 'Spinner 不得硬编码内联 rk-spin 动画')
  assert.match(ui, /export function CountValue\(/, 'ui.js 应导出 CountValue 数值过渡组件')
  assert.match(ui, /rk-pop-leave/, 'Modal 应支持关闭退场动画')
  assert.match(ui, /event\.key === 'Escape'/, 'Modal 应内置 Escape 键关闭')
  assert.match(ui, /rk-btn--\$\{/, 'Button 应输出语义变体类以统一悬停反馈')
})

test('证据图谱画布支持触控板 1:1 跟手缩放与迷你地图拖拽导航', () => {
  const canvas = read('../src/evidence-graph-canvas.js')
  assert.match(canvas, /directCameraRef\.current = true/, '触控板缩放与迷你地图拖拽应走 1:1 直写模式，避免叠加 220ms 滞后补间')
  assert.match(canvas, /onPointerDown:\s*onMinimapPointerDown/, '迷你地图应支持指针拖拽浏览')
  assert.match(canvas, /clampGraphScale/, '触控板缩放应限制在合法缩放区间内')
})

test('伴生沉淀钮使用合成层 translate3d 平滑跟随且首次挂载不飞入', () => {
  const fab = read('../src/composer-deposit-button.js')
  assert.match(fab, /translate3d\(\$\{position\.x\}px, \$\{position\.y\}px, 0\)/, '伴生按钮应使用合成层 translate3d 位移')
  assert.match(fab, /triggerDataInstant:\s*instant/, '伴生按钮首次挂载应跳过位移过渡')
  assert.match(fab, /rk-deposit-fab/, '伴生按钮应挂上 .rk-deposit-fab 过渡类')
})
