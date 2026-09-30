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

// 同一份 ui/client.js 要同时跑在两种宿主形态下：Web（http://…:3080）与 Desktop App
// （dsh-app://app/，Electron 把应用请求转发给本地 Web Host，源码见 apps/desktop/src/web-document.ts）。
// 宿主形态差异只能由宿主承担，客户端不得对「页面源是 http(s)」做任何假设。
const CLIENT_SOURCES = (() => {
  const script = readFileSync(new URL('../scripts/build-client.mjs', import.meta.url), 'utf8')
  return [...new Set(script.match(/'(?:src|dsh|mcp|vendor)\/[^']+'/g) || [])].map(entry => entry.slice(1, -1))
})()
const HOST_SHAPE_ASSUMPTIONS = [
  ['绝对 http(s) 请求地址（在 App 里会绕过 dsh-app:// 转发）', /\b[\w$]*[Ff]etch\(\s*[`'"](?:https?:)?\/\//],
  ['按页面协议 / 主机 / 端口分支', /location\.(?:protocol|hostname|host|port)\b/],
  ['用页面源作 URL 基准（App 的源是 dsh-app 协议，不是 http(s)）', /location\.origin\b/],
]
// 只扫代码行：整行注释里点名这些写法是合法的（本文件的说明注释就点了名），
// 否则讲规则的注释会把规则自己绊倒。
const codeOnly = text => text.split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')

test('客户端半不依赖宿主形态：按构建清单逐文件核对，再核对产物', () => {
  assert.ok(CLIENT_SOURCES.length > 40, `客户端源码清单提取失败（${CLIENT_SOURCES.length} 个）`)
  assert.ok(CLIENT_SOURCES.includes('dsh/standalone-glue.js'), '清单必须含客户端胶水层，否则守卫会空转')
  const offenders = []
  for (const file of [...CLIENT_SOURCES, 'ui/client.js']) {
    const text = codeOnly(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
    for (const [label, pattern] of HOST_SHAPE_ASSUMPTIONS) {
      const hit = text.match(pattern)
      if (hit) offenders.push(`${file}：${label} → ${hit[0]}`)
    }
  }
  assert.deepEqual(offenders, [], `客户端不得依赖宿主 origin（Web 与 App 是两种源）：\n${offenders.join('\n')}`)
})

test('产物不含写死的本机宿主地址（Web 与 App 的端口都不许内联）', () => {
  // 只认本机字面量：文档/注释里提到端口号是合法的，写死本机地址才说明客户端绕过了宿主。
  const literal = bundle.match(/(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d+)?/g) || []
  assert.deepEqual([...new Set(literal)], [], `客户端产物写死了本机宿主地址：${literal[0]} —— 请改为相对路由`)
})
