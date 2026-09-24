import { getPromptKit, loadPromptKit, promptKitReady } from '../src/promptkit-loader.js'
import { canWriteDraft, writeDraftText } from '../src/lib/input-actions.js'

// Provider 只在 PromptKit 首次加载后创建；独立 storagePrefix 避免污染或依赖独立
// dsh-promptkit 的资产。三个消费入口共用这两个实例。
let researchMethodProvider = null
let researchAssetProvider = null

export function ensureResearchProviders(PromptKit = getPromptKit()) {
  if (!researchMethodProvider) researchMethodProvider = new PromptKit.StaticMethodProvider({ storagePrefix: 'dsh-research-kit.promptkit.' })
  if (!researchAssetProvider) researchAssetProvider = new PromptKit.StaticAssetProvider({ storagePrefix: 'dsh-research-kit.promptkit.' })
  return { researchMethodProvider, researchAssetProvider }
}

// 方法工坊只需要草稿读写和当前对话原料；项目记忆与跨会话摘要仍归草稿增强器，
// 避免两个入口争抢外部上下文。
class ResearchStudioComposer {
  constructor(input, inputActions) { this.input = input; this.inputActions = inputActions }
  getDraft() { return this.input?.draft ?? '' }
  write(text) { return writeDraftText(this.inputActions, text).ok }
}

function LoadedResearchPromptStudioHost(props) {
  const PromptKit = getPromptKit()
  ensureResearchProviders(PromptKit)
  const { sessionId, input, useInput, useChat, inputActions } = props
  const zonedDraft = input?.draft
  const hookedInput = useInput ? useInput(value => value) : undefined
  const draft = zonedDraft !== undefined ? zonedDraft : hookedInput?.draft
  const chatSnapshot = useChat ? useChat(value => value?.legacy ?? value) : undefined
  const messages = React.useMemo(() => PromptKit.utils.conversationMessages(chatSnapshot), [chatSnapshot])
  const composer = React.useMemo(() => new ResearchStudioComposer({ draft }, inputActions), [sessionId, inputActions])
  composer.input = { draft }
  const onSend = async text => {
    if (!canWriteDraft(inputActions) || typeof inputActions?.submit !== 'function') {
      throw new Error('当前 DSH 会话尚未提供发送操作。')
    }
    if (!writeDraftText(inputActions, text).ok) throw new Error('草稿已变化，未自动发送；请复制后手动粘贴。')
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

function ResearchPromptStudioHost(props) {
  const [state, setState] = React.useState(() => promptKitReady() ? 'ready' : 'loading')
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let active = true
    loadPromptKit().then(PromptKit => {
      ensureResearchProviders(PromptKit)
      if (active) setState('ready')
    }).catch(reason => {
      if (active) { setError(reason?.message || String(reason)); setState('error') }
    })
    return () => { active = false }
  }, [])
  if (state === 'error') return React.createElement(Notice, { tone: 'error' }, error)
  if (state !== 'ready') return React.createElement(Spinner, { text: '正在加载研究方法工坊……' })
  return React.createElement(LoadedResearchPromptStudioHost, props)
}
