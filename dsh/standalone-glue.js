import { ResearchConsole } from '../src/research-console.js'
import { ResearchComposerLauncher } from '../src/composer-launcher.js'
import { ResearchComposerOverlay } from '../src/composer-overlay.js'
import { registerResearchSlots } from './slot-registry.js'
import { attachKnowledgeDeposition } from '../src/knowledge-deposition.js'
import { ResearchPluginStatusSection, ResearchKitBadge, ResearchKitDiagnosticsAction, ResearchKitOpenWorkbenchAction, ResearchKitPresetConfig, RESEARCH_KIT_CONSOLE_VIEW } from '../src/plugin-status.js'
import { ResearchToolView, researchToolNames } from '../src/research-toolview.js'
import { ResearchMessageDepositAction } from '../src/message-deposit-action.js'
import { launchResearchSession, returnToConversation, supportsSessionLaunch } from '../src/lib/host-navigation.js'

export function researchKitApply(ctx) {
  // 可选宿主服务只软探测（与 dsh/optional-service.js 同一规则）：写进 dsh.client.inject 会让缺该
  // 服务的旧宿主拒绝装载整个插件；这里缺任何一个都只是让对应入口降级/不渲染。
  // 草稿初始化通道在 `conversation` 服务上（`uiConversation` 没有 input），别把两者混为一谈。
  const hostNavigation = {
    uiWorkspace: ctx.get?.('uiWorkspace'),
    uiConversation: ctx.get?.('uiConversation'),
    conversation: ctx.get?.('conversation'),
    sessions: ctx.sessions,
  }
  // Plugins 详情页「回到会话」：主区切回当前会话（视图标签由宿主持久化状态决定，跨页无法代选）。
  // 通道缺失时按钮整块不渲染 —— 留一个点了没反应的死按钮比没有更糟。
  const openConversation = typeof hostNavigation.uiWorkspace?.openSession === 'function'
    ? () => returnToConversation({ ...hostNavigation, view: RESEARCH_KIT_CONSOLE_VIEW })
    : null
  // 开新会话并预填草稿：0.2.1-rc.1 起有 prompt 通道，whenDraftExists 语义 0.2.1-rc.3 起
  // （0.1.7 / 0.2.0 线没有该通道，因此不显示入口）。
  const launchSession = supportsSessionLaunch(hostNavigation)
    ? input => launchResearchSession(hostNavigation, input)
    : null
  // 唯一视图：内部按分区渲染「资源与工作流 / 方法工坊 / 研究资产库 / 研究证据图谱」。
  function ResearchConsoleHost(props) {
    return React.createElement(ResearchConsole, { ...props, launchSession })
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
  // 跨页跳转（详情页 → 当前会话）依赖宿主公开的会话导航服务；服务探测在
  // src/lib/host-navigation.js 里，通道缺失时按钮整块不渲染、插件照常加载。
  disposers.push(ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
    name: 'plugins.detail.actions',
    id: 'dsh-research-kit-open-workbench',
  }, props => React.createElement(ResearchKitOpenWorkbenchAction, { ...props, open: openConversation }))))
  disposers.push(ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config', key: 'dsh-research-kit#dsh-research-kit',
  }, ResearchKitPresetConfig)))
  disposers.push(ctx.slots.inject('tool.call.toolview', () => {
    const toolDisposers = researchToolNames.map(key => ctx.slots.register({ name: 'tool.call.toolview', key }, ResearchToolView))
    return () => toolDisposers.forEach(dispose => dispose?.())
  }))
  // 沉淀真正需要资产时再加载工件；注册事件订阅不应触发首屏下载。
  const resolveDepositProvider = async () => {
    try {
      const PromptKit = await loadPromptKit()
      recordPromptKitLoadError(null)
      return ensureResearchProviders(PromptKit).researchAssetProvider
    } catch (error) { recordPromptKitLoadError(error); throw error }
  }
  const depositAssetProvider = {
    list: async () => (await resolveDepositProvider()).list(),
    save: async input => (await resolveDepositProvider()).save(input),
  }
  disposers.push(ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: 'dsh-research-kit-review-deposit', order: 90,
  }, props => React.createElement(ResearchMessageDepositAction, {
    ...props, sessions: ctx.sessions, assetProvider: () => depositAssetProvider,
  }))))
  // 自动沉淀：订阅 DSH 会话事件流（assistant/message = 一次回答完成），
  // 开启开关后自动提取知识入库。宿主未提供 sessions 服务时静默跳过（单测/独立页）。
  const disposeDeposition = attachKnowledgeDeposition(ctx, { assetProvider: depositAssetProvider }) || (() => {})
  disposers.push(disposeDeposition)
  return () => disposers.forEach(dispose => dispose?.())
}
