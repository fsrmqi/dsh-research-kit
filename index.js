import resources from './catalog/resources/index.js'
import { databaseQueryRoute } from './dsh/database-query.js'
import { semanticEnhanceRoute, semanticEnhanceStreamRoute } from './dsh/semantic-enhance.js'
import { evidenceAgentAssessRoute } from './dsh/evidence-agent-assess.js'
import { hostCapabilitiesRoute } from './dsh/host-capabilities.js'
import { resolveOptionalServices } from './dsh/optional-service.js'
import { memorySearchRoute } from './dsh/memory-search.js'
import { Config } from './dsh/config.js'
import { evidenceSyncRoute } from './dsh/evidence-sync.js'
import { claimReviewRoute } from './dsh/claim-review.js'
import { claimAgentReviewRoute } from './dsh/claim-agent-review.js'
import { researchDreamRoute } from './dsh/research-dream.js'
import { dreamMemoryRoute } from './dsh/dream-memory.js'
import { evidenceSourceCheckRoute } from './dsh/evidence-source-check.js'
import { agentActivityRoute } from './dsh/agent-activity.js'
import { catalogDataRoute, catalogItemRoute, catalogSearchRoute } from './dsh/catalog-data.js'
import { archifyTemplateRoute } from './dsh/archify-template.js'
import { promptKitClientRoute } from './dsh/promptkit-client.js'

// 科研插件的唯一 Node half。公开数据源查询只经 DSH 的受控 web 服务出网；
// 语义增强复用当前会话已建立的路由（sessionId → provider/model），浏览器端永不持有 API Key。
export const inject = ['webServer', 'web', 'llm', 'sessions']
export { Config }

// DSH 0.2.2 起宿主把「用户为下一步选定的模型」记为 durable selection（`agent.model.current()`），
// `agent.options.provider/model` 只是没记录选择时的兜底路由。这里优先读 selection，读不到再退回
// options——0.2.1 及更早的宿主没有 `agent.model`，可选链让这段在旧宿主上是恒 undefined，不抛错。
// 只取 provider/model 标识，不持有 Key，也不缓存 selection（用户随时可能切模型）。
function readAgentSelection(agent) {
  try {
    const selection = typeof agent?.model?.current === 'function' ? agent.model.current() : undefined
    const provider = selection?.provider
    const model = selection?.model
    return provider && model ? { provider, model } : null
  } catch {
    return null
  }
}

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
    const agent = session?.agent
    const selected = readAgentSelection(agent)
    if (selected) return selected
    const options = agent?.options || session?.options
    const provider = options?.provider
    const model = options?.model
    return provider && model ? { provider, model } : null
  } catch {
    return null
  }
}

function createSessionRoutes(sessions) {
  const known = new Map()
  const agents = new Map()
  return {
    set(sessionId, route) { known.set(sessionId, route) },
    // 保存 agent 才能在每次读取时问宿主要「当前选择」；仅存 provider/model 会漏掉运行中的切换。
    track(sessionId, agent) { if (agent) agents.set(sessionId, agent) },
    delete(sessionId) { known.delete(sessionId); agents.delete(sessionId) },
    clear() { known.clear(); agents.clear() },
    get(sessionId) {
      const selected = readAgentSelection(agents.get(sessionId))
      if (selected) {
        known.set(sessionId, selected)
        return selected
      }
      if (known.has(sessionId)) return known.get(sessionId)
      const fallback = resolveRouteFromSessions(sessions, sessionId)
      // 缓存兜底结果，避免每次增强都反查宿主。
      if (fallback) known.set(sessionId, fallback)
      return fallback
    },
  }
}

