import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MEMORY_SEARCH_PATH,
  DEFAULT_MEMORY_SERVER,
  pickMemoryTool,
  buildMemoryToolArgs,
  memoryTextOf,
  memorySearchRoute,
} from '../dsh/memory-search.js'

// Memory Center 项目记忆检索（ROADMAP §5）：
// 检索 → 来源与文本摘要预览 → 用户显式勾选 → 组装进增强请求，禁止静默注入。
// 插件不预设 Memory Center 的私有 MCP 契约：按服务器挑工具、按工具自己的 JSON Schema 合成参数，
// 无法可靠合成就拒绝执行——绝不拿猜的参数打 MCP，也绝不代打原生工具。

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

const post = (route, body) => {
  const req = {
    method: 'POST',
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) },
  }
  const pending = makeReply()
  const handled = route.handler(req, pending.res)
  // done = 回执 promise；handled = handler 自身 promise（异常会在这里冒泡）。
  return { done: pending.done, handled, pending }
}

test('pickMemoryTool：按服务器过滤，search 优先，无命中回落第一个并给出候选清单', () => {
  const schemas = [
    { name: 'bash' },
    { name: 'mcp__memory-center__mc_context' },
    { name: 'mcp__memory-center__mc_search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'mcp__pubmed__search' },
  ]
  const picked = pickMemoryTool(schemas, 'memory-center')
  assert.equal(picked.tool.name, 'mcp__memory-center__mc_search')
  assert.deepEqual(picked.candidates, ['mcp__memory-center__mc_context', 'mcp__memory-center__mc_search'])
  const onlyOther = pickMemoryTool(schemas, 'pubmed')
  assert.equal(onlyOther.tool.name, 'mcp__pubmed__search')
  assert.equal(pickMemoryTool(schemas, 'absent').tool, null)
  assert.deepEqual(pickMemoryTool(schemas, 'absent').candidates, [])
})

test('参数合成：检索词/条数按名字归位；标识类与 enum 必填拒绝合成（宁可不打猜的调用）', () => {
  const ok = buildMemoryToolArgs(
    { type: 'object', properties: { query: { type: 'string' }, top_k: { type: 'integer' }, verbose: { type: 'boolean' } }, required: ['query', 'top_k'] },
    { query: '水稻耐盐性', limit: 5 },
  )
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.args, { query: '水稻耐盐性', top_k: 5 })
  // required 的普通 string 也用检索词填充；boolean 填 false；number 填 limit。
  const generic = buildMemoryToolArgs(
    { type: 'object', properties: { text: { type: 'string' }, count: { type: 'number' } }, required: ['text', 'count'] },
    { query: 'q1', limit: 3 },
  )
  assert.deepEqual(generic.args, { text: 'q1', count: 3 })
  // 标识类（id/path/name…）与 enum、object、array：无法可靠填充 → missing。
  const reject = buildMemoryToolArgs(
    {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        mode: { type: 'string', enum: ['fast', 'deep'] },
        filter: { type: 'object' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['task_id', 'mode', 'filter', 'tags'],
    },
    { query: 'q2' },
  )
  assert.equal(reject.ok, false)
  assert.deepEqual(reject.missing, ['task_id', 'mode', 'filter', 'tags'])
  assert.deepEqual(buildMemoryToolArgs(undefined, { query: 'q' }).args, {}, '无 schema 时不合成任何参数')
})

test('memoryTextOf：取文本块拼接并截断；非文本结果为空', () => {
  assert.equal(memoryTextOf({ content: [{ type: 'text', text: 'a' }, { type: 'image', url: 'x' }, { type: 'text', text: 'b' }] }), 'a\nb')
  assert.equal(memoryTextOf({ content: [] }), '')
  assert.equal(memoryTextOf(null), '')
  const long = memoryTextOf({ content: [{ type: 'text', text: 'x'.repeat(5000) }] })
  assert.ok(long.includes('已截断'))
})

test('路由：正常检索、无服务器、参数不可合成、工具报错，全部结构化如实返回', async () => {
  const schemas = [
    { name: 'bash' },
    { name: 'mcp__memory-center__mc_search', description: '检索项目记忆', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } },
  ]
  const tools = {
    schemas: () => schemas,
    async execute(input) {
      assert.equal(input.name, 'mcp__memory-center__mc_search')
      assert.deepEqual(input.arguments, { query: '水稻', limit: 8 })
      assert.ok(input.callId.startsWith('rk-memory-'))
      return { content: [{ type: 'text', text: '决策：采用耐盐位点标记辅助选育（2026-09）' }], isError: false }
    },
  }
  const route = memorySearchRoute({ tools })
  assert.equal(route.path, MEMORY_SEARCH_PATH)
  let run = post(route, { query: '水稻' })
  await run.done
  const ok = await run.done
  assert.equal(ok.status, 200)
  assert.equal(ok.body.available, true)
  assert.match(ok.body.text, /耐盐位点/)
  assert.equal(ok.body.sources[0].kind, 'memory')

  // 无该服务器：available=false + 给出部署里实际存在的 MCP 服务器清单（诊断，不猜）。
  run = post(route, { query: 'x', server: 'absent' })
  await run.done
  const absent = await run.done
  assert.equal(absent.body.available, false)
  assert.equal(absent.body.reason, 'server-not-found')
  assert.deepEqual(absent.body.servers, ['memory-center'])

  // 参数不可合成：明确拒绝而不是硬打。
  const strictRoute = memorySearchRoute({ tools: { schemas: () => [...schemas, { name: 'mcp__memory-center__mc_fetch', parameters: { type: 'object', properties: {}, required: ['task_id'] } }], execute: async () => { throw new Error('should not run') } } })
  run = post(strictRoute, { query: 'x', tool: 'mcp__memory-center__mc_fetch' })
  await run.done
  const unfillable = await run.done
  assert.equal(unfillable.body.available, false)
  assert.equal(unfillable.body.reason, 'args-unfillable')
  assert.deepEqual(unfillable.body.missing, ['task_id'])

  // 工具返回 isError → 如实报 tool-error，文本作为 message。
  const errorRoute = memorySearchRoute({ tools: { schemas: () => schemas, execute: async () => ({ content: [{ type: 'text', text: '后端不可用' }], isError: true }) } })
  run = post(errorRoute, { query: 'x' })
  await run.done
  const toolError = await run.done
  assert.equal(toolError.body.reason, 'tool-error')
  assert.match(toolError.body.message, /后端不可用/)
})

