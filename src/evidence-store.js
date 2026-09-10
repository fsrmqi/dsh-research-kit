const MAX_QUERIES = 30
const MAX_WORKFLOWS = 30

// 证据索引只服务于当前页面中的同一 DSH 会话：不落 localStorage，避免研究来源
// 在刷新或重开页面后残留。按 sessionId 共享 state，保证工作台、查询面板和图谱
// 各自创建 store 时仍能互相实时通知。
// 顶层符号名必须全局唯一：构建器把所有模块拼进同一作用域（strip 掉 import，
// 符号靠拼接顺序可见），重名 const 会让整个产物语法错误。故加 evidence 前缀。
const evidenceSessions = new Map()

function keyFor(sessionId) { return String(sessionId || 'unscoped') }

function stateFor(sessionId) {
  const key = keyFor(sessionId)
  if (!evidenceSessions.has(key)) evidenceSessions.set(key, { queries: [], workflows: [], listeners: new Set() })
  return evidenceSessions.get(key)
}

export function createEvidenceStore(sessionId) {
  const state = stateFor(sessionId)
  const get = () => ({ queries: [...state.queries], workflows: [...state.workflows] })
  const publish = () => {
    const value = get()
    for (const listener of state.listeners) { try { listener(value) } catch {} }
    return value
  }
  const save = next => {
    state.queries = Array.isArray(next.queries) ? next.queries : []
    state.workflows = Array.isArray(next.workflows) ? next.workflows : []
    return publish()
  }
  return {
    get,
    recordQuery({ databaseId, databaseName, mode = 'direct', sources = [] }) {
      const current = get()
      const row = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, databaseId, databaseName, mode, at: Date.now(), sources: sources.slice(0, 8).map(source => ({ id: source.id, title: source.title, url: source.url, meta: source.meta })) }
      return save({ ...current, queries: [row, ...current.queries].slice(0, MAX_QUERIES) })
    },
    recordWorkflow({ id, name, resourceIds = [] }) {
      const current = get()
      const row = { id, name, resourceIds: [...new Set(resourceIds)], at: Date.now() }
      return save({ ...current, workflows: [row, ...current.workflows.filter(item => item.id !== id)].slice(0, MAX_WORKFLOWS) })
    },
    subscribe(listener) { state.listeners.add(listener); return () => state.listeners.delete(listener) },
    clear() { return save({ queries: [], workflows: [] }) }
  }
}
