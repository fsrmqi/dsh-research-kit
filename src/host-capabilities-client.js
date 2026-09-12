// 宿主能力探测的浏览器端消费：拉取 Node half 的 /dsh-research-kit/host-capabilities，
// 把探测结果汇总成一行事实摘要（装配了哪些服务、连了哪些 MCP 服务器）。
//
// 边界（ROADMAP §6）：摘要只陈述部署级事实，绝不推断「某个数据库可用」；
// 目录条目的可用性标注（requires-mcp 等）不由本模块改写。

const CACHE_TTL_MS = 5 * 60_000
const MAX_LISTED_SERVERS = 4

// 纯摘要（单测覆盖）：探测成功 → 事实行；探测失败/缺数据 → 空串（视图不渲染该行）。
export function summarizeHostCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== 'object') return ''
  const parts = []
  const services = capabilities.services || {}
  const flags = [
    ['Web', services.web], ['Shell', services.shell], ['文件系统', services.fs], ['模型路由', services.llm],
  ].filter(([, on]) => on === true).map(([label]) => label)
  if (flags.length) parts.push(`已装配：${flags.join('、')}`)
  const servers = Array.isArray(capabilities.mcpServers) ? capabilities.mcpServers : []
  if (servers.length) {
    const names = servers.slice(0, MAX_LISTED_SERVERS).map(server => server.server)
    const more = servers.length > MAX_LISTED_SERVERS ? ` 等 ${servers.length} 台` : ''
    parts.push(`MCP 已连接：${names.join('、')}${more}`)
  } else if (capabilities.toolProbeAvailable) {
    parts.push('MCP：未连接任何服务器')
  }
  if (!parts.length) return ''
  return parts.join('；')
}

// 进程级缓存：工作台与查询面板共享同一探测结果，5 分钟内不重复请求。
let cache = { at: 0, summary: '', promise: null }

export function resetHostCapabilitiesCache() {
  cache = { at: 0, summary: '', promise: null }
}

export async function fetchHostCapabilitiesSummary({ fetcher, now = Date.now() } = {}) {
  const doFetch = fetcher || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
  if (!doFetch) return ''
  if (cache.summary && now() - cache.at < CACHE_TTL_MS) return cache.summary
  if (!cache.promise) {
    cache.promise = (async () => {
      const response = await doFetch('/dsh-research-kit/host-capabilities')
      if (!response.ok) return ''
      const body = await response.json().catch(() => null)
      return body?.ok ? summarizeHostCapabilities(body.capabilities) : ''
    })()
  }
  try {
    const summary = await cache.promise
    if (summary) cache = { at: now(), summary, promise: null }
    else cache.promise = null
    return summary
  } catch {
    cache.promise = null
    return ''
  }
}
