import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bundle = readFileSync(new URL('../ui/client.js', import.meta.url), 'utf8')

// 构建器按行剥离 import。若源码出现跨行 `import { … } from '…'`，
// 只删首行会残留一段非法语句，产物语法直接失败 —— 该用例守护这条回归。
test('产物不含未剥离的 import / export 语句（多行 import 已折叠）', () => {
  const offenders = bundle.split('\n').filter(line => /^\s*(import|export)\s/.test(line))
  assert.deepEqual(offenders, [], `产物残留模块语句：${offenders.slice(0, 3).join(' | ')}`)
  assert.equal(bundle.match(/from '\.\//g), null, '产物不得残留相对模块引用')
})

test('产物包含统一视觉层（theme token、图标、基础组件）', () => {
  for (const token of ['--rk-teal', '--rk-shadow-card', '--rk-d-ink', 'rk-btn', 'rk-card', 'rk-scroll']) {
    assert.ok(bundle.includes(token), `产物缺少视觉 token：${token}`)
  }
  for (const component of ['function Button(', 'function Panel(', 'function Modal(', 'function Segmented(', 'function EmptyState(', 'const Icon =']) {
    assert.ok(bundle.includes(component), `产物缺少统一组件：${component}`)
  }
})

test('四个科研视图复用同一组件层，不再各自内联样式常量', () => {
  // 旧实现各视图自定义 styles.button/styles.tab 等局部变量；重构后应统一走 ui.js。
  assert.ok(bundle.includes('function ResearchWorkbench('))
  assert.ok(bundle.includes('function ResearchVault('))
  assert.ok(bundle.includes('function ResearchEvidenceGraph('))
  assert.ok(bundle.includes('function ResearchComposerOverlay('))
  assert.ok(!/button:\s*primary\s*=>/.test(bundle), '不应残留按视图自定义的按钮样式工厂')
})