export function apply(ctx, config = Config({})) {
  const logger = ctx.logger?.('dsh-research-kit')
  ctx.effect(() => ctx.webServer.register(catalogDataRoute()), 'dsh-research-kit catalog data')
  ctx.effect(() => ctx.webServer.register(catalogItemRoute()), 'dsh-research-kit catalog item')
  ctx.effect(() => ctx.webServer.register(catalogSearchRoute()), 'dsh-research-kit catalog search')
  ctx.effect(() => ctx.webServer.register(archifyTemplateRoute()), 'dsh-research-kit archify template')
  ctx.effect(() => ctx.webServer.register(promptKitClientRoute()), 'dsh-research-kit promptkit client')
  ctx.effect(() => ctx.webServer.register(databaseQueryRoute({ web: ctx.web, databases: resources, logger, config })), 'dsh-research-kit database query')
  // 会话模型路由：agent/created 记录、agent/disposed 删除，只存 provider/model 标识，不存任何 Key。
  const routes = createSessionRoutes(ctx.sessions)
  ctx.effect(() => {
    ctx.on('agent/created', ({ agent }) => {
      const sessionId = String(agent?.session?.id ?? '')
      if (!sessionId) return
      routes.track(sessionId, agent)
      const provider = agent?.options?.provider
      const model = agent?.options?.model
      if (provider && model) routes.set(sessionId, { provider, model })
    })
    ctx.on('agent/disposed', ({ agent }) => {
      // 事件处理器里任何异常都会冒到宿主事件循环；会话访问器抛错时只放弃这次清理（clear 兜底）。
      try { routes.delete(String(agent?.session?.id ?? '')) } catch { /* 清理尽力而为 */ }
    })
    return () => routes.clear()
  }, 'dsh-research-kit session model routes')
  ctx.effect(() => ctx.webServer.register(semanticEnhanceRoute({ llm: ctx.llm, routes, logger })), 'dsh-research-kit semantic enhancement')
  ctx.effect(() => ctx.webServer.register(semanticEnhanceStreamRoute({ llm: ctx.llm, routes, logger })), 'dsh-research-kit semantic enhancement (stream)')
  ctx.effect(() => ctx.webServer.register(evidenceAgentAssessRoute({ llm: ctx.llm, routes, logger })), 'dsh-research-kit evidence agent assessment')
  // 宿主能力探测（ROADMAP §6）：只报装配与 MCP 连接事实，不改写目录标注。
  // 全部软依赖：宿主未提供对应服务时按「未知/未连接」如实呈现，探测不抛错。
  // 取用统一走 resolveOptionalServices（dsh/optional-service.js）：可选服务不进 inject 清单，
  // 缺服务只让对应功能降级，不让插件装载失败。
  const optional = resolveOptionalServices(ctx)
  ctx.effect(() => ctx.webServer.register(hostCapabilitiesRoute({
    tools: optional.services.tools, web: ctx.web, shell: optional.services.shell, fs: optional.services.fs, llm: ctx.llm, logger,
  })), 'dsh-research-kit host capabilities')
  // Memory Center 项目记忆检索（ROADMAP §5）：只代为执行 mcp__ 前缀的检索工具，
  // 结果交浏览器端预览；是否进入 Prompt 由用户在增强面板显式勾选（禁止静默注入）。
  ctx.effect(() => ctx.webServer.register(memorySearchRoute({ tools: optional.services.tools, logger, config })), 'dsh-research-kit memory search')
  // 证据同步（Agent 化改造 §6.3）：文件系统为单一真源，IndexedDB 仅作 UI 缓存层。
  ctx.effect(() => ctx.webServer.register(evidenceSyncRoute({ logger })), 'dsh-research-kit evidence sync')
  ctx.effect(() => ctx.webServer.register(claimReviewRoute({ logger })), 'dsh-research-kit claim review')
  ctx.effect(() => ctx.webServer.register(claimAgentReviewRoute({ llm: ctx.llm, routes, logger })), 'dsh-research-kit claim agent review')
  ctx.effect(() => ctx.webServer.register(researchDreamRoute({ llm: ctx.llm, routes, logger })), 'dsh-research-kit research dream')
  ctx.effect(() => ctx.webServer.register(dreamMemoryRoute({ logger })), 'dsh-research-kit dream memory')
  ctx.effect(() => ctx.webServer.register(evidenceSourceCheckRoute({ web: ctx.web, logger })), 'dsh-research-kit evidence source metadata check')
  // Agent 活动面板数据源：MCP 调用日志 + checkpoint 状态（Agent 化改造 §8.1）。
  ctx.effect(() => ctx.webServer.register(agentActivityRoute({ logger })), 'dsh-research-kit agent activity')
}
