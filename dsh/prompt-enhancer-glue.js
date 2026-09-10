// 研究草稿增强器：把 vendored PromptKit.QuickEnhancer 适配到 Research Kit 的科研边界。
// 增强服务端（dsh/semantic-enhance.js）复用当前会话模型路由；浏览器端不持有任何 Key。
//
// 研究定制（相对通用 QuickEnhancer 的差异）：
//   1. 只读上下文摘要：把当前会话资源面板勾选的目录条目（数据库、技能等）注入
//      researchContext，供改写对齐术语与范围；@文件 引用由 QuickEnhancer 的草稿解析单独并入；
//   2. 研究边界由服务端 system 指令统一执行（不编造引用/数据、保持研究范围、保密、待核验标记）；
//   3. 增强结果写入前保留差异/恢复能力（QuickEnhancer 内置 undoDraft）。
import { itemById } from '../src/catalog.js'
import { RESEARCH_RESOURCE_SELECTION_EVENT } from '../src/composer-launcher.js'
import { createResearchSelectionStore } from '../src/research-selection-store.js'

const ENHANCE_PATH = '/dsh-research-kit/semantic-enhance'
const ENHANCE_STREAM_PATH = '/dsh-research-kit/semantic-enhance/stream'

// 研究增强客户端：SSE 流式优先，404/501 时降级为非流式 JSON（与 PromptKit 契约一致）。
// QuickEnhancer 的 options 不含 researchContext；这里在发送前统一注入当前会话的
// 只读研究上下文摘要（已选数据库/技能/工作流名称与说明），供服务端对齐术语与范围。
class ResearchSessionEnhancer {
  constructor(getSessionId) { this.getSessionId = getSessionId; this.controller = null }
  get loading() { return !!this.controller }
  withResearchContext(options) {
    return { ...options, researchContext: options.researchContext ?? researchContextSummary(this.getSessionId()) }
  }
  async enhance(options) {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    const { draft, extra, lang, method, strength, hasContext, diagnose = false, researchContext } = this.withResearchContext(options)
    try {
      const response = await fetch(`${ENHANCE_PATH}?session_id=${encodeURIComponent(this.getSessionId())}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft, extra, lang, method, strength, hasContext, diagnose, researchContext }),
        signal: controller.signal,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 504) throw Object.assign(new Error(body.next_action || '模型响应超时，请稍后重试。'), { timeout: true })
        throw new Error(body.next_action || body.error || '基于草稿改造失败')
      }
      return body
    } finally { if (this.controller === controller) this.controller = null }
  }
  async enhanceStream(options) {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    const signal = controller.signal
    const { draft, extra, lang, method, strength, hasContext, diagnose = false, researchContext, onDelta, onStage } = this.withResearchContext(options)
    try {
      const response = await fetch(`${ENHANCE_STREAM_PATH}?session_id=${encodeURIComponent(this.getSessionId())}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft, extra, lang, method, strength, hasContext, diagnose, researchContext }),
        signal,
      })
      if (response.status === 404 || response.status === 501) {
        const error = new Error('stream_unavailable')
        error.fallback = true
        throw error
      }
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}))
        if (response.status === 504) throw Object.assign(new Error(body.next_action || '模型响应超时，请稍后重试。'), { timeout: true })
        throw new Error(body.next_action || body.error || '流式增强不可用')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let final = null
      const consume = frame => {
        const lines = frame.split(/\r?\n/)
        const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
        const dataLine = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
        if (!event || !dataLine) return
        const data = JSON.parse(dataLine)
        if (event === 'delta') onDelta?.(data.text)
        if (event === 'stage') onStage?.(data.phase, data.model)
        if (event === 'done') final = data
        if (event === 'error') throw Object.assign(new Error(data.message || data.error || '流式增强失败'), { timeout: Boolean(data.timeout) })
      }
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (signal.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' })
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
          const frames = buffer.split(/\r?\n\r?\n/)
          buffer = frames.pop() || ''
          for (const frame of frames) consume(frame)
          if (done && buffer.trim()) consume(buffer)
          if (final || done) break
        }
        if (!final) throw new Error('流式增强连接中断。')
        return final
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    } finally { if (this.controller === controller) this.controller = null }
  }
  cancel() { this.controller?.abort(); this.controller = null }
}

