// DSH slot 注册表：纯数据 + 注册动作，不依赖 React，供 standalone-glue 与测试共用。
// 单一事实源：迁移文档第 7 节的注册表与此处一一对应。
//
// 视图槽位由 3 个收敛为 1 个：原「科研工作台 / 研究方法工坊 / 研究灵感库」三个并列标签
// 合并为统一视图 dsh-research-kit-console，内部分区导航见 src/lib/console-sections.js。
export const RESEARCH_SLOTS = [
  { slot: 'conversation.view', id: 'dsh-research-kit-console', order: 91, label: '科研工作台' },
  { slot: 'conversation.input.left', id: 'dsh-research-kit-launcher', order: 90, label: '科研工具' },
  { slot: 'conversation.input.overlay', id: 'dsh-research-kit-overlay', order: 90, label: '科研选择器' },
  // 草稿增强器：优先级低于模型选择器与发送按钮（order 较小 = 较次要）。
  { slot: 'conversation.input.right', id: 'dsh-research-kit-draft-enhancer', order: 80, label: '草稿增强' },
]

// 用给定的 slots 服务注册全部槽位；inject 回调立即执行（与 glue 行为一致）。
// components 数组与 RESEARCH_SLOTS 顺序一一对应，由 glue 传入 React 组件。
//
// 注册现场留痕：宿主上「某个入口没出现」时，先要分清是「inject 回调压根没跑」
// 还是「register 抛错」——二者在界面上都只是安静地少一块，排障时无从下手。
const SLOT_PROBE_KEY = 'dsh-research-kit.slots.probe.v1'
const slotProbe = []
function recordSlotProbe(text) {
  slotProbe.push(text)
  try { window.localStorage.setItem(SLOT_PROBE_KEY, slotProbe.join(' | ')) } catch { /* 存储不可用时无痕放弃 */ }
}

export function registerResearchSlots(ctx, components) {
  const registrations = []
  const disposers = RESEARCH_SLOTS.map((definition, index) =>
    ctx.slots.inject(definition.slot, () => {
      const options = {
        name: definition.slot,
        id: definition.id,
        order: definition.order,
        label: () => definition.label
      }
      registrations.push({ options, component: components[index] })
      try {
        const dispose = ctx.slots.register(options, components[index])
        recordSlotProbe(`${definition.id}=ok`)
        return dispose
      } catch (error) {
        recordSlotProbe(`${definition.id}=error:${String(error?.message || error)}`)
        throw error
      }
    })
  )
  return () => disposers.forEach(dispose => dispose?.())
}
