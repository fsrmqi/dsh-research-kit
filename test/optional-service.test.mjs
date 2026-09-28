// 可选能力探测的契约：缺服务只降级，不打断插件装载。
//
// 这些用例钉住的是一条**装载安全**规则，不是实现细节：宿主版本不同、装配不同，
// 可选服务可能整个不存在；只要探测本身会抛，用户看到的就是插件加载失败。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  OPTIONAL_SERVICES, resolveOptionalService, resolveOptionalServices, describeOptionalServices,
} from '../dsh/optional-service.js'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const indexSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('宿主没有 ctx.get（旧版本）时全部按不可用处理，不抛错', () => {
  for (const ctx of [undefined, null, {}, { get: 42 }, { get: 'nope' }]) {
    const { services, available } = resolveOptionalServices(ctx)
    assert.deepEqual(Object.keys(services).sort(), OPTIONAL_SERVICES.map(entry => entry.name).sort())
    assert.ok(Object.values(services).every(service => service === null))
    assert.ok(Object.values(available).every(flag => flag === false))
    assert.equal(resolveOptionalService(ctx, 'tools'), null)
  }
})

test('ctx.get 对未知名字抛错时退化为不可用，而不是把异常抛给宿主', () => {
  const ctx = {
    get(name) {
      if (name === 'tools') return { schemas: () => [] }
      throw new Error(`service not found: ${name}`)
    },
  }
  const { services, available } = resolveOptionalServices(ctx)
  assert.equal(available.tools, true)
  assert.equal(available.shell, false)
  assert.equal(available.fs, false)
  assert.deepEqual(Object.keys(services.tools), ['schemas'])
  // 非对象返回值（占位 true / 字符串）同样按不可用处理：消费方要的是能调方法的服务。
  assert.equal(resolveOptionalService({ get: () => true }, 'shell'), null)
  assert.equal(resolveOptionalService({ get: () => 'yes' }, 'shell'), null)
  assert.equal(resolveOptionalService({ get: () => ({ run() {} }) }, 'shell').run !== undefined, true)
  // 名字非法时不去调用 ctx.get。
  let called = 0
  const counting = { get() { called += 1; return {} } }
  assert.equal(resolveOptionalService(counting, ''), null)
  assert.equal(resolveOptionalService(counting, null), null)
  assert.equal(called, 0)
})

test('可读清单只描述事实，不携带服务实例（避免实例被写进日志或响应体）', () => {
  const ctx = { get: name => (name === 'fs' ? { readText() {}, listDir() {} } : undefined) }
  const { available } = resolveOptionalServices(ctx)
  const described = describeOptionalServices(available)
  assert.deepEqual(described, [
    { name: 'tools', label: '工具注册表（MCP 与内建工具）', available: false },
    { name: 'shell', label: 'Shell 执行', available: false },
    { name: 'fs', label: '文件系统', available: true },
  ])
  assert.ok(!JSON.stringify(described).includes('readText'), '清单里不能带服务方法名')
  // 缺省入参也要能给出一份完整清单。
  assert.equal(describeOptionalServices().length, OPTIONAL_SERVICES.length)
})

test('可选服务不进客户端 inject 清单：缺名字会让宿主拒绝装载整个插件', () => {
  // 两处 inject 各有口径：package.json 的 dsh.client.inject 列的是「依赖哪些客户端插件行」，
  // 产物里的 inject 由构建脚本硬编码（客户端 cordis 服务）。可选服务两处都不该出现。
  const inject = packageJson.dsh?.client?.inject || []
  const bundle = readFileSync(new URL('../ui/client.js', import.meta.url), 'utf8')
  assert.ok(bundle.includes("inject: ['slots', 'sessions']"), '产物 inject 必须保持最小集合')
  for (const entry of OPTIONAL_SERVICES) {
    assert.ok(!inject.includes(entry.name), `可选服务 ${entry.name} 不得写入 dsh.client.inject`)
    assert.ok(!bundle.includes(`inject: ['slots', 'sessions', '${entry.name}']`), `可选服务 ${entry.name} 不得写入产物 inject`)
  }
  // 宿主半区统一走探测 helper，不再各处手写 ctx.get?.()：散落的写法正是「有的地方兜了、有的没兜」的来源。
  assert.ok(indexSource.includes('resolveOptionalServices(ctx)'), 'index.js 应统一通过 resolveOptionalServices 取可选服务')
  assert.ok(!indexSource.includes("ctx.get?.('tools')"), 'index.js 不应残留手写的可选服务探测')
})