// 桥接 DSH 输入框：inputActions 由槽位体系注入（setDraft / submit）。
// 草稿真源随 DSH 版本：InputZone 点时快照（0.1.2）或 useInput 订阅（0.1.3+/旧契约）。
class ResearchDraftComposer {
  constructor(input, inputActions) { this.input = input; this.inputActions = inputActions; this.listeners = new Set() }
  getDraft() { return this.input?.draft ?? '' }
  write(text) { this.inputActions?.setDraft(String(text ?? '')) }
  onChange(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb) }
  notify(draft) { for (const cb of this.listeners) cb(draft) }
}

// 只读研究上下文：当前会话经资源面板勾选的目录条目（数据库、技能等）的名称与一句话说明。
// 纯内存读取，不落盘、不携带文件正文或查询结果；服务端只把它作为改写的范围参照。
// 注意：@文件 引用不在此摘要内——它们由 QuickEnhancer 的草稿解析（referencedFiles）
// 单独并入增强请求的 extra，并自带"文件内容由 DSH @file 在发送后处理"的边界声明。
function researchContextSummary(sessionId) {
  try {
    const rows = createResearchSelectionStore(sessionId).get().map(itemById).filter(Boolean)
    return rows.map(item => `${item.type === 'database' ? '数据库' : item.type === 'workflow' ? '工作流' : '技能'}：${item.name} —— ${item.description}`).join('\n')
  } catch { return '' }
}

function ResearchDraftEnhancerHost(props) {
  const { sessionId, input, useInput, useChat, inputActions } = props
  const zonedDraft = input?.draft
  const hookedInput = useInput ? useInput(value => value) : undefined
  const draft = zonedDraft !== undefined ? zonedDraft : hookedInput?.draft
  const chatSnapshot = useChat ? useChat(value => value?.legacy ?? value) : undefined
  const messages = React.useMemo(() => PromptKit.utils.conversationMessages(chatSnapshot), [chatSnapshot])
  const composer = React.useMemo(() => new ResearchDraftComposer({ draft }, inputActions), [sessionId, inputActions])
  composer.input = { draft }
  const enhancer = React.useMemo(() => new ResearchSessionEnhancer(() => sessionId), [sessionId])
  // 会话资源选择变化时刷新上下文摘要；摘要每次增强时即时计算，避免过期引用。
  const [, setSelectionVersion] = React.useState(0)
  React.useEffect(() => {
    const onChange = () => setSelectionVersion(value => value + 1)
    window.addEventListener(RESEARCH_RESOURCE_SELECTION_EVENT, onChange)
    return () => window.removeEventListener(RESEARCH_RESOURCE_SELECTION_EVENT, onChange)
  }, [])
  const searchMemory = React.useCallback(async query => {
    // 研究上下文桥接：检索 → 摘要预览 → 用户选择 → 组装（QuickEnhancer 的记忆面板自带预览与确认）。
    // 这里只提供检索源；不注入任何未经预览的内容。
    const context = researchContextSummary(sessionId)
    return { text: context, sources: context ? [{ kind: 'research-selection', label: '当前会话已选科研资源' }] : [] }
  }, [sessionId])
  React.useEffect(() => { composer.notify(draft ?? '') }, [draft, composer])
  // 研究方法工坊共用同一 provider 资产命名空间（dsh-research-kit.promptkit.）。
  return React.createElement(PromptKit.QuickEnhancer, {
    methodProvider: researchMethodProvider,
    assetProvider: researchAssetProvider,
    composer,
    enhancer,
    messages,
    searchMemory,
    storagePrefix: 'dsh-research-kit.promptkit.',
  })
}

// 由 standalone-glue 统一注册为 conversation.input.right（顺序见 slot-registry.js）。
// 优先级低于模型选择器与发送按钮；不得截获普通 Enter（QuickEnhancer 内部只拦截自身面板按键）。

