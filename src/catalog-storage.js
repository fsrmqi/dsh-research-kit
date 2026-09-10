// 浏览器本地偏好存储：收藏与使用历史。
// 经 CatalogStorage 接口隔离 localStorage，不污染 catalog.js 的纯函数职责（ARCHITECTURE 8.1）。
// 历史记录对齐 dsh-promptkit 的 pushHistory 形态：{ id, name, summary, at }，存 20 条，
// 但按本项目隐私原则只保存 ID、名称与用户自己输入的首行摘要，不保存完整 Prompt。
const FAVORITES_KEY = 'dsh-research-kit:favorites'
const HISTORY_KEY = 'dsh-research-kit:history'
const HISTORY_EVENT = 'dsh-research-kit:history-changed'
const MAX_HISTORY = 20

function safeStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage
  } catch { /* 隐私模式或宿主禁用时降级 */ }
  return null
}

function readStore(key, storage) {
  const store = storage || safeStorage()
  if (!store) return []
  try {
    const raw = JSON.parse(store.getItem(key) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}

function writeStore(key, value, storage) {
  const store = storage || safeStorage()
  if (!store) return false
  try { store.setItem(key, JSON.stringify(value)); return true } catch { return false }
}

function readIds(key, storage) {
  return readStore(key, storage).filter(id => typeof id === 'string')
}

export function createCatalogStorage({ storage } = {}) {
  const store = storage || safeStorage()
  const listeners = new Set()
  // window 在浏览器模块中总是存在；Node 半区或测试中可能未声明，需 typeof 守卫。
  const hasWindow = typeof window !== 'undefined' && !!window
  const notifyHistory = rows => {
    if (hasWindow) {
      try { window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: { key: HISTORY_KEY } })) } catch { /* 事件不可用时忽略 */ }
    }
    // 无 window 时直接同步通知已登记的监听者。
    for (const callback of listeners) { try { callback(rows) } catch { /* 单个监听者异常不阻断 */ } }
    return rows
  }
  return {
    getFavorites() { return readIds(FAVORITES_KEY, store) },
    toggleFavorite(id) {
      const current = readIds(FAVORITES_KEY, store)
      const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id]
      return writeStore(FAVORITES_KEY, next, store) ? next : current
    },
    /** 兼容旧接口：最近使用的 ID 序列（从历史记录派生）。 */
    getRecents() {
      const seen = new Set()
      const ids = []
      for (const row of readStore(HISTORY_KEY, store)) {
        if (row?.id && !seen.has(row.id)) { seen.add(row.id); ids.push(row.id) }
      }
      return ids
    },
    /**
     * 记录一次使用。entry: { id, name, summary? }；summary 只取首行且截断，
     * 去重置顶、截断到 MAX_HISTORY，并广播 history-changed 供界面即时刷新。
     */
    recordHistory(entry) {
      if (!entry?.id) return readStore(HISTORY_KEY, store)
      const summary = String(entry.summary || '').split('\n')[0].trim().slice(0, 80)
      const row = { id: entry.id, name: String(entry.name || ''), summary, at: Date.now() }
      const next = [row, ...readStore(HISTORY_KEY, store).filter(item => item?.id !== row.id)].slice(0, MAX_HISTORY)
      writeStore(HISTORY_KEY, next, store)
      return notifyHistory(next)
    },
    getHistory() { return readStore(HISTORY_KEY, store) },
    clearHistory() { writeStore(HISTORY_KEY, [], store); return notifyHistory([]) },
    onHistoryChange(callback) {
      const refresh = () => { try { callback(readStore(HISTORY_KEY, store)) } catch { /* 忽略 */ } }
      const onCustom = event => { if (event?.detail?.key === HISTORY_KEY) refresh() }
      const onStorage = event => { if (event?.key === HISTORY_KEY) refresh() }
      listeners.add(callback)
      if (hasWindow) {
        window.addEventListener(HISTORY_EVENT, onCustom)
        window.addEventListener('storage', onStorage)
      }
      return () => {
        listeners.delete(callback)
        if (hasWindow) {
          window.removeEventListener(HISTORY_EVENT, onCustom)
          window.removeEventListener('storage', onStorage)
        }
      }
    },
    clear() {
      if (!store) return
      try { store.removeItem(FAVORITES_KEY); store.removeItem(HISTORY_KEY) } catch { /* 忽略 */ }
      notifyHistory([])
    }
  }
}
