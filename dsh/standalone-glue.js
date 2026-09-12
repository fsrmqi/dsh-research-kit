import { ResearchConsole } from '../src/research-console.js'
import { ResearchComposerLauncher } from '../src/composer-launcher.js'
import { ResearchComposerOverlay } from '../src/composer-overlay.js'
import { registerResearchSlots } from './slot-registry.js'
import { attachKnowledgeDeposition } from '../src/knowledge-deposition.js'

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
  // 自动沉淀：订阅 DSH 会话事件流（assistant/message = 一次回答完成），
  // 开启开关后自动提取知识入库。宿主未提供 sessions 服务时静默跳过（单测/独立页）。
  try {
    disposers.push(attachKnowledgeDeposition(ctx, {
      // researchAssetProvider 是构建产物拼接作用域里的顶层符号（prompt-studio-glue.js 定义）；
      // 源码形态下不存在，用 typeof 守卫，避免 ReferenceError。
      assetProvider: typeof researchAssetProvider === 'undefined' ? null : researchAssetProvider,
    }))
  } catch { /* 沉淀接线失败不影响四个视图槽位 */ }
  return () => disposers.forEach(dispose => dispose?.())
}
