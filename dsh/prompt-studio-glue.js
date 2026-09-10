// PromptKit 的嵌入产物在构建时以 PromptKit 命名空间注入到同一浏览器工厂。
// Research Kit 使用独立 storagePrefix，避免污染或依赖独立 dsh-promptkit 的资产。
const researchMethodProvider = new PromptKit.StaticMethodProvider({ storagePrefix: 'dsh-research-kit.promptkit.' })
const researchAssetProvider = new PromptKit.StaticAssetProvider({ storagePrefix: 'dsh-research-kit.promptkit.' })

// 方法工坊只需要草稿读写和当前对话原料；项目记忆与跨会话摘要仍归草稿增强器，
// 避免两个入口争抢外部上下文。
class ResearchStudioComposer {
  constructor(input, inputActions) { this.input = input; this.inputActions = inputActions }
  getDraft() { return this.input?.draft ?? '' }
  write(text) { this.inputActions?.setDraft(String(text ?? '')) }
}

function ResearchPromptStudioHost(props) {
  const { sessionId, input, useInput, useChat, inputActions } = props
  const zonedDraft = input?.draft
  const hookedInput = useInput ? useInput(value => value) : undefined
  const draft = zonedDraft !== undefined ? zonedDraft : hookedInput?.draft
  const chatSnapshot = useChat ? useChat(value => value?.legacy ?? value) : undefined
  const messages = React.useMemo(() => PromptKit.utils.conversationMessages(chatSnapshot), [chatSnapshot])
  const composer = React.useMemo(() => new ResearchStudioComposer({ draft }, inputActions), [sessionId, inputActions])
  composer.input = { draft }
  const onSend = async text => {
    if (typeof inputActions?.setDraft !== 'function' || typeof inputActions?.submit !== 'function') {
      throw new Error('当前 DSH 会话尚未提供发送操作。')
    }
    inputActions.setDraft(String(text || ''))
    await inputActions.submit()
  }
  // 外层 .rk-studio-host 不承担业务职责，只为 style 源中的宽度解绑提供稳定锚点：
  // PromptStudio 根 <main> 内联了 1240px 阅读宽度上限，嵌入统一容器后会让本分区
  // 收成居中窄栏，与相邻两个铺满分区不一致（详见 src/theme.js 的同名规则注释）。
  return React.createElement('div', { className: 'rk-studio-host' },
    React.createElement(PromptKit.PromptStudio, {
      methodProvider: researchMethodProvider,
      assetProvider: researchAssetProvider,
      composer,
      messages,
      onSend,
      storagePrefix: 'dsh-research-kit.promptkit.'
    })
  )
}
