// 全局轻提示（Toast）状态源：无外部依赖、SSR 安全。
// 操作结果在视口底部即时反馈，并对可逆操作（清空表单、忽略提案等）提供一键「撤销」。

const MAX_TOASTS = 3
const DEFAULT_DURATION_MS = 5000

let nextToastId = 1
let activeToasts = []
const listeners = new Set()
const timers = new Map()

function emit() {
  const snapshot = activeToasts
  for (const listener of [...listeners]) {
    try { listener(snapshot) } catch { /* 单个订阅者异常不影响其他视图 */ }
  }
}

export function getToasts() {
  return activeToasts
}

export function subscribeToasts(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function dismissToast(id) {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  const next = activeToasts.filter(item => item.id !== id)
  if (next.length === activeToasts.length) return false
  activeToasts = next
  emit()
  return true
}

export function clearToasts() {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  if (!activeToasts.length) return
  activeToasts = []
  emit()
}

/**
 * 推送一条全局轻提示。
 * @param {{ message: string, tone?: 'info'|'warn'|'error', actionLabel?: string, onAction?: () => void, durationMs?: number }} options
 */
export function pushToast(options) {
  const message = String(options?.message || '').trim()
  if (!message) return ''
  const id = `rk-toast-${nextToastId++}`
  const tone = options?.tone === 'error' || options?.tone === 'warn' ? options.tone : 'info'
  const actionLabel = options?.actionLabel ? String(options.actionLabel) : ''
  const onAction = typeof options?.onAction === 'function' ? options.onAction : null
  const durationMs = Number.isFinite(Number(options?.durationMs))
    ? Math.max(0, Number(options.durationMs))
    : (onAction ? 6500 : DEFAULT_DURATION_MS)

  const entry = { id, message, tone, actionLabel, onAction }
  const next = [...activeToasts, entry]
  while (next.length > MAX_TOASTS) {
    const dropped = next.shift()
    const oldTimer = timers.get(dropped.id)
    if (oldTimer) { clearTimeout(oldTimer); timers.delete(dropped.id) }
  }
  activeToasts = next
  emit()

  if (durationMs > 0) {
    const timer = setTimeout(() => dismissToast(id), durationMs)
    timers.set(id, timer)
  }
  return id
}
