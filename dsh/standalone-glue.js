import { ResearchConsole } from '../src/research-console.js'
import { ResearchComposerLauncher } from '../src/composer-launcher.js'
import { ResearchComposerOverlay } from '../src/composer-overlay.js'
import { registerResearchSlots } from './slot-registry.js'

export function researchKitApply(ctx) {
  // 唯一视图：内部按分区渲染「资源与工作流 / 方法工坊 / 研究灵感库 / 研究证据图谱」。
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
  return () => disposers.forEach(dispose => dispose?.())
}
