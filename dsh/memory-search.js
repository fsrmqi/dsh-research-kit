export const MEMORY_SEARCH_PATH = '/dsh-research-kit/memory-search'
export const DEFAULT_MEMORY_SERVER = 'memory-center'
// 返回文本上限：只取有界摘要供增强上下文与来源预览，不搬运全库。
const MAX_TEXT_CHARS = 4000
const EXEC_TIMEOUT_MS = 15_000
const MAX_SERVERS = 24
const MAX_QUERY_CHARS = 300

// ── MCP 检索工具选择与参数合成（纯函数，单测覆盖）────────────────────────────
// Memory Center 以 MCP 服务器形式接入（工具名 `mcp__<server>__<tool>`）。
// 插件不预设它的私有契约：先按服务器挑工具，再按该工具自己的 JSON Schema 合成参数。

// 在目标服务器的工具里挑检索类入口：名字命中 search/lookup/query 的优先，
// 其次 recall/find；都没有则回落第一个工具并在 candidates 里给出全部选择，
// 让调用方（或用户配置）可以显式指定，绝不静默猜。
export function pickMemoryTool(schemas, server) {
  const list = Array.isArray(schemas) ? schemas : []
  const prefix = `mcp__${server}__`
  const candidates = []
  for (const schema of list) {
    const name = String(schema?.name || '')
    if (!name.startsWith(prefix)) continue
    candidates.push({ name, description: String(schema?.description || ''), parameters: schema?.parameters })
  }
  if (!candidates.length) return { tool: null, candidates: [] }
  const rank = re => candidates.find(candidate => re.test(candidate.name))
  const tool = rank(/search/i) || rank(/lookup/i) || rank(/query/i) || rank(/recall|find/i) || candidates[0]
  return { tool, candidates: candidates.map(candidate => candidate.name) }
}

// 这些必填 string 参数显然不是「检索词」本身（标识符/路径/模式类），填 query 是瞎猜，
// 宁可明确拒绝并在诊断里列出，也不打出去必失败的调用。
const NON_QUERY_KEY = /(id|path|file|key|name|type|kind|mode|action|format|lang|source|url|version)$/i

// 按工具声明的 JSON Schema 合成参数。原则：宁可拒绝执行，也不用猜的参数打 MCP——
//   - 名字像检索词的 string 属性（query/q/keyword/search）填 query；
//   - 名字像条数的 number 属性（limit/topK/k/n/max）填 limit；
//   - 其余 required：普通 string 填 query、number 填 limit、boolean 填 false；
//   - enum / object / array / 标识类 string 的 required 无法可靠填充 → 明确列出 missing。
export function buildMemoryToolArgs(parameters, { query, limit = 8 } = {}) {
  const schema = parameters && typeof parameters === 'object' ? parameters : {}
  const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
  const required = Array.isArray(schema.required) ? schema.required : []
  const args = {}
  const missing = []
  for (const key of Object.keys(props)) {
    const prop = props[key] && typeof props[key] === 'object' ? props[key] : {}
    const type = Array.isArray(prop.type) ? prop.type[0] : prop.type
    if (/query|^q$|keyword|search/i.test(key) && (type === 'string' || !type)) args[key] = query
    else if (/^(limit|top_?k|k|n|max)(_|$)/i.test(key) && (type === 'number' || type === 'integer')) args[key] = limit
  }
  for (const key of required) {
    if (args[key] !== undefined) continue
    const prop = props[key] && typeof props[key] === 'object' ? props[key] : {}
    const type = Array.isArray(prop.type) ? prop.type[0] : prop.type
    if (type === 'string' && !Array.isArray(prop.enum) && !NON_QUERY_KEY.test(key)) args[key] = query
    else if (type === 'number' || type === 'integer') args[key] = limit
    else if (type === 'boolean') args[key] = false
    else missing.push(key)
  }
  return missing.length ? { ok: false, missing, args } : { ok: true, args, missing }
}

