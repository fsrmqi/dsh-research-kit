import React from 'react'
import { h, C } from './theme.js'
import {
  Toolbar, Card, Button, Input, Textarea, Field, Badge, Chip, Select,
  Segmented, EmptyState, Spinner, Notice,
} from './ui.js'
import { createEvidenceVaultStore } from './evidence-vault-store.js'
import { canWriteDraft, writeDraftText } from './lib/input-actions.js'
import { groupDepositedItems, visibleDepositionTags } from './lib/deposition-taxonomy.js'
import { planAgentEvidenceBatch, evidenceAssessmentFingerprint, normalizeAgentEvidenceResult } from './lib/agent-evidence-batch.js'
import { RESEARCH_EVIDENCE_STANCES } from './lib/research-claims.js'
import { researchLedgerSummary, latestResearchScreening } from './lib/research-ledger.js'
import { RESEARCH_TOPIC_OPTIONS, isControlledResearchTopic } from './lib/research-taxonomy.js'
import { workspaceIdForProject } from './lib/research-workspaces.js'
import { auditResearchDataQuality } from './lib/research-quality.js'
import { previewProjectOrganization, applyProjectOrganization, undoProjectOrganization, recoverProjectOrganizationJournal, finalizeProjectOrganization } from './project-organizer.js'
import { currentResearchContext, setResearchProject, activeResearchRun } from './research-context-store.js'
import {
  EVIDENCE_STATUSES, EVIDENCE_STATUS_LABELS, EVIDENCE_IDENTIFIER_LABELS,
  EVIDENCE_TRACEABILITY, EVIDENCE_STUDY_TYPES, EVIDENCE_CLAIM_SUPPORT, EVIDENCE_STRENGTHS, EVIDENCE_DIMENSION_LABELS,
  statusCounts, filterEvidence, detectIdentifier,
  serializeEvidenceBackup, parseEvidenceBackup, mergeEntries, planCitationWrite,
  buildEvidenceExplainPack,
} from './lib/evidence-vault-core.js'

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

async function postFileEvidenceEntries(entries, { allowExistingSources = false } = {}) {
  const byProject = new Map()
  for (const entry of entries) {
    const project = entry.project || 'default'
    if (!byProject.has(project)) byProject.set(project, [])
    byProject.get(project).push(entry)
  }
  let existingSources = 0
  for (const [project, rows] of byProject) {
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
      || added < 0 || skipped < 0 || added + skipped !== rows.length
      || (!allowExistingSources && skipped)) {
      throw new Error('文件侧存在重复来源，未完成同步；请先检查项目内条目。')
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
  let imported = 0
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
      // 非法或无法追溯的文件条目不入库；文件侧保留原样，UI 不伪造条目。
    }
  }

  // 迁移备份只需收齐文件侧证据，不应因反向回写时的不同去重规则而拒绝导出。
  if (pullOnly) return { skipped: false, imported, exported: 0 }

  const nextLocalEntries = await store.list(project ? { project } : {})
  const fileKeys = new Set(fileEntries.map(evidenceSyncKey))
  const missing = nextLocalEntries.filter(entry => !fileKeys.has(evidenceSyncKey(entry)))
  let existingSources = 0
  if (missing.length) {
    existingSources = await postFileEvidenceEntries(missing.map(vaultEvidenceFileEntry), { allowExistingSources })
    publishEvidenceVault()
  }
  return { skipped: false, imported, exported: missing.length - existingSources, existingSources }
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

