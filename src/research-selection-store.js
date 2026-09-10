// 每个 DSH 会话共享的临时资源选择。只驻留在当前页面内存：不写入 localStorage，
// 不跨会话泄露研究上下文；完整工作台与输入框浮层通过同一个 sessionId 读取它。
const sessions = new Map()

function keyFor(sessionId) { return String(sessionId || 'unscoped') }

function stateFor(sessionId) {
  const key = keyFor(sessionId)
  if (!sessions.has(key)) sessions.set(key, { ids: [], listeners: new Set() })
  return sessions.get(key)
}

export function createResearchSelectionStore(sessionId) {
  const state = stateFor(sessionId)
  const publish = () => {
    const ids = [...state.ids]
    for (const listener of state.listeners) { try { listener(ids) } catch {} }
    return ids
  }
  return {
    get() { return [...state.ids] },
    set(next) {
      const resolved = typeof next === 'function' ? next([...state.ids]) : next
      state.ids = [...new Set(Array.isArray(resolved) ? resolved.filter(id => typeof id === 'string') : [])]
      return publish()
    },
    toggle(id) {
      return this.set(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
    },
    clear() { return this.set([]) },
    subscribe(listener) {
      state.listeners.add(listener)
      return () => state.listeners.delete(listener)
    }
  }
}
