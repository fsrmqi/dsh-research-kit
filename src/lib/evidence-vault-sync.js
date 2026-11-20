// 研究证据库（ROADMAP §4）：把用户明确保存、可追溯的外部来源沉淀下来。
//
// 与灵感资产的边界：灵感资产回答「想过什么」，证据库回答「依据什么」。
// 隐私边界（不可协商，与 ROADMAP §4 一致）：
//   - 只入库用户逐条确认的元数据与主动写下的笔记；禁止自动入库；
//   - 不保存 API 原始响应、全文或附件；检索词仅在用户点击“记录本次检索”后写入账本；
//   - 保存不等于认可，新条目一律落到「未核验」。
//
// 本文件是存取层（状态与订阅 / 文件同步 / 保存删除 / 互链 / 当前项目）；界面层在
// src/research-evidence-vault.js，保存表单与面板只调用本模块的导出。
import { C } from '../theme.js'
import { activeResearchRun, currentResearchContext, setResearchProject } from '../research-context-store.js'
import { createEvidenceVaultStore } from '../evidence-vault-store.js'
import { fileEvidenceSourceIdentity } from './file-evidence-source.js'
import { workspaceIdForProject } from './research-workspaces.js'

// 研究证据库（ROADMAP §4）：把用户明确保存、可追溯的外部来源沉淀下来。
//
// 与灵感资产的边界：灵感资产回答「想过什么」，证据库回答「依据什么」。
// 隐私边界（不可协商，与 ROADMAP §4 一致）：
//   - 只入库用户逐条确认的元数据与主动写下的笔记；禁止自动入库；
//   - 不保存 API 原始响应、全文或附件；检索词仅在用户点击“记录本次检索”后写入账本；
//   - 保存不等于认可，新条目一律落到「未核验」。

// 单例 + 订阅：保存入口在查询面板（分区①），列表在本面板（沉淀层），
// 两者不在同一棵子树里，靠模块级 store 与监听保持同步。
let sharedStore = null
const listeners = new Set()

export function evidenceVaultStore() {
  if (!sharedStore) sharedStore = createEvidenceVaultStore()
  return sharedStore
}