// 从工具执行的返回里取有界文本（MCP 结果统一是 ContentBlock 数组）。
export function memoryTextOf(result) {
  const content = result?.content
  if (!Array.isArray(content)) return ''
  const text = content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}…（已截断）` : text
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

let callCounter = 0

function parseServerOf(name) {
  const raw = String(name || '')
  if (!raw.startsWith('mcp__')) return null
  const rest = raw.slice(5)
  const sep = rest.lastIndexOf('__')
  if (sep <= 0 || sep >= rest.length - 2) return null
  return rest.slice(0, sep)
}

// 检索路由：POST { query, server?, tool?, limit? }。
// 返回 { ok, available, ... }：available=false 是「部署里没有可用的 Memory Center MCP」
// 或参数无法可靠合成，属于如实降级而非错误；available=true 时 text/sources 供增强器
// 预览与注入。安全边界：本路由只代为执行 `mcp__` 前缀的工具，绝不触碰原生工具。
export function memorySearchRoute({ tools, logger } = {}) {
  return {
    kind: 'exact', path: MEMORY_SEARCH_PATH,
    async handler(req, res) {
      if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'method_not_allowed' })
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      let body = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { body = {} }
      const query = String(body.query || '').trim()
      const server = String(body.server || DEFAULT_MEMORY_SERVER)
      const limit = Math.max(1, Math.min(Number(body.limit) || 8, 20))
      const explicitTool = String(body.tool || '').trim()
      if (!query) return reply(res, 400, { ok: false, error: 'empty_query' })
      if (query.length > MAX_QUERY_CHARS) return reply(res, 400, { ok: false, error: 'query_too_long' })
      if (explicitTool && !explicitTool.startsWith('mcp__')) {
        return reply(res, 400, { ok: false, error: 'non_mcp_tool', message: '本路由只代为执行 MCP 工具（mcp__ 前缀）。' })
      }
      if (typeof tools?.execute !== 'function' || typeof tools?.schemas !== 'function') {
        return reply(res, 200, { ok: true, available: false, reason: 'tools-unavailable' })
      }
      let schemas = []
      try { schemas = tools.schemas() || [] } catch { schemas = [] }
      let tool = null
      let candidates = []
      if (explicitTool) {
        const found = schemas.find(schema => schema?.name === explicitTool)
        if (!found) return reply(res, 200, { ok: true, available: false, reason: 'tool-not-found', tool: explicitTool })
        tool = { name: found.name, description: found.description || '', parameters: found.parameters }
      } else {
        const picked = pickMemoryTool(schemas, server)
        tool = picked.tool
        candidates = picked.candidates
      }
      if (!tool) {
        return reply(res, 200, {
          ok: true, available: false, reason: 'server-not-found', server, candidates,
          servers: [...new Set(schemas.map(schema => parseServerOf(schema?.name)).filter(Boolean))].slice(0, MAX_SERVERS),
        })
      }
      const planned = buildMemoryToolArgs(tool.parameters, { query, limit })
      if (!planned.ok) {
        return reply(res, 200, {
          ok: true, available: false, reason: 'args-unfillable', tool: tool.name,
          missing: planned.missing,
          message: `检索工具 ${tool.name} 的必填参数无法从检索词合成（${planned.missing.join('、')}）；请在请求里显式指定合适的 server/tool。`,
        })
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), EXEC_TIMEOUT_MS)
      try {
        const callId = `rk-memory-${Date.now()}-${++callCounter}`
        const result = await tools.execute({ callId, name: tool.name, arguments: planned.args, signal: controller.signal })
        const text = memoryTextOf(result)
        if (result?.isError) {
          return reply(res, 200, { ok: true, available: false, reason: 'tool-error', tool: tool.name, message: text || '检索工具返回错误。' })
        }
        if (!text.trim()) {
          return reply(res, 200, { ok: true, available: true, server, tool: tool.name, text: '', sources: [], message: '检索无结果。' })
        }
        try { logger?.info?.(`memory search via ${tool.name} query=${query.length} chars`) } catch {}
        return reply(res, 200, {
          ok: true, available: true, server, tool: tool.name, text,
          sources: [{ kind: 'memory', label: `Memory Center · ${server}/${tool.name}` }],
        })
      } catch (error) {
        const message = controller.signal.aborted ? 'Memory Center 检索超时，请稍后重试。' : `Memory Center 检索失败：${error?.message || error}`
        return reply(res, 200, { ok: true, available: false, reason: 'execute-failed', tool: tool.name, message })
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}
