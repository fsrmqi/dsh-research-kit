import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HOST_CAPABILITIES_PATH,
  parseMcpToolName,
  probeHostCapabilities,
  hostCapabilitiesRoute,
} from '../dsh/host-capabilities.js'
import { summarizeHostCapabilities, fetchHostCapabilitiesSummary, resetHostCapabilitiesCache } from '../src/host-capabilities-client.js'

// 宿主能力探测（ROADMAP §6）：只报「装配了什么、连了哪些 MCP」的部署级事实，
// 绝不根据资源名称推断某数据库可用；探测自身任何一步失败都退化为「未知」，不抛错。

function makeReply() {
  const pending = { res: null }
  pending.done = new Promise(resolve => {
    pending.res = {
      writeHead(status, headers) { pending.status = status; pending.headers = headers },
      end(body) { resolve({ status: pending.status, headers: pending.headers, body: JSON.parse(body) }) },
    }
  })
  return pending
}

test('MCP 工具名解析：mcp__<server>__<tool>，服务器名可含下划线，畸形名不误判', () => {
  assert.deepEqual(parseMcpToolName('mcp__memory-center__mc_search'), { server: 'memory-center', tool: 'mc_search' })
  assert.deepEqual(parseMcpToolName('mcp__memory_center__lookup'), { server: 'memory_center', tool: 'lookup' }, '服务器名含下划线时取最后一个 __')
  assert.equal(parseMcpToolName('bash'), null)
  assert.equal(parseMcpToolName('mcp__'), null)
  assert.equal(parseMcpToolName('mcp__server__'), null)
  assert.equal(parseMcpToolName('mcp____tool'), null, '空服务器名不算 MCP 工具')
  assert.equal(parseMcpToolName(undefined), null)
})

test('探测：services 报装配事实，MCP 从工具注册表解析并排序去重截断', () => {
  const tools = {
    schemas: () => [
      { name: 'bash' }, { name: 'read' },
      { name: 'mcp__pubmed__search' }, { name: 'mcp__pubmed__fetch' },
      { name: 'mcp__memory-center__mc_search' }, { name: 'mcp__alpha_1__tool' },
    ],
  }
  const capabilities = probeHostCapabilities({
    tools,
    web: { search: () => {}, fetch: () => {} },
    shell: { run: () => {} },
    fs: { readText: () => {}, listDir: () => {} },
    llm: { prepare: () => {} },
    now: 12345,
  })
  assert.equal(capabilities.probedAt, 12345)
  assert.deepEqual(capabilities.services, { web: true, shell: true, fs: true, llm: true })
  assert.equal(capabilities.toolProbeAvailable, true)
  assert.equal(capabilities.builtinToolCount, 2)
  assert.deepEqual(capabilities.mcpServers.map(server => server.server), ['alpha_1', 'memory-center', 'pubmed'], '按服务器名排序')
  assert.deepEqual(capabilities.mcpServers.find(server => server.server === 'pubmed').tools, ['search', 'fetch'])
})

test('探测：服务缺失如实降级（未知/未连接），注册表不可读不抛错', () => {
  const empty = probeHostCapabilities({})
  assert.deepEqual(empty.services, { web: false, shell: false, fs: false, llm: false })
  assert.deepEqual(empty.mcpServers, [])
  assert.equal(empty.toolProbeAvailable, false)
  const broken = probeHostCapabilities({ tools: { schemas: () => { throw new Error('boom') } }, now: 1 })
  assert.equal(broken.toolProbeAvailable, false, '注册表读取失败 → 探测不可用，而不是崩溃')
  const garbage = probeHostCapabilities({ tools: { schemas: () => 'not-an-array' }, now: 1 })
  assert.equal(garbage.toolProbeAvailable, false)
  // 每服务器截断到 50 条，总量截断到 200。
  const many = Array.from({ length: 60 }, (_, index) => ({ name: `mcp__s__t${index}` }))
  const capped = probeHostCapabilities({ tools: { schemas: () => many }, now: 1 })
  assert.equal(capped.mcpServers[0].tools.length, 50)
  assert.equal(capped.mcpServers[0].truncated, true)
})