test('路由安全与降级：只代执行 mcp__ 工具；宿主无 tools 服务时如实降级；非法输入 400', async () => {
  const route = memorySearchRoute({ tools: { schemas: () => [], execute: async () => { throw new Error('never') } } })
  let run = post(route, { query: 'x', tool: 'bash' })
  await run.done
  assert.equal((await run.done).status, 400, '非 mcp__ 工具直接拒绝')
  run = post(route, { query: '' })
  await run.done
  assert.equal((await run.done).status, 400)
  run = post(memorySearchRoute({}), { query: 'x' })
  await run.done
  const degraded = await run.done
  assert.equal(degraded.body.available, false)
  assert.equal(degraded.body.reason, 'tools-unavailable')
  let pending = makeReply()
  memorySearchRoute({}).handler({ method: 'GET' }, pending.res)
  assert.equal((await pending.done).status, 405)
})

test('接线：增强器 searchMemory 经路由检索并合并来源；用户不勾选就不进 Prompt（禁止静默注入）', () => {
  const glue = readFileSync(new URL('../dsh/prompt-enhancer-glue.js', import.meta.url), 'utf8')
  assert.match(glue, /\/dsh-research-kit\/memory-search/)
  assert.match(glue, /sources\.push/, '记忆来源要并入来源清单供面板预览')
  // 注入开关仍由 vendored QuickEnhancer 的「项目记忆」toggle 控制：searchMemory 只在被勾选后才被调用。
  const vendor = readFileSync(new URL('../vendor/promptkit-embed.js', import.meta.url), 'utf8')
  assert.match(vendor, /setUseMemoryContext\(value => !value\)/, '项目记忆必须是显式开关（off 默认）')
  assert.match(glue, /记忆检索不可用不是增强的失败条件|不阻断增强/, '记忆失败回落而非失败')
})
