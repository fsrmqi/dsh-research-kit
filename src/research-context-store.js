// 研究上下文是各分区的最小共同语言：只保存项目名和运行元数据，绝不保存
// Prompt、文件内容、检索词或模型输出。它不替代证据库/资产库，只负责回答
// 「当前正在为哪个项目、通过哪一次研究运行工作」。
import { workspaceIdForProject } from './lib/research-workspaces.js'

const RESEARCH_CONTEXT_KEY = 'dsh-research-kit.research-context.v1'
const RESEARCH_RUNS_KEY = 'dsh-research-kit.research-runs.v1'
export const MAX_RESEARCH_RUNS = 500

let contextMemory = { project: '', activeRunId: '' }
const contextListeners = new Set()

function safeStorageGet(key) {
  try { return globalThis.localStorage?.getItem(key) || '' } catch { return '' }
}

function safeStorageSet(key, value) {
  try { globalThis.localStorage?.setItem(key, value) } catch { /* 私有模式下仅保留进程内状态 */ }
}

function normalizeProject(value) {
  return String(value || '').trim().slice(0, 100)
}

function normalizeContext(value) {
  return {
    project: normalizeProject(value?.project),
    activeRunId: String(value?.activeRunId || '').trim(),
  }
}

function readContext() {
  try {
    const raw = safeStorageGet(RESEARCH_CONTEXT_KEY)
    if (raw) contextMemory = normalizeContext(JSON.parse(raw))
  } catch { /* 损坏的偏好不应阻断工作台 */ }
  return { ...contextMemory }
}

function publishContext() {
  const value = { ...contextMemory }
  for (const listener of contextListeners) { try { listener(value) } catch {} }
  return value
}

export function currentResearchContext() {
  return readContext()
}

export function setResearchContext(next = {}) {
  contextMemory = normalizeContext({ ...readContext(), ...next })
  safeStorageSet(RESEARCH_CONTEXT_KEY, JSON.stringify(contextMemory))
  return publishContext()
}

export function setResearchProject(project) {
  return setResearchContext({ project: normalizeProject(project) })
}

export function subscribeResearchContext(listener) {
  contextListeners.add(listener)
  return () => contextListeners.delete(listener)
}

function readRuns() {
  try {
    const rows = JSON.parse(safeStorageGet(RESEARCH_RUNS_KEY) || '[]')
    return Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object')
      .map(row => ({ ...row, workspaceId: workspaceIdForProject(row.project) })) : []
  } catch { return [] }
}

function writeRuns(runs) {
  safeStorageSet(RESEARCH_RUNS_KEY, JSON.stringify(runs.slice(0, MAX_RESEARCH_RUNS)))
  return runs.slice(0, MAX_RESEARCH_RUNS)
}

function runId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// 运行只在用户明确使用工作流时创建。copy/draft/active 是 UI 事实，不代表模型
// 或工具已经执行；真正的执行证据仍来自 MCP 调用日志与 checkpoint。
export function startResearchRun({ project, sessionId = '', workflowId, workflowName, stages = [], status = 'draft', now = Date.now() } = {}) {
  const context = currentResearchContext()
  const resolvedProject = normalizeProject(project === undefined ? context.project : project)
  const run = {
    id: runId(), project: resolvedProject, workspaceId: workspaceIdForProject(resolvedProject), sessionId: String(sessionId || ''),
    workflowId: String(workflowId || ''), workflowName: String(workflowName || ''),
    stages: (Array.isArray(stages) ? stages : []).map(label => String(label)).filter(Boolean).slice(0, 30),
    status: ['draft', 'active', 'waiting_review', 'completed', 'failed'].includes(status) ? status : 'draft',
    createdAt: now, updatedAt: now,
  }
  writeRuns([run, ...readRuns()])
  setResearchContext({ project: resolvedProject, activeRunId: run.id })
  return run
}

export function activeResearchRun() {
  const context = currentResearchContext()
  return readRuns().find(run => run.id === context.activeRunId) || null
}

export function listResearchRuns({ project, sessionId } = {}) {
  return readRuns().filter(run =>
    (project === undefined || run.project === normalizeProject(project)) &&
    (sessionId === undefined || run.sessionId === String(sessionId || ''))
  )
}

// App 迁移只补入缺失运行；既有运行的状态和当前活跃运行都不被旧备份覆盖。
export function importResearchRuns(incoming = []) {
  const rows = readRuns()
  const known = new Set(rows.map(row => row.id))
  const added = []
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    if (!raw || typeof raw.id !== 'string' || !raw.id || known.has(raw.id)) continue
    const project = normalizeProject(raw.project)
    added.push({ ...raw, project, workspaceId: workspaceIdForProject(project) })
    known.add(raw.id)
  }
  writeRuns([...rows, ...added])
  return { added: added.length, skipped: incoming.length - added.length }
}

export function remapResearchRuns(mappings, { dryRun = false } = {}) {
  const map = new Map(mappings.map(item => [item.from, item.to]))
  const before = readRuns()
  const after = before.map(run => map.has(run.project)
    ? { ...run, project: map.get(run.project), workspaceId: workspaceIdForProject(map.get(run.project)), legacyProject: run.legacyProject || run.project }
    : run)
  const contextBefore = currentResearchContext()
  const contextAfter = map.has(contextBefore.project)
    ? { ...contextBefore, project: map.get(contextBefore.project) } : contextBefore
  if (dryRun) return { before, after, contextBefore, contextAfter }
  writeRuns(after)
  if (map.has(contextBefore.project)) setResearchProject(map.get(contextBefore.project))
  return { before, after, contextBefore, contextAfter: currentResearchContext() }
}

export function restoreResearchRuns(snapshot, { validateOnly = false } = {}) {
  const currentRuns = JSON.stringify(readRuns())
  const currentContext = JSON.stringify(currentResearchContext())
  if (![JSON.stringify(snapshot.after), JSON.stringify(snapshot.before)].includes(currentRuns)
    || ![JSON.stringify(snapshot.contextAfter), JSON.stringify(snapshot.contextBefore)].includes(currentContext)) {
    throw new Error('研究运行在整理后已变化，不能自动撤销。')
  }
  if (validateOnly) return true
  writeRuns(snapshot.before)
  setResearchContext(snapshot.contextBefore)
  return true
}
