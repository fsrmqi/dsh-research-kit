export const HOST_CAPABILITIES_PATH = '/dsh-research-kit/host-capabilities'

// 宿主能力探测（ROADMAP §6）：回答「这个 DSH 部署实际装配了什么、连了哪些 MCP」，只报事实。
//
// 两条事实来源，口径严格分开：
//   - services：服务是否挂载（装配事实）。挂载 ≠ 某个具体数据库可用，本探测不改写目录标注；
//   - mcpServers：从工具注册表解析 `mcp__<server>__<tool>` 命名得到的「已连接」事实——
//     只有真的在注册表里出现的 MCP 服务器才会列出，绝不按资源名称推断。
//
// 门槛（ROADMAP §6）：目录条目从 `requires-mcp` 升级 `available-in-host` 需要针对条目的
// 真实验证，本探测只提供部署级事实底座，不构成升级依据。
const MAX_SERVERS = 24
const MAX_TOOLS_PER_SERVER = 50
const MAX_TOTAL_TOOLS = 200

// 解析 MCP 工具名：`mcp__<server>__<tool>`。服务器名可含下划线但不含双下划线，
// 因此取最后一个 `__` 做分隔；解析不出的名字不进 MCP 清单（计入普通工具）。
export function parseMcpToolName(name) {
  const raw = String(name || '')
  if (!raw.startsWith('mcp__')) return null
  const rest = raw.slice(5)
  const sep = rest.lastIndexOf('__')
  if (sep <= 0 || sep >= rest.length - 2) return null
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) }
}

function servicePresent(service, methods) {
  if (!service || typeof service !== 'object') return false
  return methods.every(method => typeof service[method] === 'function')
}

// 纯探测（依赖全部可注入，Node 测试用桩复现）：任何一步失败都退化为「该项未知」，
// 探测绝不抛错——它只是能力面板的数据源，不能反过来打断宿主。
export function probeHostCapabilities({ tools, web, shell, fs, llm, now = Date.now() } = {}) {
  const capabilities = {
    probedAt: Number(now) || 0,
    services: {
      web: servicePresent(web, ['search', 'fetch']),
      shell: servicePresent(shell, ['run']),
      fs: servicePresent(fs, ['readText', 'listDir']),
      llm: servicePresent(llm, ['stream']), // 生产代码实际消费 llm.stream（semantic-enhance），以此为准。
    },
    mcpServers: [],
    builtinToolCount: 0,
    toolCount: 0,
    toolProbeAvailable: false,
  }
  if (typeof tools?.schemas !== 'function') return capabilities
  let schemas = []
  try { schemas = tools.schemas() || [] } catch { return capabilities }
  if (!Array.isArray(schemas)) return capabilities
  capabilities.toolProbeAvailable = true
  const byServer = new Map()
  const totals = new Map()
  let total = 0
  for (const schema of schemas) {
    if (capabilities.toolCount >= MAX_TOTAL_TOOLS) break
    const name = String(schema?.name || '')
    if (!name) continue
    capabilities.toolCount++
    const parsed = parseMcpToolName(name)
    if (!parsed) { capabilities.builtinToolCount++; continue }
    if (!byServer.has(parsed.server)) { byServer.set(parsed.server, []); totals.set(parsed.server, 0) }
    totals.set(parsed.server, totals.get(parsed.server) + 1)
    const list = byServer.get(parsed.server)
    if (list.length < MAX_TOOLS_PER_SERVER) list.push(parsed.tool)
  }
  capabilities.mcpServers = [...byServer.entries()]
    .slice(0, MAX_SERVERS)
    .map(([server, toolNames]) => ({ server, tools: toolNames, truncated: totals.get(server) > toolNames.length }))
    .sort((a, b) => a.server.localeCompare(b.server))
  return capabilities
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function hostCapabilitiesRoute({ tools, web, shell, fs, llm, logger } = {}) {
  return {
    kind: 'exact', path: HOST_CAPABILITIES_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') return reply(res, 405, { ok: false, error: 'method_not_allowed' })
      try {
        const capabilities = probeHostCapabilities({ tools, web, shell, fs, llm })
        return reply(res, 200, { ok: true, capabilities })
      } catch (error) {
        try { logger?.warn?.(`host capabilities probe failed: ${error?.message || error}`) } catch {}
        return reply(res, 500, { ok: false, error: 'probe_failed', message: '能力探测失败，请稍后重试。' })
      }
    },
  }
}