test('路由：GET 返回探测结果；非 GET 405；探测异常 500 结构化错误', async () => {
  const route = hostCapabilitiesRoute({
    tools: { schemas: () => [{ name: 'mcp__pubmed__search' }] },
    web: { search: () => {}, fetch: () => {} },
  })
  assert.equal(route.path, HOST_CAPABILITIES_PATH)
  let pending = makeReply()
  route.handler({ method: 'GET' }, pending.res)
  const ok = await pending.done
  assert.equal(ok.status, 200)
  assert.equal(ok.body.ok, true)
  assert.deepEqual(ok.body.capabilities.mcpServers.map(server => server.server), ['pubmed'])
  pending = makeReply()
  route.handler({ method: 'POST' }, pending.res)
  assert.equal((await pending.done).status, 405)
  const broken = hostCapabilitiesRoute({ tools: { get schemas() { throw new Error('x') } } })
  pending = makeReply()
  await broken.handler({ method: 'GET' }, pending.res).catch(() => {})
  const failed = await pending.done
  assert.equal(failed.status, 500)
  assert.equal(failed.body.ok, false)
})

test('浏览器摘要：装配服务与 MCP 名单成行；无事实时不渲染；缓存 5 分钟', async () => {
  assert.equal(summarizeHostCapabilities(null), '')
  assert.equal(summarizeHostCapabilities({ services: {} }), '', '无任何事实 → 空串，视图不渲染')
  const summary = summarizeHostCapabilities({
    services: { web: true, shell: true, fs: false, llm: false },
    mcpServers: [{ server: 'memory-center', tools: ['mc_search'] }, { server: 'pubmed', tools: ['search'] }],
    toolProbeAvailable: true,
  })
  assert.match(summary, /已装配：Web、Shell/)
  assert.match(summary, /MCP 已连接：memory-center、pubmed/)
  assert.equal(summarizeHostCapabilities({ services: {}, mcpServers: [], toolProbeAvailable: true }).includes('未连接'), true)

  // 缓存：同一进程内 5 分钟内复用；失败/空结果不缓存。
  resetHostCapabilitiesCache()
  let calls = 0
  const fetcher = async () => { calls++; return { ok: true, json: async () => ({ ok: true, capabilities: { services: { web: true }, mcpServers: [], toolProbeAvailable: true } }) } }
  let clock = 1000
  const now = () => clock
  const first = await fetchHostCapabilitiesSummary({ fetcher, now })
  assert.match(first, /已装配：Web/)
  await fetchHostCapabilitiesSummary({ fetcher, now })
  assert.equal(calls, 1, 'TTL 内不重复请求')
  clock += 6 * 60_000
  await fetchHostCapabilitiesSummary({ fetcher, now })
  assert.equal(calls, 2, '过期后重新探测')
  // 探测失败 → 空串且不缓存空值。
  resetHostCapabilitiesCache()
  const failing = await fetchHostCapabilitiesSummary({ fetcher: async () => { throw new Error('down') }, now })
  assert.equal(failing, '')
})

test('接线：Node half 注册两条路由；工作台只读摘要不改写目录标注（ROADMAP §6 门槛）', () => {
  const entry = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(entry, /hostCapabilitiesRoute\(\{/)
  assert.match(entry, /memorySearchRoute\(\{/)
  // 软依赖：探测服务经 ctx.get 读取，不进入 inject 硬依赖（缺失时降级而非拒载）。
  assert.match(entry, /ctx\.get\?\.\('tools'\)/)
  assert.doesNotMatch(entry, /inject = \[.*'tools'/)
  const workbench = readFileSync(new URL('../src/research-workbench.js', import.meta.url), 'utf8')
  assert.match(workbench, /fetchHostCapabilitiesSummary/, '工作台未消费能力摘要')
  // 目录标注单一真源仍是 validate-catalog 的双向契约：能力探测不得出现可用性改写。
  const client = readFileSync(new URL('../src/host-capabilities-client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(client, /availability/, '能力探测消费端不得改写目录标注')
})
