import resources from './catalog/resources/index.js'
import { databaseQueryRoute } from './dsh/database-query.js'
import { semanticEnhanceRoute, semanticEnhanceStreamRoute } from './dsh/semantic-enhance.js'
import { hostCapabilitiesRoute } from './dsh/host-capabilities.js'
import { memorySearchRoute } from './dsh/memory-search.js'

// 科研插件的唯一 Node half。公开数据源查询只经 DSH 的受控 web 服务出网；
// 语义增强复用当前会话已建立的路由（sessionId → provider/model），浏览器端永不持有 API Key。
export const inject = ['webServer', 'web', 'llm', 'sessions']

// 会话模型路由的惰性兜底：agent/created 只在插件已加载后触发，
// 若插件在会话创建之后才启用（或热重载），该会话永远不会补发事件，增强会误报
// 「尚未建立模型路由」。故在缓存未命中时向 ctx.sessions 反查一次。
// 宿主 sessions 的形状随版本演进，这里逐层探测并整体吞异常：查不到返回 null，
// 行为退化为修复前一致（503 + 可读错误），绝不因探测失败而崩溃。
function resolveRouteFromSessions(sessions, sessionId) {
  if (!sessions || !sessionId) return null
  try {
    const session = typeof sessions.get === 'function' ? sessions.get(sessionId)
      : typeof sessions.resolve === 'function' ? sessions.resolve(sessionId)
        : sessions[sessionId]
    const options = session?.agent?.options || session?.options
    const provider = options?.provider
    const model = options?.model
    return provider && model ? { provider, model } : null
  } catch {
    return null
  }
}

function createSessionRoutes(sessions) {
  const known = new Map()
  return {
    set(sessionId, route) { known.set(sessionId, route) },
    delete(sessionId) { known.delete(sessionId) },
    clear: () => known.clear(),
    get(sessionId) {
      if (known.has(sessionId)) return known.get(sessionId)
      const fallback = resolveRouteFromSessions(sessions, sessionId)
      // 缓存兜底结果，避免每次增强都反查宿主。
      if (fallback) known.set(sessionId, fallback)
      return fallback
    },
  }
}

export function apply(ctx) {
  const logger = ctx.logger?.('dsh-research-kit')
  ctx.effect(() => ctx.webServer.register(databaseQueryRoute({ web: ctx.web, databases: resources, logger })), 'dsh-research-kit database query')
  // 会话模型路由：agent/created 记录、agent/disposed 删除，只存 provider/model 标识，不存任何 Key。
  const routes = createSessionRoutes(ctx.sessions)
  ctx.effect(() => {
    ctx.on('agent/created', ({ agent }) => {
      const provider = agent?.options?.provider
      const model = agent?.options?.model
      if (provider && model) routes.set(String(agent.session.id), { provider, model })
    })
    ctx.on('agent/disposed', ({ agent }) => routes.delete(String(agent.session.id)))
    return () => routes.clear()
  }, 'dsh-research-kit session model routes')
  ctx.effect(() => ctx.webServer.register(semanticEnhanceRoute({ llm: ctx.llm, routes, logger })), 'dsh-research-kit semantic enhancement')
  ctx.effect(() => ctx.webServer.register(semanticEnhanceStreamRoute({ llm: ctx.llm, routes, logger })), 'dsh-research-kit semantic enhancement (stream)')
  // 宿主能力探测（ROADMAP §6）：只报装配与 MCP 连接事实，不改写目录标注。
  // 全部软依赖：宿主未提供对应服务时按「未知/未连接」如实呈现，探测不抛错。
  ctx.effect(() => ctx.webServer.register(hostCapabilitiesRoute({
    tools: ctx.get?.('tools'), web: ctx.web, shell: ctx.get?.('shell'), fs: ctx.get?.('fs'), llm: ctx.llm, logger,
  })), 'dsh-research-kit host capabilities')
  // Memory Center 项目记忆检索（ROADMAP §5）：只代为执行 mcp__ 前缀的检索工具，
  // 结果交浏览器端预览；是否进入 Prompt 由用户在增强面板显式勾选（禁止静默注入）。
  ctx.effect(() => ctx.webServer.register(memorySearchRoute({ tools: ctx.get?.('tools'), logger })), 'dsh-research-kit memory search')
}
