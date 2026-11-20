// 回到会话使用宿主公开导航。视图标签由会话选择状态恢复，activate 只激活数据源。
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

/** 宿主只有在已绑定的会话且编辑器允许时才会接收原生文件引用。 */
export function researchMaterialInput({ sessions, conversation }, sessionId) {
  try {
    if (!sessionId) return null
    const binding = sessions?.binding?.(sessionId)
    const input = binding && conversation?.input?.for?.(binding.ctx)
    return typeof input?.addReferences === 'function' && typeof input.canInsertReferences === 'function' ? input : null
  } catch { return null }
}

export function insertResearchMaterial(host, sessionId, value) {
  const path = String(value || '').trim()
  const segments = path.split('/')
  if (!path || /[\u0000-\u001f\u007f-\u009f"\\:]/u.test(path)
    || segments.some(part => !part || part === '..') || segments.at(-1) === '.') {
    throw new Error('请输入工作区内的相对文件路径。')
  }
  const input = researchMaterialInput(host, sessionId)
  const ref = /\s/u.test(path) ? `@"${path}"` : `@${path}`
  if (!input?.canInsertReferences() || !input.addReferences([{
    source: 'reference', ref, label: segments.at(-1), appearance: 'file', clipboardText: ref,
  }])) throw new Error('当前会话暂时无法添加文件引用。')
}
