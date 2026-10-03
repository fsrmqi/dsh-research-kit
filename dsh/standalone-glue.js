import { ResearchConsole } from '../src/research-console.js'
import { ResearchComposerLauncher } from '../src/composer-launcher.js'
import { ResearchComposerOverlay } from '../src/composer-overlay.js'
import { registerResearchSlots } from './slot-registry.js'
import { attachKnowledgeDeposition } from '../src/knowledge-deposition.js'
import { ResearchPluginStatusSection, ResearchKitBadge, ResearchKitDiagnosticsAction, ResearchKitOpenWorkbenchAction, ResearchKitPresetConfig } from '../src/plugin-status.js'
import { ResearchToolView, researchToolNames } from '../src/research-toolview.js'
import { ResearchMessageDepositAction } from '../src/message-deposit-action.js'

export function researchKitApply(ctx) {
  // 唯一视图：内部按分区渲染「资源与工作流 / 方法工坊 / 研究资产库 / 研究证据图谱」。
  function ResearchConsoleHost(props) {
    return React.createElement(ResearchConsole, props)
  }
  // 组件数组顺序与 slot-registry.js 的 RESEARCH_SLOTS 一一对应。
  const components = [
    ResearchConsoleHost,        // dsh-research-kit-console
    ResearchComposerLauncher,   // dsh-research-kit-launcher
    ResearchComposerOverlay,    // dsh-research-kit-overlay
    ResearchDraftEnhancerHost   // dsh-research-kit-draft-enhancer（prompt-enhancer-glue.js）
  ]
  const disposers = [registerResearchSlots(ctx, components)]
  // Plugins-page status section follows the Plugins page lifecycle; other
  // subjects render null instead of making this row require plugin-manager.
  disposers.push(ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section',
    id: 'dsh-research-kit-status',
  }, ResearchPluginStatusSection)))
  // 标题徽章与头部动作同样只在科研套件的详情页渲染；其他 subject 一律返回 null，
  // 因此这些槽位缺失（旧宿主／无 plugin-manager）时只是不显示，不报错。
  disposers.push(ctx.slots.inject('plugins.detail.badge', () => ctx.slots.register({
    name: 'plugins.detail.badge',
    id: 'dsh-research-kit-badge',
  }, ResearchKitBadge)))
  disposers.push(ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
    name: 'plugins.detail.actions',
    id: 'dsh-research-kit-diagnostics',
  }, ResearchKitDiagnosticsAction)))
  // 跨页跳转（详情页 → 对话区「科研工作台」）依赖宿主公开的视图导航服务。
  // 与 Node half 的 ctx.get?.('tools') 同法软探测：旧宿主没有该服务时按钮整块不渲染，
  // 插件照常加载 —— 不把它写进 inject 列表，避免旧宿主因缺少服务而拒绝加载整个插件。
  const conversationViews = ctx.get?.('uiConversation')
  const openWorkbenchView = typeof conversationViews?.openView === 'function'
    ? (sessionId, view, focus) => conversationViews.openView(sessionId, view, focus)
    : null
  disposers.push(ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
    name: 'plugins.detail.actions',
    id: 'dsh-research-kit-open-workbench',
  }, props => React.createElement(ResearchKitOpenWorkbenchAction, { ...props, openView: openWorkbenchView }))))
  disposers.push(ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config', key: 'dsh-research-kit#dsh-research-kit',
  }, ResearchKitPresetConfig)))
  disposers.push(ctx.slots.inject('tool.call.toolview', () => {
    const toolDisposers = researchToolNames.map(key => ctx.slots.register({ name: 'tool.call.toolview', key }, ResearchToolView))
    return () => toolDisposers.forEach(dispose => dispose?.())
  }))
  let depositAssetProvider = null
  disposers.push(ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: 'dsh-research-kit-review-deposit', order: 90,
  }, props => React.createElement(ResearchMessageDepositAction, {
    ...props, sessions: ctx.sessions, assetProvider: () => depositAssetProvider,
  }))))
  // 自动沉淀：订阅 DSH 会话事件流（assistant/message = 一次回答完成），
  // 开启开关后自动提取知识入库。宿主未提供 sessions 服务时静默跳过（单测/独立页）。
  let active = true
  let disposeDeposition = () => {}
  loadPromptKit().then(PromptKit => {
    if (!active) return
    recordPromptKitLoadError(null)
    const providers = ensureResearchProviders(PromptKit)
    depositAssetProvider = providers.researchAssetProvider
    disposeDeposition = attachKnowledgeDeposition(ctx, { assetProvider: providers.researchAssetProvider }) || (() => {})
  }).catch(error => { /* PromptKit/沉淀接线失败不影响四个视图槽位 */
    // …但必须留痕：conversation.input.right 的草稿增强入口会因此整块静默收起。
    recordPromptKitLoadError(error)
  })
  disposers.push(() => { active = false; disposeDeposition() })
  return () => disposers.forEach(dispose => dispose?.())
}
