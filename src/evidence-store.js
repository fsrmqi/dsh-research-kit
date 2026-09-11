const MAX_QUERIES = 30
const MAX_WORKFLOWS = 30

// 证据索引只服务于当前页面中的同一 DSH 会话：不落 localStorage，避免研究来源
// 在刷新或重开页面后残留。按 sessionId 共享 state，保证工作台、查询面板和图谱
// 各自创建 store 时仍能互相实时通知。
// 顶层符号名必须全局唯一：构建器把所有模块拼进同一作用域（strip 掉 import，
// 符号靠拼接顺序可见）。重名 const 会让整个产物语法错误，而重名 function 更阴险——
// 声明合法、静默覆盖，产物照样通过 node --check，直到运行到调用点才炸。
const evidenceSessions = new Map()
const MAX_EVIDENCE_SESSIONS = 100

function evidenceKeyFor(sessionId) { return String(sessionId || 'unscoped') }

function evidenceStateFor(sessionId) {
  const key = evidenceKeyFor(sessionId)
  if (!evidenceSessions.has(key)) evidenceSessions.set(key, { queries: [], workflows: [], plans: [], listeners: new Set() })
  const state = evidenceSessions.get(key)
  evidenceSessions.delete(key)
  evidenceSessions.set(key, state)
  while (evidenceSessions.size > MAX_EVIDENCE_SESSIONS) {
    const oldest = evidenceSessions.entries().next().value
    if (!oldest || oldest[1].listeners.size) break
    evidenceSessions.delete(oldest[0])
  }
  return state
}

export function createEvidenceStore(sessionId) {
  const state = evidenceStateFor(sessionId)
  const get = () => ({ queries: [...state.queries], workflows: [...state.workflows], plans: [...state.plans] })
  const publish = () => {
    const value = get()
    for (const listener of state.listeners) { try { listener(value) } catch {} }
    return value
  }
  const save = next => {
    state.queries = Array.isArray(next.queries) ? next.queries : []
    state.workflows = Array.isArray(next.workflows) ? next.workflows : []
    state.plans = Array.isArray(next.plans) ? next.plans : []
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
    recordPlan({ workflowId, name, stages = [] }) {
      const current = get()
      const previous = current.plans.find(plan => plan.id === workflowId)
      const row = { id: workflowId, name, stages: stages.map((label, index) => ({ label, done: previous?.stages[index]?.label === label ? previous.stages[index].done : false })), at: Date.now() }
      return save({ ...current, plans: [row, ...current.plans.filter(item => item.id !== workflowId)] })
    },
    togglePlanStage(planId, index) {
      const current = get()
      return save({ ...current, plans: current.plans.map(plan => plan.id !== planId ? plan : { ...plan, stages: plan.stages.map((stage, i) => i === index ? { ...stage, done: !stage.done } : stage) }) })
    },
    subscribe(listener) { state.listeners.add(listener); return () => state.listeners.delete(listener) },
    clear() { return save({ queries: [], workflows: [], plans: [] }) }
  }
}