async function persistEvidenceEntryToFile(entry) {
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

function formatEvidenceTime(at) {
  try { return new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

function stamp() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}

function downloadJson(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const STATUS_COLORS = {
  unverified: C.statusToVerify,
  verified: C.statusVerified,
  disputed: C.statusRefuted,
  stale: C.muted,
}

// 保存确认表单：嵌在查询结果条目下方。必须经过这一步才入库——
// 用户要看到并确认将要保存的内容，这是「不静默持久化」的具体落点。
export function EvidenceSaveForm({ source = {}, databaseName = '', onCancel, onSaved }) {
  const detected = React.useMemo(
    () => detectIdentifier(source.identifier, source.title, source.url, source.meta),
    [source.identifier, source.title, source.url, source.meta],
  )
  const [form, setForm] = React.useState({
    title: source.title || '',
    identifier: detected.value || '',
    project: getActiveProject(),
    tags: '',
    reason: '',
    note: '',
  })
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  // 重复不是错误而是需要用户裁决的状态：覆盖已有，还是刻意另存一份。
  const [conflict, setConflict] = React.useState(null)
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const payload = onDuplicate => ({
    title: form.title,
    sourceDatabase: databaseName,
    identifier: form.identifier,
    identifierKind: form.identifier && form.identifier === detected.value ? detected.kind : 'accession',
    url: source.url,
    sourceMeta: source.meta,
    project: form.project,
    tags: form.tags,
    reason: form.reason,
    note: form.note,
  })
  const submit = async (onDuplicate = 'reject') => {
    setSaving(true); setError('')
    try {
      const result = await saveEvidenceEntry(payload(onDuplicate), { onDuplicate })
      setConflict(null)
      onSaved?.(result.entry)
    } catch (failure) {
      if (failure?.code === 'DUPLICATE') { setConflict(failure.duplicate); setError('') } else setError(String(failure?.message || failure))
    } finally { setSaving(false) }
  }
  return h(Card, { style: { marginTop: 8, padding: 12, border: `1px solid ${C.tealLine}`, background: C.surface, display: 'grid', gap: 10 } }, [
    h('strong', { key: 't', style: { fontSize: 13 } }, '保存到证据库'),
    h('p', { key: 'p', style: { margin: 0, color: C.muted, fontSize: 12, lineHeight: 1.5 } },
      '只保存元数据与你写下的笔记；不保存检索词、API 原始响应或全文。保存后默认标记为「未核验」，需要逐条打开来源确认。'),
    h('div', { key: 'grid', className: 'rk-form-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 } }, [
      h(Field, { key: 'title', label: '标题' },
        h(Input, { value: form.title, onChange: value => update('title', value), ariaLabel: '证据标题' })),
      h(Field, { key: 'identifier', label: `稳定标识符${detected.value ? `（已识别为 ${EVIDENCE_IDENTIFIER_LABELS[detected.kind]}）` : '（可选）'}` },
        h(Input, { value: form.identifier, onChange: value => update('identifier', value), placeholder: 'DOI / PMID / NCT / 数据集编号', ariaLabel: '稳定标识符' })),
      h(Field, { key: 'project', label: '项目（可选，默认当前项目）' },
        h(Input, { value: form.project, onChange: value => update('project', value), placeholder: '例：肿瘤队列分析', ariaLabel: '项目' })),
      h(Field, { key: 'tags', label: '标签（逗号分隔）' },
        h(Input, { value: form.tags, onChange: value => update('tags', value), ariaLabel: '标签' })),
    ]),
    h(Field, { key: 'reason', label: '保存原因（可选）' },
      h(Textarea, { value: form.reason, onChange: value => update('reason', value), rows: 2, placeholder: '这条来源为什么值得留下', ariaLabel: '保存原因' })),
    h(Field, { key: 'note', label: '笔记（可选）' },
      h(Textarea, { value: form.note, onChange: value => update('note', value), rows: 2, ariaLabel: '笔记' })),
    error ? h(Notice, { key: 'error', tone: 'error', icon: 'shield' }, error) : null,
    conflict ? h(Notice, { key: 'conflict', tone: 'warn', icon: 'shield' },
      `该来源已在本项目证据库中：「${conflict.title}」（${EVIDENCE_STATUS_LABELS[conflict.status] || conflict.status}）。要覆盖它的笔记与状态，还是另存一份？`) : null,
    h('div', { key: 'row', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
      h(Button, { key: 'save', variant: 'primary', size: 'sm', icon: 'check', disabled: saving || !form.title.trim(), onClick: () => submit('reject') }, saving ? '保存中…' : '确认保存'),
      conflict ? h(Button, { key: 'update', variant: 'soft', size: 'sm', icon: 'check', disabled: saving, onClick: () => submit('update') }, '覆盖已有条目') : null,
      conflict ? h(Button, { key: 'force', variant: 'ghost', size: 'sm', disabled: saving, onClick: () => submit('new') }, '仍然另存一份') : null,
      h(Button, { key: 'cancel', variant: 'ghost', size: 'sm', onClick: onCancel }, '取消'),
    ]),
  ])
}

// 证据库面板：由沉淀层分区内嵌，不自带 PageHead（外壳与标题由分区提供）。
// assetTitlesById：灵感资产 id → 标题（由分区③传入），供「被引用于」反查显示；
// 缺失时优雅回落为「（资产不在当前列表）」，不阻塞渲染。
export function EvidenceVaultPane({ inputActions, sessionId, assetTitlesById = null, assetProvider = null }) {
  const store = evidenceVaultStore()
  const [entries, setEntries] = React.useState([])
  const [workspaces, setWorkspaces] = React.useState([])
  const [showArchivedWorkspaces, setShowArchivedWorkspaces] = React.useState(false)
  const [workspaceNameDraft, setWorkspaceNameDraft] = React.useState('')
  const [workspaceRenameOpen, setWorkspaceRenameOpen] = React.useState(false)
  const [confirmArchiveWorkspace, setConfirmArchiveWorkspace] = React.useState(false)
  const [project, setProject] = React.useState(() => store.getActiveProject())
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState('all')
  const [groupByTopic, setGroupByTopic] = React.useState(true)
  const [selectedIds, setSelectedIds] = React.useState([])
  const [notice, setNotice] = React.useState('')
  const [newProject, setNewProject] = React.useState('')
  const [newProjectOpen, setNewProjectOpen] = React.useState(false)
  const [backup, setBackup] = React.useState('')
  const [backupOpen, setBackupOpen] = React.useState(false)
  const [assessmentNotes, setAssessmentNotes] = React.useState({})
  const [includeHuman, setIncludeHuman] = React.useState(false)
  const [agentBusy, setAgentBusy] = React.useState(false)
  const [agentProgress, setAgentProgress] = React.useState('')
  const [agentStats, setAgentStats] = React.useState(null)
  const [sourceCheckBusy, setSourceCheckBusy] = React.useState(false)
  const [sourceCheckProgress, setSourceCheckProgress] = React.useState('')
  const [organizerPlan, setOrganizerPlan] = React.useState(null)
  const [organizerBusy, setOrganizerBusy] = React.useState(false)
  const [organizerProgress, setOrganizerProgress] = React.useState('')
  const [organizerLog, setOrganizerLog] = React.useState([])
  const [organizerJournal, setOrganizerJournal] = React.useState(null)
  const [claims, setClaims] = React.useState([])
  const [ledger, setLedger] = React.useState([])
  const [screeningDecision, setScreeningDecision] = React.useState('include')
  const [screeningReason, setScreeningReason] = React.useState('')
  const [screeningOpen, setScreeningOpen] = React.useState(false)
  const [artifactOpen, setArtifactOpen] = React.useState(false)
  const [artifactTitle, setArtifactTitle] = React.useState('')
  const [artifactDataset, setArtifactDataset] = React.useState('')
  const [artifactCode, setArtifactCode] = React.useState('')
  const [artifactParameters, setArtifactParameters] = React.useState('')
  const [artifactEnvironment, setArtifactEnvironment] = React.useState('')
  const [artifactOutput, setArtifactOutput] = React.useState('')
  const [artifactExecution, setArtifactExecution] = React.useState('')
  const [claimFormOpen, setClaimFormOpen] = React.useState(false)
  const [claimQuestion, setClaimQuestion] = React.useState('')
  const [claimStatement, setClaimStatement] = React.useState('')
  const [claimStance, setClaimStance] = React.useState('unassessed')
  const [claimLocator, setClaimLocator] = React.useState('')
  const [claimStudyDesign, setClaimStudyDesign] = React.useState('')
  const [claimSample, setClaimSample] = React.useState('')
  const [claimResult, setClaimResult] = React.useState('')
  const [claimLimitations, setClaimLimitations] = React.useState('')
  const [classificationEditId, setClassificationEditId] = React.useState('')
  const [classificationDraft, setClassificationDraft] = React.useState('')
  const agentAbort = React.useRef(null)
  // 反查（入口 B，只读）：每条证据被哪些灵感资产引用，随订阅刷新。
  const [links, setLinks] = React.useState([])
  // 清空是不可逆的，用两段式确认代替 window.confirm（宿主可能屏蔽原生弹窗）。
  const [confirmClear, setConfirmClear] = React.useState(false)
  // 单条删除同样不可逆（且会联动解除以其为端点的 link），与清空共用两段式模式。
  const [confirmDeleteId, setConfirmDeleteId] = React.useState('')
  const refreshVersion = React.useRef(0)

  const refresh = React.useCallback(() => {
    const version = ++refreshVersion.current
    Promise.resolve()
      .then(() => syncEvidenceVaultWithFiles(project || undefined))
      .catch(() => {})
      .then(() => Promise.all([store.list({ project: project || undefined }), store.listWorkspaces({ includeArchived: true }), store.listAssetEvidenceLinks(), store.listResearchClaims({ project: project || undefined }), store.listResearchLedger({ project: project || undefined })]))
      .then(([rows, names, links, claims, ledger]) => {
        if (version !== refreshVersion.current) return
        setEntries(rows || [])
        setWorkspaces(names || [])
        setLinks(Array.isArray(links) ? links : [])
        setClaims(Array.isArray(claims) ? claims : [])
        setLedger(Array.isArray(ledger) ? ledger : [])
        setLoading(false)
      })
      .catch(error => {
        if (version !== refreshVersion.current) return
        setNotice(`⚠️ 读取证据库失败：${error?.message || error}`)
        setLoading(false)
      })
  }, [store, project])
  React.useEffect(() => { refresh() }, [refresh])
  React.useEffect(() => subscribeEvidenceVault(refresh), [refresh])
  React.useEffect(() => { recoverProjectOrganizationJournal(store).then(setOrganizerJournal).catch(error => setNotice(`⚠️ 项目整理恢复检查失败：${error.message}`)) }, [store])

  const counts = React.useMemo(() => statusCounts(entries), [entries])
  const quality = React.useMemo(() => auditResearchDataQuality({
    evidence: entries,
    links: project ? links.filter(item => item.project === project) : links,
    assetIds: assetTitlesById ? Object.keys(assetTitlesById) : null,
  }), [entries, links, project, assetTitlesById])
  const filtered = React.useMemo(() => filterEvidence(entries, { query, filter }), [entries, query, filter])
  const displayedEntries = React.useMemo(() => groupByTopic
    ? groupDepositedItems(filtered).flatMap(group => [{ id: `topic:${group.topic}`, __groupTopic: group.topic, __count: group.rows.length }, ...group.rows.map(row => ({ ...row, __displayKey: `${row.id}:${group.topic}` }))])
    : filtered, [filtered, groupByTopic])
  const selectedIdSet = React.useMemo(() => new Set(selectedIds), [selectedIds])
  // 「被引用于」反查索引：evidenceId → 资产标题列表（标题缺失时如实标注，不断链）。
  const citedByIndex = React.useMemo(() => {
    const index = new Map()
    for (const link of links) {
      if (!index.has(link.evidenceId)) index.set(link.evidenceId, [])
      const title = assetTitlesById?.[link.assetId]
      index.get(link.evidenceId).push(title || `（资产 ${String(link.assetId).slice(0, 12)}… 不在当前列表）`)
    }
    return index
  }, [links, assetTitlesById])
  // 选择是用户明确做出的跨筛选状态：以 entries 而非 filtered 为基准，
  // 改筛选只影响「看见什么」，不会悄悄撤销「已选择什么」。
  const selectedEntries = React.useMemo(() => entries.filter(item => selectedIdSet.has(item.id)), [entries, selectedIdSet])
  const canWrite = canWriteDraft(inputActions)
  // 写入决策走纯逻辑：只有 action === 'write' 才允许碰宿主输入框。
  // 「未选择不注入」由 evidence-vault-core 的回归测试守护，视图不再自行判断。
  const writePlan = React.useMemo(() => planCitationWrite({ entries: selectedEntries, canWrite }), [selectedEntries, canWrite])
  const citationPreview = writePlan.text
  const degraded = store.isDegraded()

  const switchProject = value => {
    setProject(value)
    setActiveProject(value)
    setConfirmClear(false)
    setConfirmDeleteId('')
    setSelectedIds([])
    setWorkspaceRenameOpen(false)
    setConfirmArchiveWorkspace(false)
  }
  const writeSelected = () => {
    if (writePlan.action !== 'write') return setNotice(writePlan.notice)
    const written = writeDraftText(inputActions, writePlan.text)
    setNotice(written.ok ? writePlan.notice : '草稿已变化，未自动写入引用；请选择后重新写入。')
  }

  const saveClaim = async () => {
    if (!selectedEntries.length) return setNotice('请先勾选至少一条证据。')
    try {
      await store.saveResearchClaim({
        project: project || selectedEntries[0].project || '',
        question: claimQuestion, statement: claimStatement,
        links: selectedEntries.map(item => ({
          evidenceId: item.id, stance: claimStance, locator: claimLocator,
          studyDesign: claimStudyDesign, sample: claimSample, result: claimResult,
          limitations: claimLimitations, assessedBy: claimStance === 'unassessed' ? '' : 'researcher',
          assessedAt: claimStance === 'unassessed' ? 0 : Date.now(),
        })),
      })
      setClaimFormOpen(false); setClaimStatement(''); setClaimQuestion(''); setClaimLocator('')
      setClaimStudyDesign(''); setClaimSample(''); setClaimResult(''); setClaimLimitations(''); setClaimStance('unassessed')
      publishEvidenceVault()
      setNotice(`已建立研究论断，并关联 ${selectedEntries.length} 条证据；未评估关系不会标为支持。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }
  const saveScreening = async () => {
    if (!selectedEntries.length) return setNotice('请先选择要筛选的证据。')
    if (screeningDecision === 'exclude' && !screeningReason.trim()) return setNotice('排除时必须填写理由。')
    try {
      const run = activeResearchRun()
      for (const item of selectedEntries) await store.saveResearchLedgerEvent({
        kind: 'screening', project: item.project || project, runId: run?.id || '',
        evidenceId: item.id, decision: screeningDecision, reason: screeningReason,
        source: 'manual', actor: 'researcher',
      })
      setScreeningOpen(false); setScreeningReason('')
      publishEvidenceVault()
      setNotice(`已记录 ${selectedEntries.length} 条证据的${screeningDecision === 'include' ? '纳入' : screeningDecision === 'exclude' ? '排除' : '待定'}决定；不会改变来源核验状态。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }
  const saveArtifact = async () => {
    try {
      const run = activeResearchRun()
      if (!run) throw new Error('当前没有研究运行；请先从工作流启动一次研究运行，再记录产出。')
      if (project && run.project && project !== run.project) throw new Error(`当前证据项目「${project}」与活跃运行「${run.project}」不一致；请切换项目后再记录产出。`)
      await store.saveResearchLedgerEvent({
        kind: 'artifact', project: run.project || project, runId: run.id,
        title: artifactTitle, datasetId: artifactDataset, codeVersion: artifactCode,
        parameters: artifactParameters, environment: artifactEnvironment,
        output: artifactOutput, executionRef: artifactExecution,
        state: 'draft',
      })
      setArtifactOpen(false); setArtifactTitle(''); setArtifactDataset(''); setArtifactCode('')
      setArtifactParameters(''); setArtifactEnvironment(''); setArtifactOutput(''); setArtifactExecution('')
      publishEvidenceVault()
      setNotice(artifactExecution.trim() ? '已记录待核对的执行引用；尚未验证工具日志，不标记为实际执行。' : '研究产出已记录为草稿；未提供执行依据，不会标记为实际执行。')
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }
  const saveClassification = async item => {
    try {
      const topics = classificationDraft.split(/[;；\n]/).map(part => part.trim()).filter(Boolean).map(part => {
        const [primary, secondary] = part.split(/\s*[/／]\s*/)
        if (!primary?.trim() || !secondary?.trim()) throw new Error('分类格式应为“一级主题/二级主题”，多组用分号分隔。')
        if (!isControlledResearchTopic(primary.trim(), secondary.trim())) throw new Error(`“${primary.trim()}/${secondary.trim()}”不在当前受控主题词表中。`)
        return { primary: primary.trim(), secondary: secondary.trim() }
      })
      await saveEvidenceEntry({ ...item, classification: { topics, facets: item.classification?.facets || {}, reviewed: true } }, { onDuplicate: 'update' })
      setClassificationEditId(''); setClassificationDraft('')
      setNotice(`「${item.title}」的人工分类已保存，不会被自动规则覆盖。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  const checkSelectedSources = async () => {
    if (sourceCheckBusy || !selectedEntries.length) return
    const eligible = selectedEntries.filter(item => (item.identifierKind === 'doi' || item.identifierKind === 'pmid') && item.identifier)
    if (!eligible.length) return setNotice('已选证据没有可核对的 DOI 或 PMID。')
    setSourceCheckBusy(true)
    let completed = 0, unmatched = 0
    try {
      for (let start = 0; start < eligible.length; start += 6) {
        const batch = eligible.slice(start, start + 6)
        setSourceCheckProgress(`正在核对 ${start + 1}–${start + batch.length} / ${eligible.length}`)
        const response = await fetch('/dsh-research-kit/evidence-source-check', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: batch.map(item => ({ id: item.id, title: item.title, identifier: item.identifier, identifierKind: item.identifierKind })) }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok || !body?.ok || !Array.isArray(body.results)) throw new Error(body.error || `来源核对失败：HTTP ${response.status}`)
        for (const result of body.results) {
          const original = batch.find(item => item.id === result.id)
          if (!original) continue
          if (!result.check) { unmatched++; continue }
          const current = (await store.list({ project: original.project })).find(item => item.id === original.id)
          if (!current || current.title !== original.title || current.identifier !== original.identifier) { unmatched++; continue }
          const sourceCheckHistory = current.sourceCheck
            ? [...(current.sourceCheckHistory || []), current.sourceCheck].slice(-5) : current.sourceCheckHistory || []
          const saved = await saveEvidenceEntry({ ...current, sourceCheck: result.check, sourceCheckHistory }, { onDuplicate: 'update' })
          if (!saved.fileSynced) throw new Error(`「${original.title}」的核对记录未同步到文件侧。`)
          completed++
        }
      }
      setNotice(`已核对 ${completed} 条官方元数据${unmatched ? `，${unmatched} 条未完成` : ''}。这不代表已读取原文或核实结论，核验状态保持不变。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}；已完成 ${completed} 条。`) }
    finally { setSourceCheckBusy(false); setSourceCheckProgress('') }
  }

  const createProject = async () => {
    try {
      const workspace = await store.createWorkspace(newProject)
      switchProject(workspace.projectKey)
      setNewProject('')
      setNewProjectOpen(false)
      setNotice(`已创建课题空间「${workspace.name}」；其 ID 不随显示名变化。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }
  const renameProject = async () => {
    try {
      const workspace = await store.renameWorkspace(project, workspaceNameDraft)
      setWorkspaceRenameOpen(false)
      refresh()
      setNotice(`显示名已改为「${workspace.name}」；原项目键与证据归属保持不变。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }
  const toggleProjectArchive = async () => {
    try {
      const current = (await store.listWorkspaces({ includeArchived: true })).find(item => item.projectKey === project)
      const archived = !current?.archived
      await store.setWorkspaceArchived(project, archived)
      setConfirmArchiveWorkspace(false)
      if (archived) switchProject('')
      else refresh()
      setNotice(archived ? '课题空间已归档；证据、论断和运行记录均未删除。' : '课题空间已恢复到可选列表。')
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  const previewOrganizer = async () => {
    if (organizerBusy) return
    setOrganizerBusy(true)
    setOrganizerProgress('正在扫描全部项目与关联')
    setOrganizerLog(['开始扫描项目与关联'])
    try {
      await syncEvidenceVaultWithFiles(undefined, { force: true })
      const plan = await previewProjectOrganization({ store, assetProvider })
      setOrganizerPlan(plan)
      setOrganizerLog(current => [...current, `扫描完成：${plan.length} 个可整理项目`])
      setNotice(plan.length ? `找到 ${plan.length} 个可整理的任务型项目；请检查建议后一次确认。` : '没有发现需要整理的已知任务型项目。')
    } catch (error) { setOrganizerLog(current => [...current, `扫描失败：${error?.message || error}`]); setNotice(`⚠️ 无法完整扫描项目：${error?.message || error}`) }
    finally { setOrganizerBusy(false); setOrganizerProgress('') }
  }

  const applyOrganizer = async () => {
    const mappings = (organizerPlan || []).filter(item => item.selected).map(({ from, to }) => ({ from, to }))
    if (!mappings.length || organizerBusy) return
    setOrganizerBusy(true)
    setOrganizerLog(current => [...current, `确认整理 ${mappings.length} 个项目`])
    try {
      const journal = await applyProjectOrganization({ store, assetProvider, mappings, onProgress: message => {
        setOrganizerProgress(message); setOrganizerLog(current => [...current, message])
      } })
      setOrganizerJournal(journal)
      setOrganizerPlan(null)
      setProject(getActiveProject())
      invalidateEvidenceSync()
      publishEvidenceVault()
      setNotice(`已整理 ${mappings.length} 个项目；原项目名已保留，可用“撤销上次整理”恢复。`)
    } catch (error) { setOrganizerLog(current => [...current, `整理失败：${error?.message || error}`]); setNotice(`⚠️ ${error?.message || error}`) }
    finally { setOrganizerBusy(false); setOrganizerProgress('') }
  }

  const undoOrganizer = async () => {
    if (organizerBusy) return
    setOrganizerBusy(true)
    try {
      const journal = await undoProjectOrganization({ store, assetProvider, onProgress: message => {
        setOrganizerProgress(message); setOrganizerLog(current => [...current, message])
      } })
      setOrganizerJournal({ ...journal, status: 'undone' })
      setProject(getActiveProject())
      invalidateEvidenceSync()
      publishEvidenceVault()
      setNotice('已撤销上次项目整理，证据与关联已恢复原归属。')
    } catch (error) { setOrganizerLog(current => [...current, `撤销失败：${error?.message || error}`]); setNotice(`⚠️ 撤销未完成：${error?.message || error}`) }
    finally { setOrganizerBusy(false); setOrganizerProgress('') }
  }

  const finalizeOrganizer = async () => {
    if (organizerBusy) return
    setOrganizerBusy(true)
    try {
      const journal = await finalizeProjectOrganization(store)
      setOrganizerJournal(journal)
      setNotice('已保留本次整理结果；现在可再次整理新项目。本次撤销快照已关闭。')
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
    finally { setOrganizerBusy(false) }
  }

  const exportJson = () => {
    try {
      const entryIds = new Set(entries.map(item => item.id))
      const scopedClaims = claims.filter(item => item.links.every(link => entryIds.has(link.evidenceId)))
      const scopedLinks = links.filter(item => entryIds.has(item.evidenceId))
      const scopedWorkspaces = workspaces.filter(item => (!project || item.projectKey === project)
        && (item.origin === 'user' || item.updatedAt > 0))
      const text = serializeEvidenceBackup({ entries, project, claims: scopedClaims, links: scopedLinks, ledger, workspaces: scopedWorkspaces })
      const suffix = project || '全部项目'
      downloadJson(text, `dsh-research-kit-evidence-${suffix}-${stamp()}.json`)
      setNotice(`已导出 ${entries.length} 条证据、${scopedClaims.length} 条论断、${scopedLinks.length} 条关联、${ledger.length} 条账本事件与 ${scopedWorkspaces.length} 个课题设置。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  // 解释图素材包：按当前筛选范围导出（通常先筛「已核验」），供 render-diagrams --evidence 并入「证据库来源」卡片。
  const exportExplainPack = () => {
    try {
      if (!filtered.length) return setNotice('当前筛选范围内没有可导出的证据条目。')
      const text = JSON.stringify(buildEvidenceExplainPack(filtered, project), null, 2) + '\n'
      const suffix = project || '全部项目'
      downloadJson(text, `evidence-explain-pack-${suffix}-${stamp()}.json`)
      setNotice(`已导出 ${filtered.length} 条证据作为解释图素材（按当前筛选范围；渲染时用 --evidence <路径> 并入）。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }
  const exportResearchRecord = () => {
    try {
      const includedIds = new Set([...latestResearchScreening(ledger).values()]
        .filter(item => item.decision === 'include').map(item => item.evidenceId))
      const cited = entries.filter(item => includedIds.has(item.id)).map(item => ({
        id: item.id, title: item.title, identifier: item.identifier, identifierKind: item.identifierKind,
        url: item.url, project: item.project, status: item.status,
      }))
      downloadJson(JSON.stringify({ kind: 'dsh-research-record', version: 1, exportedAt: Date.now(), project,
        ledger, claims, citations: cited }, null, 2) + '\n', `dsh-research-record-${project || 'all'}-${stamp()}.json`)
      setNotice(`已导出 ${ledger.length} 条账本事件、${claims.length} 条论断及 ${cited.length} 条纳入来源。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  const importJson = async () => {
    try {
      const parsed = parseEvidenceBackup(backup)
      const all = await store.list()
      const merged = mergeEntries(all, parsed.entries)
      const fresh = merged.rows.filter(row => !all.some(item => item.id === row.id))
      if (fresh.length) await store.importMany(fresh)
      const restoredWorkspaces = await store.importWorkspaces(parsed.workspaces)
      const availableIds = new Set((await store.list()).map(item => item.id))
      const claimIds = new Set((await store.listResearchClaims()).map(item => item.id))
      let restoredClaims = 0, restoredLinks = 0, restoredLedger = 0, skippedRelated = 0
      for (const item of parsed.claims) {
        if (claimIds.has(item?.id)) continue
        if (!Array.isArray(item?.links) || item.links.some(link => !availableIds.has(link.evidenceId))) { skippedRelated++; continue }
        await store.saveResearchClaim(item); claimIds.add(item.id); restoredClaims++
      }
      const linkIds = new Set((await store.listAssetEvidenceLinks()).map(item => item.id))
      for (const item of parsed.links) {
        if (linkIds.has(item?.id)) continue
        if (!availableIds.has(item?.evidenceId)) { skippedRelated++; continue }
        const result = await store.linkAssetEvidence(item)
        if (result.created) restoredLinks++
      }
      const ledgerIds = new Set((await store.listResearchLedger()).map(item => item.id))
      for (const item of parsed.ledger) {
        if (ledgerIds.has(item?.id)) continue
        if (item?.kind === 'screening' && !availableIds.has(item.evidenceId)) { skippedRelated++; continue }
        await store.saveResearchLedgerEvent(item); ledgerIds.add(item.id); restoredLedger++
      }
      setBackup('')
      setBackupOpen(false)
      invalidateEvidenceSync(project || undefined)
      await syncEvidenceVaultWithFiles(project || undefined, { force: true })
      publishEvidenceVault()
      const tail = merged.skipped ? `，跳过 ${merged.skipped} 条已存在` : ''
      const bad = merged.invalid ? `，${merged.invalid} 条无法追溯已忽略` : ''
      setNotice(`已恢复 ${merged.added} 条证据、${restoredClaims} 条论断、${restoredLinks} 条关联、${restoredLedger} 条账本事件、${restoredWorkspaces} 个课题设置${tail}${bad}${skippedRelated ? `；${skippedRelated} 条关联对象不存在，已跳过` : ''}。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  const removeEntry = async item => {
    try {
      await removeEvidenceEntryFromFile(item)
      await store.remove(item.id)
      publishEvidenceVault()
      setNotice(`已删除「${item.title}」。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) } finally { setConfirmDeleteId('') }
  }

  const changeStatus = async (item, status) => {
    if (status === item.status) return
    try {
      await saveEvidenceEntry({ ...item, status, sourceVerification: status }, { onDuplicate: 'update' })
      setNotice(`「${item.title}」已标记为${EVIDENCE_STATUS_LABELS[status]}。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }
  const changeAssessment = async (item, key, value, reason = item.assessmentReason || '') => {
    try {
      const next = { ...item, [key]: value, assessmentReason: reason, assessedAt: Date.now(), assessedBy: 'researcher' }
      if (key === 'strength') next.grade = value
      await saveEvidenceEntry(next, { onDuplicate: 'update' })
      setNotice(`「${item.title}」的人工评估已更新。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }
  const saveAssessmentReason = item => changeAssessment(item, 'assessmentReason', assessmentNotes[item.id] ?? item.assessmentReason ?? '', assessmentNotes[item.id] ?? item.assessmentReason ?? '')

  const runAgentAssessment = async (requestedEntries = entries) => {
    if (agentBusy) return
    const plan = planAgentEvidenceBatch(requestedEntries, { includeHuman })
    if (!plan.eligible.length) return setNotice('当前范围没有待 Agent 判断的证据；可勾选「包含人工处理过的」重新判断。')
    if (!sessionId) return setNotice('⚠️ 当前会话不可用，无法调用 Agent 模型。')
    const controller = new AbortController()
    agentAbort.current = controller
    setAgentBusy(true)
    setAgentStats({ total: plan.eligible.length, completed: 0, skipped: 0, failed: 0, batch: 0, batches: plan.batches.length, phase: '准备请求', last: '' })
    let completed = 0
    let skippedChanged = 0
    let failed = 0
    try {
      for (const batch of plan.batches) {
        if (controller.signal.aborted) break
        const batchNumber = plan.batches.indexOf(batch) + 1
        setAgentProgress(`第 ${batchNumber}/${plan.batches.length} 批：请求 ${batch.length} 条`)
        setAgentStats(current => ({ ...current, batch: batchNumber, phase: `正在请求第 ${batchNumber} 批（${batch.length} 条）`, last: '' }))
        const response = await fetch(`/dsh-research-kit/evidence-agent-assess?session_id=${encodeURIComponent(sessionId)}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entries: batch }), signal: controller.signal,
        })
        const raw = await response.text()
        let body
        try { body = JSON.parse(raw || '{}') } catch {
          throw new Error(`Agent 服务返回了空或无效响应（HTTP ${response.status}）。请重试；若持续出现，请检查当前会话模型路由。`)
        }
        if (!response.ok) throw new Error(body.next_action || body.error || `Agent 请求失败：HTTP ${response.status}`)
        if (!body?.ok || !Array.isArray(body.assessments)) throw new Error('Agent 服务未返回完整的结构化判断。请重试。')
        const results = normalizeAgentEvidenceResult(body, batch.map(row => row.id), { model: body.model })
        setAgentStats(current => ({ ...current, phase: `第 ${batchNumber} 批返回，正在逐条写回` }))
        for (const result of results) {
          if (controller.signal.aborted) break
          const original = batch.find(row => row.id === result.id)
          const current = (await store.list({ project: original.project || undefined })).find(row => row.id === result.id)
          if (!current || evidenceAssessmentFingerprint(current) !== evidenceAssessmentFingerprint(original)) {
            skippedChanged++
            setAgentStats(current => ({ ...current, skipped: current.skipped + 1, last: `${original.title}：跳过（条目已变化或删除）` }))
            continue
          }
          const history = current.agentAssessment
            ? [...(current.agentAssessmentHistory || []), current.agentAssessment].slice(-5)
            : current.agentAssessmentHistory || []
          const saved = await store.save({ ...current, agentAssessment: result, agentAssessmentHistory: history, updatedAt: Date.now() }, { onDuplicate: 'update' })
          if (!await persistEvidenceEntryToFile(saved.entry)) throw new Error(`「${original.title}」的 Agent 结果仅保存在当前浏览器，文件同步失败；请重试以避免丢失。`)
          completed++
          setAgentStats(current => ({ ...current, completed: current.completed + 1, last: `${original.title}：已完成` }))
          publishEvidenceVault()
        }
      }
      setNotice(`${controller.signal.aborted ? '已取消；' : 'Agent 判断完成：'}更新 ${completed} 条${skippedChanged ? `，跳过运行期间变化的 ${skippedChanged} 条` : ''}${plan.skippedHuman ? `，跳过人工处理过的 ${plan.skippedHuman} 条` : ''}。结果仅基于元数据与笔记，不等于来源核验。`)
    } catch (error) {
      failed = plan.eligible.length - completed - skippedChanged
      setAgentStats(current => ({ ...current, failed, phase: controller.signal.aborted ? '已取消' : '请求失败', last: error?.message || String(error) }))
      setNotice(`⚠️ ${controller.signal.aborted ? '已取消' : error?.message || error}；已完成 ${completed} 条，未处理 ${failed} 条。`)
    } finally {
      agentAbort.current = null
      setAgentBusy(false)
      setAgentProgress('')
    }
  }

  // 当前项目为空时这里是「清空全部项目」，文案必须说清范围，不能只写「清空」。
  const clearScope = async () => {
    try {
      await clearEvidenceEntriesFromFile(project || undefined)
      let message
      if (project) {
        const removed = await store.removeByProject(project)
        message = `已彻底删除项目「${project}」下的 ${removed} 条证据。`
      } else {
        await store.clear()
        message = '已彻底删除全部项目的证据。'
      }
      setConfirmClear(false)
      publishEvidenceVault()
      setNotice(message)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  const filterOptions = [
    { value: 'all', label: `全部 ${counts.all}` },
    ...EVIDENCE_STATUSES.map(status => ({ value: status, label: `${EVIDENCE_STATUS_LABELS[status]} ${counts[status] || 0}` })),
  ]
  const projectOptions = [
    { value: '', label: '全部课题（含归档）' },
    ...workspaces.filter(item => showArchivedWorkspaces || !item.archived).map(item => ({ value: item.projectKey, label: item.archived ? `${item.name}（已归档）` : item.name })),
    ...(project && !workspaces.some(item => item.projectKey === project && (showArchivedWorkspaces || !item.archived)) ? [{ value: project, label: `${workspaces.find(item => item.projectKey === project)?.name || project}（已归档或未登记）` }] : []),
  ]
  const activeWorkspace = workspaces.find(item => item.projectKey === project)

  return h('div', { key: 'evidence-vault', style: { display: 'grid', gap: 12 } }, [
    degraded && !loading ? h(Notice, { key: 'degraded', tone: 'warn', icon: 'shield' },
      '当前环境未提供可用的 IndexedDB，证据暂存在内存中，刷新页面后会丢失。') : null,
    notice ? h(Notice, { key: 'notice', tone: notice.startsWith('⚠️') ? 'warn' : 'info', icon: notice.startsWith('⚠️') ? 'shield' : 'check' },
      notice.replace(/^⚠️\s*/, '')) : null,

    // 项目与维护动作：一次性操作，不随滚动吸顶（分层原则见 docs/ARCHITECTURE.md §2.3）。
    h(Card, { key: 'project-bar', style: { display: 'grid', gap: 10 } }, [
      h('div', { key: 'row', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        h('strong', { key: 'label', style: { fontSize: 13 } }, '当前课题'),
        h(Select, { key: 'select', value: project, options: projectOptions, onChange: switchProject, ariaLabel: '切换项目', style: { width: 'auto', minWidth: 140 } }),
        h(Button, { key: 'new', size: 'sm', variant: 'ghost', icon: 'plus', onClick: () => setNewProjectOpen(value => !value) }, '新建课题'),
        project ? h(Button, { key: 'rename', size: 'sm', variant: 'ghost', onClick: () => { setWorkspaceNameDraft(activeWorkspace?.name || project); setWorkspaceRenameOpen(value => !value) } }, '改显示名') : null,
        project ? h(Button, { key: 'archive', size: 'sm', variant: 'ghost', onClick: () => activeWorkspace?.archived ? toggleProjectArchive() : setConfirmArchiveWorkspace(value => !value) }, activeWorkspace?.archived ? '恢复课题' : '归档课题') : null,
        confirmArchiveWorkspace ? h(Button, { key: 'archive-confirm', size: 'sm', variant: 'soft', onClick: toggleProjectArchive }, '确认：只归档，不删除数据') : null,
        h(Button, { key: 'archived-toggle', size: 'sm', variant: 'ghost', onClick: () => setShowArchivedWorkspaces(value => !value) }, showArchivedWorkspaces ? '隐藏已归档' : '显示已归档'),
        h('span', { key: 'spacer', style: { flex: '1 1 auto' } }),
        h(Button, { key: 'export', size: 'sm', variant: 'soft', icon: 'download', onClick: exportJson, disabled: !entries.length && !claims.length && !ledger.length && !workspaces.some(item => (!project || item.projectKey === project) && (item.origin === 'user' || item.updatedAt > 0)) }, '导出备份'),
        h(Button, { key: 'export-pack', size: 'sm', variant: 'soft', icon: 'download', onClick: exportExplainPack, disabled: !filtered.length }, '导出解释图素材'),
        h(Button, { key: 'import', size: 'sm', variant: 'ghost', icon: 'upload', onClick: () => setBackupOpen(value => !value) }, '恢复备份'),
        confirmClear
          ? h(Button, { key: 'clear-confirm', size: 'sm', variant: 'danger', icon: 'trash', onClick: clearScope },
            project ? `确认删除「${project}」全部` : '确认删除全部项目')
          : h(Button, { key: 'clear', size: 'sm', variant: 'ghost', icon: 'trash', onClick: () => setConfirmClear(true), disabled: !entries.length },
            project ? '清空本项目' : '清空全部'),
      ]),
      newProjectOpen ? h('div', { key: 'new-row', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
        h(Input, { key: 'i', value: newProject, onChange: setNewProject, placeholder: '稳定课题名称，例：大麦雄性不育', ariaLabel: '新课题名称', style: { flex: '1 1 200px' } }),
        h(Button, { key: 'go', size: 'sm', variant: 'primary', disabled: !newProject.trim(), onClick: createProject }, '创建并切换'),
      ]) : null,
      workspaceRenameOpen ? h('div', { key: 'rename-row', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
        h(Input, { key: 'input', value: workspaceNameDraft, onChange: setWorkspaceNameDraft, placeholder: '新的课题显示名', ariaLabel: '课题显示名', style: { flex: '1 1 200px' } }),
        h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: !workspaceNameDraft.trim(), onClick: renameProject }, '保存显示名'),
      ]) : null,
      h('div', { key: 'organizer-actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        h(Button, { key: 'preview', size: 'sm', variant: 'soft', disabled: organizerBusy || loading || (organizerJournal && !['undone', 'failed', 'finalized'].includes(organizerJournal.status)), onClick: previewOrganizer }, '一键整理项目'),
        organizerJournal?.fileId && !['undone', 'failed', 'finalized'].includes(organizerJournal.status)
          ? h(Button, { key: 'undo', size: 'sm', variant: 'ghost', disabled: organizerBusy, onClick: undoOrganizer }, '撤销上次整理') : null,
        organizerJournal?.status === 'applied'
          ? h(Button, { key: 'finalize', size: 'sm', variant: 'ghost', disabled: organizerBusy, onClick: finalizeOrganizer }, '保留结果并继续') : null,
        organizerBusy ? h('span', { key: 'progress', role: 'status', style: { fontSize: 12, color: C.muted } }, organizerProgress || '正在整理…') : null,
      ]),
      organizerLog.length ? h('div', { key: 'organizer-log', role: 'status', style: { maxHeight: 100, overflowY: 'auto', fontSize: 11, color: C.muted, display: 'grid', gap: 3 } },
        organizerLog.slice(-10).map((line, index) => h('span', { key: `${index}:${line}` }, line))) : null,
      organizerPlan ? h('div', { key: 'organizer-preview', style: { display: 'grid', gap: 8, padding: 10, border: `1px solid ${C.tealLine}`, borderRadius: 8 } }, [
        h('strong', { key: 'title', style: { fontSize: 13 } }, '项目归类预览 · 确认前不会修改数据'),
        ...organizerPlan.map((item, index) => h('label', { key: item.from, style: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 } }, [
          h('input', { key: 'check', type: 'checkbox', checked: item.selected, disabled: organizerBusy, onChange: event => setOrganizerPlan(rows => rows.map((row, i) => i === index ? { ...row, selected: event.target.checked } : row)) }),
          h('span', { key: 'description' }, `${item.from} → ${item.to} · ${item.category === 'research' ? '科研课题' : '测试／演示归档'} · ${item.confidence === 'high' ? '高置信' : '需确认'} · 证据 ${item.counts.evidence}、论断 ${item.counts.researchClaims}、资产 ${item.counts.assets}、知识 ${item.counts.nodes + item.counts.claims}、运行 ${item.counts.runs}。${item.reason}`),
        ])),
        h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
          h(Button, { key: 'apply', size: 'sm', variant: 'primary', disabled: organizerBusy || !organizerPlan.some(item => item.selected), onClick: applyOrganizer }, '确认并一键分类'),
          h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', disabled: organizerBusy, onClick: () => setOrganizerPlan(null) }, '取消'),
        ]),
      ]) : null,
      backupOpen ? h('div', { key: 'backup', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 't', style: { fontSize: 12, color: C.muted } }, '粘贴此前导出的 JSON 备份（增量合并：已存在的条目跳过，不会覆盖现有笔记）'),
        h(Textarea, { key: 'i', value: backup, onChange: setBackup, rows: 5, mono: true, ariaLabel: 'JSON 备份内容' }),
        h('div', { key: 'row', style: { display: 'flex', gap: 8 } }, [
          h(Button, { key: 'go', size: 'sm', variant: 'primary', disabled: !backup.trim(), onClick: importJson }, '恢复'),
          h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => { setBackupOpen(false); setBackup('') } }, '取消'),
        ]),
      ]) : null,
    ]),

    h(Card, { key: 'quality-audit', style: { display: 'grid', gap: 6 } }, [
      h('strong', { key: 'title', style: { fontSize: 13 } }, '数据质量提示 · 只读，不自动修改'),
      h('span', { key: 'counts', style: { fontSize: 12, color: C.muted } }, `缺稳定标识符 ${quality.missingIdentifier} · 未核验 ${quality.unverified} · 标为失效／官方记录未找到 ${quality.staleOrMissing} · 疑似同源组 ${quality.duplicateGroups.length} · 关联断链 ${quality.orphanLinks.length}`),
      quality.duplicateGroups.length ? h('span', { key: 'duplicates', style: { fontSize: 12, color: C.muted } }, `待人工复核的同源候选：${quality.duplicateGroups.slice(0, 3).map(item => item.projects.join('／')).join('；')}${quality.duplicateGroups.length > 3 ? '…' : ''}。跨课题重复可能是有意引用，不会自动合并。`) : null,
      !quality.assetSideChecked ? h('span', { key: 'asset-limit', style: { fontSize: 11, color: C.muted } }, '当前未载入完整资产列表；断链数仅核对证据端。') : null,
    ]),
    h(Card, { key: 'agent-batch', style: { display: 'grid', gap: 8, border: `1px solid ${C.tealLine}` } }, [
      h('div', { key: 'title', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        h('strong', { key: 'label', style: { fontSize: 13 } }, 'Agent 批量判断'),
        h('span', { key: 'scope', style: { fontSize: 12, color: C.muted } }, project ? `范围：项目「${project}」全部证据` : '范围：全部项目证据'),
      ]),
      h('div', { key: 'actions', style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } }, [
        h(Button, { key: 'run', size: 'sm', variant: 'primary', disabled: agentBusy || loading || !entries.length || !sessionId, onClick: () => runAgentAssessment() },
          agentBusy ? agentProgress || '判断中…' : `一键用 Agent 判断（${planAgentEvidenceBatch(entries, { includeHuman }).eligible.length}）`),
        agentBusy ? h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => agentAbort.current?.abort() }, '取消') : null,
        h('label', { key: 'include', style: { display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12, color: C.ink } }, [
          h('input', { key: 'check', type: 'checkbox', checked: includeHuman, disabled: agentBusy, onChange: event => setIncludeHuman(event.target.checked) }),
          '包含人工处理过的',
        ]),
      ]),
      agentBusy && agentStats ? h('div', { key: 'progress', role: 'status', style: { display: 'grid', gap: 6, padding: '8px 10px', background: C.canvas, borderRadius: 8, fontSize: 12, color: C.muted } }, [
        h('div', { key: 'line', style: { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } }, [
          h('strong', { key: 'phase', style: { color: C.ink } }, agentStats.phase),
          h('span', { key: 'count' }, `已完成 ${agentStats.completed} / ${agentStats.total} · 跳过 ${agentStats.skipped} · 失败 ${agentStats.failed}`),
        ]),
        h('div', { key: 'bar', style: { height: 6, borderRadius: 99, background: C.line, overflow: 'hidden' } },
          h('div', { style: { width: `${Math.min(100, ((agentStats.completed + agentStats.skipped + agentStats.failed) / Math.max(1, agentStats.total)) * 100)}%`, height: '100%', background: C.teal, transition: 'width 160ms ease' } })),
        agentStats.last ? h('span', { key: 'last' }, `最近：${agentStats.last}`) : null,
      ]) : null,
      h('span', { key: 'warning', style: { fontSize: 12, color: C.muted, lineHeight: 1.5 } }, '可按全部数据或仅按已勾选数据判断；每次点击重新调用当前会话模型。项目用于科研工作区隔离，主题标签用于内容分类，二者职责不同。仅发送标题、链接、标识符、保存原因和笔记；结果与人工评估分开保存，不会自动标记为已核验。'),
    ]),

    // 二级吸顶带：检索与状态筛选是「随时要用的操作」，分层原则见 docs/ARCHITECTURE.md §2.3。
    h(Toolbar, { key: 'filters', sticky: true }, [
      h('div', { key: 'search', style: { position: 'relative', flex: '1 1 240px', minWidth: 180 } }, [
        h(Input, { key: 'i', value: query, onChange: setQuery, placeholder: '搜索标题、来源、标识符、项目、标签……', ariaLabel: '搜索证据条目' }),
      ]),
      h(Segmented, { key: 'tabs', value: filter, options: filterOptions, onChange: setFilter, ariaLabel: '证据核验状态筛选' }),
      h(Button, { key: 'group', size: 'sm', variant: groupByTopic ? 'soft' : 'ghost', onClick: () => setGroupByTopic(value => !value), 'aria-pressed': groupByTopic }, groupByTopic ? '按主题分组 ✓' : '按主题分组'),
      h(Button, { key: 'assess-selected', size: 'sm', variant: 'soft', disabled: agentBusy || loading || !selectedEntries.length || !sessionId, onClick: () => runAgentAssessment(selectedEntries) },
        `Agent 判断选中（${planAgentEvidenceBatch(selectedEntries, { includeHuman }).eligible.length}/${selectedEntries.length}）`),
      h(Button, { key: 'check-source', size: 'sm', variant: 'ghost', disabled: sourceCheckBusy || loading || !selectedEntries.length, onClick: checkSelectedSources }, sourceCheckBusy ? sourceCheckProgress : `核对选中来源（${selectedEntries.length}）`),
      h(Button, { key: 'screen', size: 'sm', variant: 'ghost', disabled: !selectedEntries.length, onClick: () => setScreeningOpen(value => !value) }, `筛选选中（${selectedEntries.length}）`),
      h(Button, { key: 'claim', size: 'sm', variant: 'ghost', disabled: !selectedEntries.length, onClick: () => setClaimFormOpen(value => !value) }, `建立论断（${selectedEntries.length}）`),
      h(Button, { key: 'write', size: 'sm', variant: 'primary', icon: 'edit', disabled: !selectedEntries.length || !canWrite, onClick: writeSelected }, `写入 Prompt（${selectedEntries.length}）`),
    ]),
    screeningOpen ? h(Card, { key: 'screening-form', style: { display: 'grid', gap: 8 } }, [
      h('strong', { key: 'title', style: { fontSize: 13 } }, `筛选已选 ${selectedEntries.length} 条证据`),
      h(Select, { key: 'decision', value: screeningDecision, onChange: setScreeningDecision, ariaLabel: '筛选决定', options: [
        { value: 'include', label: '纳入' }, { value: 'exclude', label: '排除' }, { value: 'pending', label: '待定' },
      ] }),
      h(Textarea, { key: 'reason', value: screeningReason, onChange: setScreeningReason, rows: 2, placeholder: '筛选理由；排除时必填', ariaLabel: '筛选理由' }),
      h('div', { key: 'actions', style: { display: 'flex', gap: 8 } }, [
        h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: !selectedEntries.length || (screeningDecision === 'exclude' && !screeningReason.trim()), onClick: saveScreening }, '记录筛选决定'),
        h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => setScreeningOpen(false) }, '取消'),
      ]),
      h('span', { key: 'hint', style: { color: C.muted, fontSize: 12 } }, '每次决定都会留痕；账本按每条证据的最新决定统计。'),
    ]) : null,
    claimFormOpen ? h(Card, { key: 'claim-form', style: { display: 'grid', gap: 8 } }, [
      h('strong', { key: 'title', style: { fontSize: 13 } }, `建立研究论断 · 关联已选 ${selectedEntries.length} 条证据`),
      h(Input, { key: 'question', value: claimQuestion, onChange: setClaimQuestion, placeholder: '研究问题（可选）', ariaLabel: '研究问题' }),
      h(Textarea, { key: 'statement', value: claimStatement, onChange: setClaimStatement, rows: 2, placeholder: '可检验的具体论断', ariaLabel: '具体论断' }),
      h(Select, { key: 'stance', value: claimStance, onChange: setClaimStance, ariaLabel: '所选证据与论断的关系', options: RESEARCH_EVIDENCE_STANCES.map(value => ({ value, label: ({ unassessed: '尚未评估', supports: '支持', refutes: '反驳', insufficient: '证据不足' })[value] })) }),
      h(Input, { key: 'locator', value: claimLocator, onChange: setClaimLocator, placeholder: '原文位置：页码／图表／段落；支持或反驳时必填', ariaLabel: '来源定位' }),
      h(Input, { key: 'design', value: claimStudyDesign, onChange: setClaimStudyDesign, placeholder: '研究设计（可选）', ariaLabel: '研究设计' }),
      h(Input, { key: 'sample', value: claimSample, onChange: setClaimSample, placeholder: '样本／研究对象（可选）', ariaLabel: '样本与研究对象' }),
      h(Input, { key: 'result', value: claimResult, onChange: setClaimResult, placeholder: '关键结果（可选）', ariaLabel: '关键结果' }),
      h(Input, { key: 'limitations', value: claimLimitations, onChange: setClaimLimitations, placeholder: '局限性（可选）', ariaLabel: '局限性' }),
      h('div', { key: 'actions', style: { display: 'flex', gap: 8 } }, [
        h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: !claimStatement.trim() || !selectedEntries.length, onClick: saveClaim }, '保存论断与证据关系'),
        h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => setClaimFormOpen(false) }, '取消'),
      ]),
      h('span', { key: 'note', style: { fontSize: 12, color: C.muted } }, '这一判断仅记录所选证据与当前论断的关系，不会改变来源核验状态；支持／反驳须填写可定位的原文位置。'),
    ]) : null,
    claims.length ? h(Card, { key: 'research-claims', style: { display: 'grid', gap: 8 } }, [
      h('strong', { key: 'title', style: { fontSize: 13 } }, `研究论断（${claims.length}）`),
      ...claims.slice(0, 20).map(claim => h('div', { key: claim.id, style: { borderTop: `1px solid ${C.line}`, paddingTop: 8, fontSize: 12 } }, [
        claim.question ? h('div', { key: 'question', style: { color: C.muted } }, `问题：${claim.question}`) : null,
        h('strong', { key: 'statement' }, claim.statement),
        h('div', { key: 'links', style: { color: C.muted, marginTop: 3 } }, `关联证据 ${claim.links.length} 条：${claim.links.map(link => ({ unassessed: '待评估', supports: '支持', refutes: '反驳', insufficient: '不足' })[link.stance] || '待评估').join('、')}`),
      ])),
      claims.length > 20 ? h('span', { key: 'more', style: { fontSize: 12, color: C.muted } }, '仅展示最近 20 条；其余仍保存在本地证据库。') : null,
    ]) : null,
    h(Card, { key: 'research-ledger', style: { display: 'grid', gap: 8 } }, [
      h('div', { key: 'head', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        h('strong', { key: 'title', style: { fontSize: 13 } }, '科研账本与复现链'),
        h('span', { key: 'summary', style: { fontSize: 12, color: C.muted } }, (() => { const s = researchLedgerSummary(ledger); return `检索 ${s.searches} · 纳入 ${s.included} · 排除 ${s.excluded} · 待定 ${s.pending} · 产出 ${s.artifacts}` })()),
        h('span', { key: 'spacer', style: { flex: '1 1 auto' } }),
        h(Button, { key: 'artifact', size: 'sm', variant: 'ghost', onClick: () => setArtifactOpen(value => !value) }, '记录研究产出'),
        h(Button, { key: 'export', size: 'sm', variant: 'soft', disabled: !ledger.length && !claims.length, onClick: exportResearchRecord }, '导出筛选与引用清单'),
      ]),
      artifactOpen ? h('div', { key: 'artifact-form', style: { display: 'grid', gap: 6 } }, [
        h(Input, { key: 'title', value: artifactTitle, onChange: setArtifactTitle, placeholder: '图表、报告或分析产出名称', ariaLabel: '研究产出名称' }),
        h(Input, { key: 'dataset', value: artifactDataset, onChange: setArtifactDataset, placeholder: '数据集编号／版本（可选）', ariaLabel: '数据集编号' }),
        h(Input, { key: 'code', value: artifactCode, onChange: setArtifactCode, placeholder: '代码 commit／版本（可选）', ariaLabel: '代码版本' }),
        h(Input, { key: 'params', value: artifactParameters, onChange: setArtifactParameters, placeholder: '参数（可选）', ariaLabel: '运行参数' }),
        h(Input, { key: 'env', value: artifactEnvironment, onChange: setArtifactEnvironment, placeholder: '环境（可选）', ariaLabel: '执行环境' }),
        h(Input, { key: 'output', value: artifactOutput, onChange: setArtifactOutput, placeholder: '产出文件／链接（可选）', ariaLabel: '产出位置' }),
        h(Input, { key: 'execution', value: artifactExecution, onChange: setArtifactExecution, placeholder: '实际执行日志／工具调用 ID；留空记为草稿', ariaLabel: '执行依据' }),
        h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: !artifactTitle.trim(), onClick: saveArtifact }, '保存研究产出'),
      ]) : null,
      ...ledger.slice(0, 12).map(item => h('div', { key: item.id, style: { borderTop: `1px solid ${C.line}`, paddingTop: 6, fontSize: 12, color: C.muted } },
        item.kind === 'search' ? `检索 · ${item.database} · ${item.query} · 当前返回 ${item.resultCount} 条`
          : item.kind === 'screening' ? `筛选 · ${item.decision === 'include' ? '纳入' : item.decision === 'exclude' ? '排除' : '待定'} · ${entries.find(row => row.id === item.evidenceId)?.title || item.evidenceId}${item.reason ? ` · ${item.reason}` : ''}`
            : `产出 · ${item.title} · ${item.state === 'verified-execution' ? '执行已核验' : item.executionRef ? '执行引用待核对' : '草稿'}`)),
      ledger.length > 12 ? h('span', { key: 'more', style: { color: C.muted, fontSize: 12 } }, `显示最近 12 条；完整 ${ledger.length} 条可导出。`) : null,
    ]),
    selectedEntries.length ? h(Card, { key: 'preview', style: { padding: 12, background: C.tealTint, border: `1px solid ${C.tealLine}` } }, [
      h('strong', { key: 't', style: { fontSize: 13 } }, `引用块预览（${selectedEntries.length} 条）`),
      h('pre', { key: 'p', style: { margin: '8px 0 0', whiteSpace: 'pre-wrap', fontFamily: C.fontMono, fontSize: 12, lineHeight: 1.55 } }, citationPreview),
    ]) : null,
    loading ? h(Spinner, { key: 'loading', text: '正在加载证据条目……' }) : null,
    !loading && !filtered.length ? h(EmptyState, {
      key: 'empty',
      icon: 'database',
      text: entries.length ? '没有匹配的证据条目。' : (project ? `项目「${project}」还没有证据。` : '证据库还是空的。'),
      hint: entries.length ? '调整搜索或筛选条件。' : '在「资源与工作流」里查询公开数据源，逐条点「保存到证据库」。',
    }) : null,
    h('div', { key: 'list', style: { display: 'grid', gap: 12 } }, displayedEntries.map(item => item.__groupTopic ? h('div', { key: item.id, role: 'heading', 'aria-level': 3, style: { fontSize: 14, fontWeight: 700, color: C.teal, marginTop: 8 } }, `${item.__groupTopic} · ${item.__count}`) : h(Card, {
      key: item.__displayKey || item.id,
      interactive: true,
      style: { contentVisibility: 'auto', containIntrinsicSize: '0 300px' },
    }, [
      h('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' } }, [
        h('div', { key: 'meta', style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 } }, [
          h('input', { key: 'select', type: 'checkbox', checked: selectedIdSet.has(item.id), onChange: () => setSelectedIds(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id]), 'aria-label': `选择「${item.title}」用于 Agent 判断或写入 Prompt`, style: { accentColor: C.teal } }),
          item.url
            ? h('a', { key: 'title', href: item.url, target: '_blank', rel: 'noreferrer noopener', style: { fontSize: 15, fontWeight: 700, color: C.teal, lineHeight: 1.45 } }, item.title)
            : h('strong', { key: 'title', style: { fontSize: 15 } }, item.title),
          h(Badge, { key: 'status', color: STATUS_COLORS[item.status] || C.muted }, EVIDENCE_STATUS_LABELS[item.status] || item.status),
          item.sourceDatabase ? h(Badge, { key: 'db', color: C.slate }, item.sourceDatabase) : null,
          item.identifier ? h(Badge, { key: 'id', color: C.teal }, `${EVIDENCE_IDENTIFIER_LABELS[item.identifierKind] || '标识符'} ${item.identifier}`) : null,
        ]),
        h('span', { key: 'time', style: { fontSize: 12, color: C.muted, flexShrink: 0 } }, `保存于 ${formatEvidenceTime(item.savedAt)}`),
      ]),
      item.reason || item.note || item.project || visibleDepositionTags(item).length
        ? h('div', { key: 'body', style: { display: 'grid', gap: 4, fontSize: 12, color: C.muted } }, [
          item.reason ? h('p', { key: 'reason', style: { margin: 0 } }, `保存原因：${item.reason}`) : null,
          item.note ? h('p', { key: 'note', style: { margin: 0 } }, `笔记：${item.note}`) : null,
          item.project ? h('p', { key: 'project', style: { margin: 0 } }, `项目：${item.project}`) : null,
          visibleDepositionTags(item).length ? h('div', { key: 'tags', style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 } },
            visibleDepositionTags(item).map(tag => h(Chip, { key: tag, color: C.slate }, tag))) : null,
          item.classification?.facets ? h('p', { key: 'facets', style: { margin: 0 } }, `检索维度：${[...(item.classification.facets.organism || []), ...(item.classification.facets.method || [])].join('、') || '待归类'} · ${item.classification.reviewed ? '人工确认' : '本地规则建议'}`) : null,
        ])
        : null,
      h('div', { key: 'classification-actions', style: { display: 'grid', gap: 6 } }, [
        h(Button, { key: 'edit', size: 'sm', variant: 'ghost', onClick: () => {
          setClassificationEditId(current => current === item.id ? '' : item.id)
          setClassificationDraft((item.classification?.topics || []).map(topic => `${topic.primary}/${topic.secondary}`).join('；'))
        } }, item.classification?.reviewed ? '修改人工分类' : '确认／修正自动分类'),
        classificationEditId === item.id ? h('div', { key: 'form', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
          h(Input, { key: 'input', value: classificationDraft, onChange: setClassificationDraft, placeholder: '一级主题/二级主题；一级主题/二级主题', ariaLabel: `修正「${item.title}」的主题分类`, style: { flex: '1 1 220px' } }),
          h(Button, { key: 'save', size: 'sm', variant: 'soft', onClick: () => saveClassification(item) }, '保存人工分类'),
        ]) : null,
        classificationEditId === item.id ? h('span', { key: 'options', style: { fontSize: 11, color: C.muted } }, `可选：${RESEARCH_TOPIC_OPTIONS.map(topic => `${topic.primary}/${topic.secondary}`).join('；')}`) : null,
      ]),
      // 入口 B（只读反查）：这条证据被哪些灵感资产引用。链接可从资产卡（入口 A）建立。
      citedByIndex.get(item.id)?.length
        ? h('div', { key: 'cited-by', style: { fontSize: 12, color: C.muted, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' } }, [
          h('span', { key: 'l', style: { color: C.teal, fontWeight: 650 } }, '被引用于：'),
          ...citedByIndex.get(item.id).map((title, index) => h('span', { key: `${title}:${index}` }, index === 0 ? title : `、${title}`)),
        ])
        : null,
      h('div', { key: 'foot', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 } }, [
        h('span', { key: 'label', style: { fontSize: 12, color: C.muted } }, '核验状态'),
        h(Select, {
          key: 'status',
          value: item.status,
          options: EVIDENCE_STATUSES.map(status => ({ value: status, label: EVIDENCE_STATUS_LABELS[status] })),
          onChange: value => changeStatus(item, value),
          ariaLabel: `设置「${item.title}」的核验状态`,
          style: { width: 'auto', minWidth: 96 },
        }),
        h('span', { key: 'spacer', style: { flex: '1 1 auto' } }),
        confirmDeleteId === item.id
          ? h(Button, { key: 'delete', size: 'sm', variant: 'danger', icon: 'trash', title: '再次点击确认；不可恢复', onClick: () => removeEntry(item) }, '确认删除？')
          : h(Button, { key: 'delete', size: 'sm', variant: 'danger', icon: 'trash', title: '删除不可恢复', onClick: () => setConfirmDeleteId(current => current === item.id ? '' : item.id) }, '删除'),
      ]),
      h('div', { key: 'assessment', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 8, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}` } }, [
        h(Field, { key: 'traceability', label: '来源可追溯性' }, h(Select, {
          value: item.traceability || 'identified', options: EVIDENCE_TRACEABILITY.map(value => ({ value, label: EVIDENCE_DIMENSION_LABELS.traceability[value] })),
          onChange: value => changeAssessment(item, 'traceability', value), ariaLabel: `设置「${item.title}」的来源可追溯性`,
        })),
        h(Field, { key: 'studyType', label: '研究类型' }, h(Select, {
          value: item.studyType || 'unknown', options: EVIDENCE_STUDY_TYPES.map(value => ({ value, label: EVIDENCE_DIMENSION_LABELS.studyType[value] })),
          onChange: value => changeAssessment(item, 'studyType', value), ariaLabel: `设置「${item.title}」的研究类型`,
        })),
        h(Field, { key: 'claimSupport', label: '声明支持程度' }, h(Select, {
          value: item.claimSupport || 'unassessed', options: EVIDENCE_CLAIM_SUPPORT.map(value => ({ value, label: EVIDENCE_DIMENSION_LABELS.claimSupport[value] })),
          onChange: value => changeAssessment(item, 'claimSupport', value), ariaLabel: `设置「${item.title}」的声明支持程度`,
        })),
        h(Field, { key: 'strength', label: '证据强度' }, h(Select, {
          value: item.strength || 'ungraded', options: EVIDENCE_STRENGTHS.map(value => ({ value, label: EVIDENCE_DIMENSION_LABELS.strength[value] })),
          onChange: value => changeAssessment(item, 'strength', value), ariaLabel: `设置「${item.title}」的证据强度`,
        })),
      h(Field, { key: 'reason', label: '人工评估依据' }, h('div', { style: { display: 'flex', gap: 6 } }, [
        h(Input, {
          key: 'input', value: assessmentNotes[item.id] ?? item.assessmentReason ?? '', onChange: value => setAssessmentNotes(notes => ({ ...notes, [item.id]: value })),
          ariaLabel: `设置「${item.title}」的人工评估依据`, placeholder: '例如：已核对全文方法与结果',
        }),
        h(Button, { key: 'save', size: 'sm', variant: 'soft', onClick: () => saveAssessmentReason(item) }, '保存依据'),
      ])),
      ]),
      item.agentAssessment ? h('div', { key: 'agent-result', style: { display: 'grid', gap: 4, padding: 10, marginTop: 8, background: C.tealTint, borderRadius: 8, fontSize: 12, lineHeight: 1.5 } }, [
        h('strong', { key: 'title' }, `Agent 最新判断 · ${item.agentAssessment.model || '当前模型'} · ${formatEvidenceTime(item.agentAssessment.at)}`),
        h('span', { key: 'dimensions' }, `来源：${EVIDENCE_DIMENSION_LABELS.traceability[item.agentAssessment.traceability]} · 类型：${EVIDENCE_DIMENSION_LABELS.studyType[item.agentAssessment.studyType]} · 声明支持：${EVIDENCE_DIMENSION_LABELS.claimSupport[item.agentAssessment.claimSupport]} · 强度：${EVIDENCE_DIMENSION_LABELS.strength[item.agentAssessment.strength]}`),
        h('span', { key: 'reason' }, item.agentAssessment.reason),
        h('span', { key: 'history', style: { color: C.muted } }, `置信度：${{ low: '低', medium: '中', high: '高' }[item.agentAssessment.confidence] || '低'}${item.agentAssessmentHistory?.length ? ` · 保留前 ${item.agentAssessmentHistory.length} 次判断` : ''} · 仅元数据初判，待人工核验`),
      ]) : null,
      item.sourceCheck ? h('div', { key: 'source-check', style: { fontSize: 12, color: C.muted, paddingTop: 4 } },
        `官方元数据：${({ matched: '标题匹配', mismatch: '标题不一致，待人工核对', unknown: '无法判断', not_found: '未找到记录' })[item.sourceCheck.status]} · ${item.sourceCheck.provider} · ${formatEvidenceTime(item.sourceCheck.checkedAt)} · 未核对原文`) : null,
    ]))),
  ])
}
