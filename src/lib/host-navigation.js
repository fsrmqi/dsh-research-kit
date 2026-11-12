// 宿主导航与草稿初始化（浏览器半）：把「回到会话」与「开新会话并预填草稿」收敛成可测的纯函数。
//
// 用到的宿主公开 API：
//   - `uiWorkspace.openSession(target)`   切换主区到指定会话（同步 retain）；
//   - `uiConversation.binding(id).activate(view)` 把目标视图加入该会话的活跃目标集（**不是**选中标签页，
//     见下）；
//   - `uiWorkspace.startSession(ws, options)` 新建会话并预填草稿（`prompt` 自 0.2.1-rc.1 起，
//     `whenDraftExists` 自 0.2.1-rc.3 起被识别），草稿初始化由 `conversation.input.requestDraftInitialization` 承担。
//
// 视图标签是宿主自己的 UI 状态：会话 store 的 `s.view` 决定渲染哪个视图，`binding.activate()` 只保证该目标
// 的数据源被激活。因此跨页无法可靠地「选中科研工作台标签」——只有该会话此前停在科研工作台（宿主持久化了这个
// 选择）时，回到会话才会一并恢复。入口文案按这个事实写「回到会话」，不承诺选标签。
//
// 服务是否装配仍要软探测：旧宿主 / 无 UI 装配时返回 false，调用方按「该入口不渲染」降级，
// 绝不让探测反过来打断插件装载（与 dsh/optional-service.js 的三条规则一致；本文件进浏览器产物，
// 因此不 import 宿主半区的 optional-service）。

/** 在会话列表快照里找主区当前持有的会话；宿主内置客户端也这样取（DocumentTitle / ui-open-in-app）。 */
export function currentMainSessionId(sessions) {
  try {
    const state = sessions?.list?.getSnapshot?.()
    const rows = state?.byId && typeof state.byId === 'object' ? state.byId : {}
    for (const row of Object.values(rows)) {
      if (Number(row?.retainedBy?.mainView ?? 0) > 0 && typeof row?.id === 'string' && row.id) return row.id
    }
  } catch { /* 快照不可读时按「没有当前会话」处理 */ }
  return ''
}

/**
 * 把主区切回当前会话，并尽力把科研工作台视图标记为活跃目标。
 *
 * 顺序不能反：`openSession` 同步 retain 目标会话并把主区切回 Conversation，之后
 * `binding(id)` 才是「当前代」；先 binding 会抛 `inactive session`。
 *
 * @returns 是否已把主区切回会话；通道缺失或没有当前会话时为 false（调用方据此提示降级）。
 */
export function returnToConversation({ uiWorkspace, uiConversation, sessions, view } = {}) {
  if (typeof uiWorkspace?.openSession !== 'function') return false
  const sessionId = currentMainSessionId(sessions)
  if (!sessionId) return false
  try {
    uiWorkspace.openSession(sessionId)
  } catch { return false }
  // 视图激活是加分项：宿主没有绑定服务、或该视图尚未注册时不得把「已切回会话」判成失败。
  try {
    const binding = typeof uiConversation?.binding === 'function' ? uiConversation.binding(sessionId) : null
    if (typeof binding?.activate === 'function') binding.activate(String(view ?? ''))
  } catch { /* 标签选中由宿主持久化状态决定，这里失败不影响导航结果 */ }
  return true
}

/**
 * 宿主是否支持「开新会话并把内容预填成草稿」。
 *
 * 探测两条：`uiWorkspace.startSession`（承载 `prompt`）与 **`conversation` 服务**的
 * `input.requestDraftInitialization`（真正写草稿的通道；注意不是 `uiConversation`——它没有 `input`）。
 * 两者都自 DSH 0.2.1-rc.1 起存在；0.1.7 / 0.2.0 线缺失，因此这两条线不显示该入口。
 * `whenDraftExists` 语义需 0.2.1-rc.3+：更早宿主会保留已有草稿（本入口新开会话、草稿为空，照常预填）。
 */
export function supportsSessionLaunch({ uiWorkspace, conversation } = {}) {
  return typeof uiWorkspace?.startSession === 'function'
    && typeof conversation?.input?.requestDraftInitialization === 'function'
}

/**
 * 开一个新会话并预填研究提示词（不自动发送）。
 *
 * `whenDraftExists` 默认 `append`：0.2.1-rc.3+ 上已有文字/内联引用保留原文并另起段落追加，附件始终保留；
 * 更早宿主不识别该字段，按「已有草稿则保留」处理。
 *
 * @returns 是否已发出导航请求；提示词为空或通道缺失时为 false，调用方据此提示降级。
 */
export function launchResearchSession({ uiWorkspace, conversation } = {}, { prompt, whenDraftExists = 'append' } = {}) {
  const text = String(prompt ?? '')
  if (!text.trim()) return false
  if (!supportsSessionLaunch({ uiWorkspace, conversation })) return false
  try {
    uiWorkspace.startSession(undefined, { prompt: text, whenDraftExists })
    return true
  } catch { return false }
}