export function subscribeEvidenceVault(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishEvidenceVault() {
  for (const listener of listeners) { try { listener() } catch { /* 单个监听失败不影响其余 */ } }
}

const EVIDENCE_SYNC_PATH = '/dsh-research-kit/evidence-sync'
const EVIDENCE_SYNC_FRESH_MS = 8_000
const EVIDENCE_SYNC_CACHE_LIMIT = 64
const evidenceSyncInFlight = new Map()
const evidenceSyncFreshUntil = new Map()

function evidenceSyncScope(project) {
  return String(project || '*')
}

function pruneEvidenceSyncCache(now = Date.now()) {
  for (const [scope, until] of evidenceSyncFreshUntil) {
    if (until <= now) evidenceSyncFreshUntil.delete(scope)
  }
  while (evidenceSyncFreshUntil.size > EVIDENCE_SYNC_CACHE_LIMIT) {
    evidenceSyncFreshUntil.delete(evidenceSyncFreshUntil.keys().next().value)
  }
}

export function invalidateEvidenceSync(project) {
  if (project) {
    evidenceSyncFreshUntil.delete(evidenceSyncScope(project))
    evidenceSyncFreshUntil.delete(`${evidenceSyncScope(project)}:pull`)
    evidenceSyncFreshUntil.delete(`${evidenceSyncScope(project)}:allow-existing`)
  }
  // 全量读取覆盖任意项目；任一项目写入后都必须让全量缓存失效。
  evidenceSyncFreshUntil.delete('*')
  evidenceSyncFreshUntil.delete('*:pull')
  evidenceSyncFreshUntil.delete('*:allow-existing')
}

function canUseFileSync() {
  return typeof window !== 'undefined' && typeof fetch === 'function'
}

export function fileEvidenceInput(entry) {
  return {
    id: entry.id,
    title: entry.title,
    bibliography: entry.bibliography || {},
    sourceDatabase: entry.source_database || entry.sourceDatabase || 'MCP Agent',
    identifier: entry.identifier,
    identifierKind: entry.identifier_type || entry.identifierKind || 'accession',
    url: entry.url,
    savedAt: entry.saved_at ? Date.parse(entry.saved_at) : undefined,
    updatedAt: entry.updated_at ? Date.parse(entry.updated_at) : undefined,
    project: entry.project === 'default' && entry.workspace_id === 'workspace:unassigned' ? '' : entry.project || 'default',
    workspaceId: entry.workspace_id || entry.workspaceId || '',
    legacyProject: entry.legacy_project || entry.legacyProject || '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    reason: entry.reason || '',
    note: entry.note || '',
    status: entry.status || 'unverified',
    grade: entry.grade || 'ungraded',
    traceability: entry.traceability,
    sourceVerification: entry.source_verification || entry.sourceVerification || entry.status || 'unverified',
    studyType: entry.study_type || entry.studyType,
    claimSupport: entry.claim_support || entry.claimSupport,
    strength: entry.strength || entry.grade,
    assessedAt: entry.assessed_at ? Date.parse(entry.assessed_at) : undefined,
    assessedBy: entry.assessed_by || entry.assessedBy || '',
    assessmentReason: entry.assessment_reason || entry.assessmentReason || '',
    agentAssessment: entry.agent_assessment || entry.agentAssessment || null,
    agentAssessmentHistory: entry.agent_assessment_history || entry.agentAssessmentHistory || [],
    sourceCheck: entry.source_check || entry.sourceCheck || null,
    sourceCheckHistory: entry.source_check_history || entry.sourceCheckHistory || [],
    classification: entry.classification || null,
    agentProduced: entry.source === 'mcp-agent' || entry.agentProduced === true,
    runId: entry.run_id || entry.runId || '',
  }
}

export function vaultEvidenceFileEntry(entry) {
  return {
    id: entry.id,
    identifier_type: entry.identifierKind || 'accession',
    identifier: entry.identifier || '',
    title: entry.title,
    bibliography: entry.bibliography || {},
    source_database: entry.sourceDatabase || '',
    url: entry.url || '',
    tags: entry.tags || [],
    reason: entry.reason || '',
    note: entry.note || '',
    project: entry.project || 'default',
    workspace_id: entry.workspaceId || workspaceIdForProject(entry.project || ''),
    legacy_project: entry.legacyProject || '',
    grade: entry.grade || 'ungraded',
    status: entry.status || 'unverified',
    source_verification: entry.sourceVerification || entry.status || 'unverified',
    traceability: entry.traceability || 'identified',
    study_type: entry.studyType || 'unknown',
    claim_support: entry.claimSupport || 'unassessed',
    strength: entry.strength || entry.grade || 'ungraded',
    assessed_at: entry.assessedAt ? new Date(entry.assessedAt).toISOString() : '',
    assessed_by: entry.assessedBy || '',
    assessment_reason: entry.assessmentReason || '',
    agent_assessment: entry.agentAssessment || null,
    agent_assessment_history: entry.agentAssessmentHistory || [],
    source_check: entry.sourceCheck || null,
    source_check_history: entry.sourceCheckHistory || [],
    classification: entry.classification || null,
    source: entry.agentProduced ? 'mcp-agent' : 'dsh-ui',
    run_id: entry.runId || '',
    saved_at: new Date(entry.savedAt || Date.now()).toISOString(),
    updated_at: new Date(entry.updatedAt || entry.savedAt || Date.now()).toISOString(),
  }
}

export function evidenceSyncKey(entry) {
  const project = String(entry.workspaceId || entry.workspace_id || workspaceIdForProject(entry.project || '')).trim()
  const identifier = String(entry.identifier || '').trim().toLowerCase()
  if (identifier) return `${project}::${entry.identifierKind || entry.identifier_type || 'accession'}:${identifier}`
  const url = String(entry.url || '').trim().toLowerCase().replace(/\/$/, '')
  if (url) return `${project}::url:${url}`
  return `${project}::title:${String(entry.title || '').slice(0, 80).toLowerCase()}`
}

async function fetchFileEvidenceEntries(project) {
  const query = project ? `?project=${encodeURIComponent(project)}` : ''
  const response = await fetch(`${EVIDENCE_SYNC_PATH}${query}`, { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  if (!payload?.ok || !Array.isArray(payload.entries)) throw new Error(payload?.error || 'invalid_response')
  return payload.entries
}

async function postFileEvidenceEntries(entries, { allowExistingSources = false, reconcileExisting = false } = {}) {
  const byProject = new Map()
  for (const entry of entries) {
    const project = entry.project || 'default'
    if (!byProject.has(project)) byProject.set(project, [])
    byProject.get(project).push(entry)
  }
  let existingSources = 0
  const chunks = []
  for (const [project, rows] of byProject) {
    let chunk = [], bytes = 0
    for (const row of rows) {
      const size = new TextEncoder().encode(JSON.stringify(row)).length
      if (chunk.length && (bytes + size > 500000 || chunk.length >= 100)) { chunks.push([project, chunk]); chunk = []; bytes = 0 }
      chunk.push(row); bytes += size
    }
    if (chunk.length) chunks.push([project, chunk])
  }
  for (const [project, rows] of chunks) {
    const response = await fetch(EVIDENCE_SYNC_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, entries: rows }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const result = await response.json()
    const added = Number(result?.added)
    const skipped = Number(result?.skipped)
    if (!result?.ok || !Number.isInteger(added) || !Number.isInteger(skipped)
      || added < 0 || skipped < 0 || added + skipped !== rows.length) {
      throw new Error('文件侧返回的证据同步数量与请求不符。')
    }
    if (skipped && !allowExistingSources) {
      const stored = reconcileExisting ? await fetchFileEvidenceEntries(project) : []
      const storedKeys = new Set(stored.map(fileEvidenceSourceIdentity))
      if (!rows.every(row => storedKeys.has(fileEvidenceSourceIdentity(row)))) {
        throw new Error('文件侧存在未能确认的重复来源。请在证据库复核相关条目。')
      }
    }
    existingSources += skipped
  }
  return existingSources
}

async function updateFileEvidenceEntry(entry) {
  const response = await fetch(EVIDENCE_SYNC_PATH, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: entry.project || 'default', entry: vaultEvidenceFileEntry(entry) }),
    signal: AbortSignal.timeout(5_000),
  })
  if (response.status === 404) {
    await postFileEvidenceEntries([vaultEvidenceFileEntry(entry)])
    return
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

async function performEvidenceVaultSync(project, { pullOnly = false, allowExistingSources = false } = {}) {
  if (!canUseFileSync()) return { skipped: true, imported: 0, exported: 0 }
  const store = evidenceVaultStore()
  const fileEntries = await fetchFileEvidenceEntries(project)
  const localEntries = await store.list(project ? { project } : {})
  const localKeys = new Set(localEntries.map(evidenceSyncKey))
  const localById = new Map(localEntries.map(entry => [entry.id, entry]))
  let imported = 0, ignored = 0
  for (const fileEntry of fileEntries) {
    const local = localById.get(fileEntry.id)
    if (local && Date.parse(fileEntry.updated_at || '') > (local.updatedAt || local.savedAt || 0)) {
      await store.save(fileEvidenceInput(fileEntry), { onDuplicate: 'update' })
      imported++
      continue
    }
    if (localKeys.has(evidenceSyncKey(fileEntry))) continue
    try {
      await store.save(fileEvidenceInput(fileEntry), { onDuplicate: 'new' })
      imported++
    } catch {
      ignored++
      // 非法或无法追溯的文件条目不入库；文件侧保留原样，UI 不伪造条目。
    }
  }

  // 迁移备份只需收齐文件侧证据，不应因反向回写时的不同去重规则而拒绝导出。
  if (pullOnly) return { skipped: false, imported, exported: 0, ignored }

  const nextLocalEntries = await store.list(project ? { project } : {})
  const fileById = new Map(fileEntries.map(entry => [entry.id, entry]))
  let updated = 0
  for (const local of nextLocalEntries) {
    const remote = fileById.get(local.id)
    if (remote && (local.updatedAt || local.savedAt || 0) > (Date.parse(remote.updated_at || remote.saved_at || '') || 0)) {
      await updateFileEvidenceEntry(local); updated++
    }
  }
  const scopedFileKey = entry => JSON.stringify([entry.project || 'default', fileEvidenceSourceIdentity(entry)])
  const fileKeys = new Set(fileEntries.map(scopedFileKey))
  const missing = new Map()
  for (const local of nextLocalEntries) {
    const entry = vaultEvidenceFileEntry(local)
    const key = scopedFileKey(entry)
    if (!fileKeys.has(key) && !missing.has(key)) missing.set(key, entry)
  }
  let existingSources = 0
  if (missing.size) {
    existingSources = await postFileEvidenceEntries([...missing.values()], { allowExistingSources, reconcileExisting: true })
    publishEvidenceVault()
  }
  return { skipped: false, imported, exported: missing.size - existingSources, updated, ignored, existingSources }
}

export function syncEvidenceVaultWithFiles(project, { force = false, pullOnly = false, allowExistingSources = false } = {}) {
  const scope = evidenceSyncScope(project)
  const cacheScope = pullOnly ? `${scope}:pull` : allowExistingSources ? `${scope}:allow-existing` : scope
  const now = Date.now()
  pruneEvidenceSyncCache(now)
  if (!force && (evidenceSyncFreshUntil.get(cacheScope) || 0) > now) {
    return Promise.resolve({ skipped: false, cached: true, imported: 0, exported: 0 })
  }
  if (evidenceSyncInFlight.has(cacheScope)) return evidenceSyncInFlight.get(cacheScope)
  const task = performEvidenceVaultSync(project, { pullOnly, allowExistingSources })
    .then(result => {
      evidenceSyncFreshUntil.set(cacheScope, Date.now() + EVIDENCE_SYNC_FRESH_MS)
      pruneEvidenceSyncCache()
      return result
    })
    .finally(() => evidenceSyncInFlight.delete(cacheScope))
  evidenceSyncInFlight.set(cacheScope, task)
  return task
}

export async function persistEvidenceEntryToFile(entry) {
  if (!canUseFileSync()) return false
  try {
    await updateFileEvidenceEntry(entry)
    invalidateEvidenceSync(entry.project)
    return true
  } catch {
    return false
  }
}

export async function saveEvidenceEntry(input, options) {
  const result = await evidenceVaultStore().save({
    ...input,
    updatedAt: Date.now(),
    // UI 保存默认归入当前运行；没有运行时保持空值，兼容既有项目级证据。
    runId: input?.runId || activeResearchRun()?.id || '',
  }, options)
  result.fileSynced = await persistEvidenceEntryToFile(result.entry)
  publishEvidenceVault()
  return result
}

export async function removeEvidenceEntryFromFile(entry) {
  if (!canUseFileSync()) return false
  const query = new URLSearchParams({ project: entry.project || 'default', id: entry.id })
  const response = await fetch(`${EVIDENCE_SYNC_PATH}?${query}`, { method: 'DELETE', signal: AbortSignal.timeout(5_000) })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  invalidateEvidenceSync(entry.project)
  return true
}

export async function clearEvidenceEntriesFromFile(project) {
  if (!canUseFileSync()) return false
  const query = project ? '?all=1&project=' + encodeURIComponent(project) : '?all=1'
  const response = await fetch(`${EVIDENCE_SYNC_PATH}${query}`, { method: 'DELETE', signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  invalidateEvidenceSync(project)
  return true
}

// ── 资产-证据互链（ROADMAP §11 P5）────────────────────────────────────────────
// 建立与解除都经这里发布变更，工作台资产卡、图谱各自订阅刷新。
export async function linkAssetToEvidence({ assetId, evidenceId, project } = {}) {
  const result = await evidenceVaultStore().linkAssetEvidence({ assetId, evidenceId, project })
  publishEvidenceVault()
  return result
}

export async function removeAssetEvidenceLinkEntry(id) {
  const removed = await evidenceVaultStore().removeAssetEvidenceLink(id)
  publishEvidenceVault()
  return removed
}

export function listAssetEvidenceLinks(filter) {
  return evidenceVaultStore().listAssetEvidenceLinks(filter)
}

// 当前项目：工作上下文，跨会话保留。保存表单与列表各自读它，
// 保证「在查询结果里保存」落到用户此刻正在看的那个项目。
export function getActiveProject() {
  const store = evidenceVaultStore()
  const stored = store.getActiveProject()
  const project = currentResearchContext().project
  // 首次升级时保留旧证据库的项目选择；之后研究上下文成为跨分区共享入口。
  if (!project && stored) { setResearchProject(stored); return stored }
  if (project && project !== stored) store.setActiveProject(project)
  return project || stored
}

export function setActiveProject(project) {
  const next = evidenceVaultStore().setActiveProject(project)
  setResearchProject(next)
  publishEvidenceVault()
  return next
}

export function formatEvidenceTime(at) {
  try { return new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

export function stamp() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}

export const STATUS_COLORS = {
  unverified: C.statusToVerify,
  verified: C.statusVerified,
  disputed: C.statusRefuted,
  stale: C.muted,
}

// 保存确认表单：嵌在查询结果条目下方。必须经过这一步才入库——
