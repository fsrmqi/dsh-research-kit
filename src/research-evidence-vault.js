import { buildLiteratureReviewExport } from './lib/literature-review-export.js'
// 证据库面板界面层（EvidenceVaultPane：列表/筛选/导入导出/Agent 批量初判/互链反查/项目整理）。
// 独立保存表单已拆至 src/evidence-save-form.js；子面板拆至 src/evidence-vault-sections.js；持久化在 src/lib/evidence-vault-sync.js。
import {
  Badge, Button, Card, Chip, ConfirmDangerButton, CountValue, EmptyState, Field, Input, Notice, Segmented, Select, Spinner, Toolbar,
} from './ui.js'
import { C, h } from './theme.js'
import { EvidenceVaultActionPanels, EvidenceVaultTopCards } from './evidence-vault-sections.js'
import {
  EVIDENCE_CLAIM_SUPPORT, EVIDENCE_DIMENSION_LABELS, EVIDENCE_IDENTIFIER_LABELS, EVIDENCE_STATUSES, EVIDENCE_STATUS_LABELS, EVIDENCE_STRENGTHS, EVIDENCE_STUDY_TYPES, EVIDENCE_TRACEABILITY, buildEvidenceExplainPack, detectIdentifier, filterEvidence, mergeEntries, parseEvidenceBackup, planCitationWrite, serializeEvidenceBackup, statusCounts,
} from './lib/evidence-vault-core.js'
import { RESEARCH_EVIDENCE_STANCES } from './lib/research-claims.js'
import { RESEARCH_TOPIC_OPTIONS, isControlledResearchTopic } from './lib/research-taxonomy.js'
import React from 'react'
import { activeResearchRun } from './research-context-store.js'
import {
  applyProjectOrganization, finalizeProjectOrganization, previewProjectOrganization, recoverProjectOrganizationJournal, undoProjectOrganization,
} from './project-organizer.js'
import { auditResearchDataQuality } from './lib/research-quality.js'
import { canWriteDraft, writeDraftText } from './lib/input-actions.js'
import { parseBibliography, serializeBibliography } from './lib/bibliography.js'
import { synchronizeResearchClaims, synchronizeClaimScopes } from './lib/claim-review-client.js'
import { downloadText, downloadJsonFile } from './lib/download.js'
import { planAgentEvidenceBatch } from './lib/agent-evidence-batch.js'
import { executeAgentEvidenceAssessment } from './lib/evidence-agent-runner.js'
import { groupDepositedItems, visibleDepositionTags } from './lib/deposition-taxonomy.js'
import { latestResearchScreening, researchLedgerSummary } from './lib/research-ledger.js'
import { pushToast } from './lib/toast.js'
import {
  STATUS_COLORS, clearEvidenceEntriesFromFile, evidenceVaultStore, formatEvidenceTime, getActiveProject, invalidateEvidenceSync, listAssetEvidenceLinks, persistEvidenceEntryToFile, publishEvidenceVault, removeEvidenceEntryFromFile, saveEvidenceEntry, setActiveProject, stamp, subscribeEvidenceVault, syncEvidenceVaultWithFiles,
} from './lib/evidence-vault-sync.js'

// 证据库面板：由沉淀层分区内嵌，不自带 PageHead（外壳与标题由分区提供）。
// assetTitlesById：灵感资产 id → 标题（由分区③传入），供「被引用于」反查显示；
// 缺失时优雅回落为「（资产不在当前列表）」，不阻塞渲染。
export function EvidenceVaultPane({ inputActions, sessionId, assetTitlesById = null, assetProvider = null, focusEvidenceIds = [], onNavigate = null }) {
  const store = evidenceVaultStore()
  const [entries, setEntries] = React.useState([])
  const [counts, setCounts] = React.useState({ all: 0 })
  const [pageCursor, setPageCursor] = React.useState(null)
  const [nextCursor, setNextCursor] = React.useState(null)
  const [pageHistory, setPageHistory] = React.useState([])
  const [selectedRows, setSelectedRows] = React.useState([])
  const [pendingOnly, setPendingOnly] = React.useState(false)
  const [syncStatus, setSyncStatus] = React.useState('读取本地数据')
  const [citationOpen, setCitationOpen] = React.useState(false)
  const [citationText, setCitationText] = React.useState('')
  const [citationPreviewRows, setCitationPreviewRows] = React.useState([])
  const [citationPicked, setCitationPicked] = React.useState([])
  const [citationWarnings, setCitationWarnings] = React.useState([])
  const [citationBusy, setCitationBusy] = React.useState(false)
  const [retryIds, setRetryIds] = React.useState([])
  const [workspaces, setWorkspaces] = React.useState([])
  const [showArchivedWorkspaces, setShowArchivedWorkspaces] = React.useState(false)
  const [workspaceNameDraft, setWorkspaceNameDraft] = React.useState('')
  const [workspaceRenameOpen, setWorkspaceRenameOpen] = React.useState(false)
  const [confirmArchiveWorkspace, setConfirmArchiveWorkspace] = React.useState(false)
  const [project, setProject] = React.useState(getActiveProject)
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState('all')
  const [groupByTopic, setGroupByTopic] = React.useState(true)
  const [selectedIds, setSelectedIds] = React.useState([])
  const [notice, setNoticeRaw] = React.useState('')
  const setNotice = React.useCallback((message, options = {}) => {
    const text = String(message || '')
    setNoticeRaw(text)
    if (text) {
      const isWarn = text.startsWith('⚠️')
      pushToast({
        message: text.replace(/^⚠️\s*/, ''),
        tone: options.tone || (isWarn ? 'warn' : 'info'),
        actionLabel: options.actionLabel,
        onAction: options.onAction,
      })
    }
  }, [])
  const appliedEvidenceFocus = React.useRef('')
  const focusEvidenceKey = (Array.isArray(focusEvidenceIds) ? focusEvidenceIds : []).map(String).filter(Boolean).slice(0, 4).join('\u0001')
  React.useEffect(() => {
    if (!focusEvidenceKey || appliedEvidenceFocus.current === focusEvidenceKey) return
    appliedEvidenceFocus.current = focusEvidenceKey
    const ids = focusEvidenceKey.split('\u0001')
    setSelectedIds(ids)
    setNotice(`已定位提案中的 ${ids.length} 条证据，可直接筛选、建立论断或插入对话。`)
  }, [focusEvidenceKey])
  const [newProject, setNewProject] = React.useState('')
  const [newProjectOpen, setNewProjectOpen] = React.useState(false)
  const [backup, setBackup] = React.useState('')
  const [backupOpen, setBackupOpen] = React.useState(false)
  const [assessmentNotes, setAssessmentNotes] = React.useState({})
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
  const [expandedAssessId, setExpandedAssessId] = React.useState('')
  const agentAbort = React.useRef(null)
  // 反查（入口 B，只读）：每条证据被哪些灵感资产引用，随订阅刷新。
  const [links, setLinks] = React.useState([])
  // 清空是不可逆的，用两段式确认代替 window.confirm（宿主可能屏蔽原生弹窗）。
  const [confirmClear, setConfirmClear] = React.useState(false)
  const [citationPreviewOpen, setCitationPreviewOpen] = React.useState(false)
  const entriesCountRef = React.useRef(0)
  entriesCountRef.current = entries.length
  const refreshVersion = React.useRef(0)
  React.useEffect(() => {
    let current = true
    store.getMany(selectedIds).then(rows => { if (current) setSelectedRows(rows) })
      .catch(error => { if (current) setNotice(`⚠️ 无法读取所选证据：${error.message}`) })
    return () => { current = false }
  }, [store, selectedIds, entries])
  const resetPages = () => { setPageCursor(null); setPageHistory([]) }
  const readScope = () => store.list({ project: project || undefined })

  const refresh = React.useCallback(async () => {
    const version = ++refreshVersion.current
    if (!entriesCountRef.current) setLoading(true)
    const readLocal = async () => {
      const ledger = await store.listResearchLedger({ project: project || undefined })
      const screenedIds = pendingOnly ? [...latestResearchScreening(ledger).values()].filter(row => row.decision !== 'pending').map(row => row.evidenceId).sort() : null
      const [page, counts, names, links, claims] = await Promise.all([
        store.listPage({ project: project || undefined, query, filter, cursor: pageCursor, screenedIds }),
        store.evidenceSummary({ project: project || undefined }),
        store.listWorkspaces({ includeArchived: true }), store.listAssetEvidenceLinks(),
        store.listResearchClaims({ project: project || undefined }),
      ])
      if (version !== refreshVersion.current) return
      setEntries(page.rows); setNextCursor(page.nextCursor); setCounts(counts)
      setWorkspaces(names || []); setLinks(links || []); setClaims(claims || []); setLedger(ledger)
      setLoading(false)
    }
    try {
      await readLocal()
      if (version !== refreshVersion.current) return
      setSyncStatus('正在同步文件与 Claim 台账')
      const synced = await syncEvidenceVaultWithFiles(project || undefined)
      await synchronizeClaimScopes(store, project || undefined)
      if (version !== refreshVersion.current) return
      await readLocal(); setSyncStatus(synced.ignored ? `已同步；${synced.ignored} 条文件记录无法导入，请检查元数据` : '已同步文件与 Claim 台账')
    } catch (error) {
      if (version !== refreshVersion.current) return
      if (error.message.includes('分页条件')) { setPageCursor(null); setPageHistory([]); return }
      setSyncStatus(`本地数据可用，同步／读取待重试：${error.message}`)
      setLoading(false)
    }
  }, [store, project, query, filter, pageCursor, pendingOnly])
  React.useEffect(() => { refresh() }, [refresh])
  React.useEffect(() => subscribeEvidenceVault(refresh), [refresh])
  React.useEffect(() => { recoverProjectOrganizationJournal(store).then(setOrganizerJournal).catch(error => setNotice(`⚠️ 项目整理恢复检查失败：${error.message}`)) }, [store])

  const quality = React.useMemo(() => auditResearchDataQuality({
    evidence: entries,
    links: links.filter(item => entries.some(row => row.id === item.evidenceId)),
    assetIds: assetTitlesById ? Object.keys(assetTitlesById) : null,
  }), [entries, links, project, assetTitlesById])
  const filtered = React.useMemo(() => filterEvidence(entries, { query, filter }), [entries, query, filter])
  const displayedEntries = React.useMemo(() => groupByTopic
    ? groupDepositedItems(filtered).flatMap(group => [{ id: `topic:${group.topic}`, __groupTopic: group.topic, __count: group.rows.length }, ...group.rows.map(row => ({ ...row, __displayKey: `${row.id}:${group.topic}` }))])
    : filtered, [filtered, groupByTopic])
  const selectedIdSet = React.useMemo(() => new Set(selectedIds), [selectedIds])
  // 「被引用于」反查索引：evidenceId → [{ assetId, title, known }]（支持直接点击跳去对应灵感资产）。
  const citedByIndex = React.useMemo(() => {
    const index = new Map()
    for (const link of links) {
      if (!index.has(link.evidenceId)) index.set(link.evidenceId, [])
      const title = assetTitlesById?.[link.assetId]
      index.get(link.evidenceId).push({
        assetId: link.assetId,
        title: title || `（资产 ${String(link.assetId).slice(0, 12)}… 不在当前列表）`,
        known: Boolean(title),
      })
    }
    return index
  }, [links, assetTitlesById])
  // 选择是用户明确做出的跨筛选状态：以 entries 而非 filtered 为基准，
  // 改筛选只影响「看见什么」，不会悄悄撤销「已选择什么」。
  const selectedEntries = React.useMemo(() => [...new Map([...selectedRows, ...entries].filter(item => selectedIdSet.has(item.id)).map(item => [item.id, item])).values()], [entries, selectedRows, selectedIdSet])
  const selectedAgentEligible = React.useMemo(
    () => planAgentEvidenceBatch(selectedEntries, { includeHuman: false }).eligible.length,
    [selectedEntries],
  )
  const canWrite = canWriteDraft(inputActions)
  // 写入决策走纯逻辑：只有 action === 'write' 才允许碰宿主输入框。
  // 「未选择不注入」由 evidence-vault-core 的回归测试守护，视图不再自行判断。
  const writePlan = React.useMemo(() => planCitationWrite({ entries: selectedEntries, canWrite }), [selectedEntries, canWrite])
  const citationPreview = writePlan.text
  const degraded = store.isDegraded()

  const switchProject = value => {
    resetPages(); setEntries([]); setSelectedRows([])
    setProject(value)
    setActiveProject(value)
    setConfirmClear(false)
    setSelectedIds([])
    setRetryIds([])
    setWorkspaceRenameOpen(false)
    setConfirmArchiveWorkspace(false)
  }
  const writeSelected = () => {
    if (writePlan.action !== 'write') return setNotice(writePlan.notice)
    const written = writeDraftText(inputActions, writePlan.text)
    setNotice(written.ok ? writePlan.notice : '草稿已变化，未自动写入引用；请选择后重新写入。')
  }

  const synchronizeResearchClaimsForVault = value => synchronizeClaimScopes(store, value || 'default')
  const saveClaim = async () => {
    if (!selectedEntries.length) return setNotice('请先勾选至少一条证据。')
    try {
      if (selectedEntries.length > 30) throw new Error('一次最多关联 30 条证据，请减少所选条目。')
      if (new Set(selectedEntries.map(item => item.project || '')).size > 1) throw new Error('论断只能关联同一项目的证据，请先切换到具体项目。')
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
      await syncEvidenceVaultWithFiles(project || selectedEntries[0].project || undefined, { force: true })
      await synchronizeResearchClaimsForVault(selectedEntries[0].project || project)
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

  const exportJson = async () => {
    try {
      const entries = await readScope()
      const entryIds = new Set(entries.map(item => item.id))
      const scopedClaims = claims.filter(item => item.links.every(link => entryIds.has(link.evidenceId)))
      const scopedLinks = links.filter(item => entryIds.has(item.evidenceId))
      const scopedWorkspaces = workspaces.filter(item => (!project || item.projectKey === project)
        && (item.origin === 'user' || item.updatedAt > 0))
      const text = serializeEvidenceBackup({ entries, project, claims: scopedClaims, links: scopedLinks, ledger, workspaces: scopedWorkspaces })
      const suffix = project || '全部项目'
      downloadJsonFile(text, `dsh-research-kit-evidence-${suffix}-${stamp()}.json`)
      setNotice(`已导出 ${entries.length} 条证据、${scopedClaims.length} 条论断、${scopedLinks.length} 条关联、${ledger.length} 条账本事件与 ${scopedWorkspaces.length} 个课题设置。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  // 解释图素材包：按当前筛选范围导出（通常先筛「已核验」），供 render-diagrams --evidence 并入「证据库来源」卡片。
  const exportExplainPack = async () => {
    try {
      const entries = await readScope()
      const filtered = filterEvidence(entries, { query, filter })
      if (!filtered.length) return setNotice('当前筛选范围内没有可导出的证据条目。')
      const text = JSON.stringify(buildEvidenceExplainPack(filtered, project), null, 2) + '\n'
      const suffix = project || '全部项目'
      downloadJsonFile(text, `evidence-explain-pack-${suffix}-${stamp()}.json`)
      setNotice(`已导出 ${filtered.length} 条证据作为解释图素材（按当前筛选范围；渲染时用 --evidence <路径> 并入）。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }
  const exportResearchRecord = async () => {
    try {
      const entries = await readScope()
      const includedIds = new Set([...latestResearchScreening(ledger).values()]
        .filter(item => item.decision === 'include').map(item => item.evidenceId))
      const cited = entries.filter(item => includedIds.has(item.id)).map(item => ({
        id: item.id, title: item.title, identifier: item.identifier, identifierKind: item.identifierKind,
        url: item.url, project: item.project, status: item.status,
      }))
      downloadJsonFile(JSON.stringify({ kind: 'dsh-research-record', version: 1, exportedAt: Date.now(), project,
        ledger, claims, citations: cited }, null, 2) + '\n', `dsh-research-record-${project || 'all'}-${stamp()}.json`)
      setNotice(`已导出 ${ledger.length} 条账本事件、${claims.length} 条论断及 ${cited.length} 条纳入来源。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  const exportLiteratureReview = async () => {
    try {
      const scope = project || ''
      const [{ claims: latestClaims }, entries, events] = await Promise.all([
        synchronizeResearchClaims(store, scope),
        store.list({ project: scope }),
        store.listResearchLedger({ project: scope }),
      ])
      const report = buildLiteratureReviewExport({
        project: scope, entries: entries.filter(item => (item.project || '') === scope),
        claims: latestClaims.filter(item => (item.project || '') === scope),
        ledger: events.filter(item => (item.project || '') === scope),
      })
      downloadJsonFile(JSON.stringify(report, null, 2) + '\n', `research-literature-review-${stamp()}.json`)
      setNotice(`已导出 ${report.summary.candidates} 条候选文献与 ${report.claims.length} 条论断的审核记录。`)
    } catch (error) { setNotice(`导出失败：${error.message}`) }
  }

  const previewCitations = overrideText => {
    const raw = typeof overrideText === 'string' ? overrideText : citationText
    try {
      const result = parseBibliography(raw)
      setCitationPreviewRows(result.entries); setCitationWarnings(result.warnings)
      setCitationPicked(result.entries.map((_, index) => index))
    } catch (error) { setNotice(`⚠️ ${error.message}`) }
  }
  const importCitations = async () => {
    if (citationBusy) return
    setCitationBusy(true)
    let added = 0, skipped = 0
    try {
      for (const index of citationPicked) {
        try { await store.save({ ...citationPreviewRows[index], project, status: 'unverified' }); added++ }
        catch (error) { if (error.code === 'DUPLICATE') skipped++; else throw error }
      }
      setNotice(`已保存 ${added} 条待核验引用，跳过 ${skipped} 条重复来源。`)
      setCitationPreviewRows([]); setCitationPicked([]); setCitationText(''); setCitationOpen(false)
      publishEvidenceVault()
    } catch (error) { setNotice(`⚠️ 已保存 ${added} 条；导入未完成：${error.message}`); publishEvidenceVault() }
    finally { setCitationBusy(false) }
  }
  const exportCitations = async format => {
    try {
      const rows = selectedEntries.length ? selectedEntries : filterEvidence(await readScope(), { query, filter })
      downloadText(serializeBibliography(rows, format), 'text/plain;charset=utf-8', `research-citations.${format === 'ris' ? 'ris' : 'bib'}`)
      setNotice(`已导出 ${rows.length} 条引用（${selectedEntries.length ? '已选条目' : '完整筛选范围'}）。`)
    } catch (error) { setNotice(`⚠️ ${error.message}`) }
  }
  const exportScreeningReport = async () => {
    try {
      const rows = await readScope()
      const decisions = latestResearchScreening(ledger)
      const current = rows.map(row => ({ evidenceId: row.id, title: row.title, ...(decisions.get(row.id) || { decision: 'pending', reason: '尚未筛选' }) }))
      const excludedReasons = {}
      for (const row of current) if (row.decision === 'exclude') excludedReasons[row.reason] = (excludedReasons[row.reason] || 0) + 1
      const summary = { candidates: rows.length, included: current.filter(row => row.decision === 'include').length,
        excluded: current.filter(row => row.decision === 'exclude').length, pending: current.filter(row => row.decision === 'pending').length }
      downloadJsonFile(JSON.stringify({ kind: 'research-screening-report', version: 1, project, exportedAt: Date.now(),
        scope: '仅本地已保存候选，非数据库完整检索或完整 PRISMA 流程', summary, excludedReasons, records: current }, null, 2), `research-screening-${stamp()}.json`)
      setNotice(`已导出有限候选集的 PRISMA 计数：候选 ${summary.candidates}、纳入 ${summary.included}、排除 ${summary.excluded}、待定 ${summary.pending}。`)
    } catch (error) { setNotice(`⚠️ ${error.message}`) }
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
      const [entry] = await store.getMany([item.id])
      if (!entry) return
      const links = await store.listAssetEvidenceLinks({ evidenceId: entry.id })
      await removeEvidenceEntryFromFile(entry)
      await store.remove(entry.id)
      publishEvidenceVault()
      setNotice(`已删除「${item.title}」。`, {
        actionLabel: '撤销',
        onAction: async () => {
          try {
            const restored = await store.restoreDeletedEvidence(entry, links)
            const synced = await persistEvidenceEntryToFile(restored)
            publishEvidenceVault()
            pushToast({ message: synced ? `已恢复「${item.title}」及其关联。` : `已在本地恢复「${item.title}」及其关联。` })
          } catch (error) {
            pushToast({ message: `恢复失败：${error?.message || error}`, tone: 'warn' })
          }
        },
      })
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  const changeStatus = async (item, status) => {
    if (status === item.status) return
    try {
      const result = await saveEvidenceEntry({ ...item, status, sourceVerification: status }, { onDuplicate: 'update' })
      setNotice(`${result.fileSynced ? '' : '⚠️ 已保存在本地，文件同步待重试。'}「${item.title}」已标记为${EVIDENCE_STATUS_LABELS[status]}。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }
  const changeAssessment = async (item, key, value, reason = item.assessmentReason || '') => {
    try {
      const next = { ...item, [key]: value, assessmentReason: reason, assessedAt: Date.now(), assessedBy: 'researcher' }
      if (key === 'strength') next.grade = value
      const result = await saveEvidenceEntry(next, { onDuplicate: 'update' })
      setNotice(`${result.fileSynced ? '' : '⚠️ 已保存在本地，文件同步待重试。'}「${item.title}」的人工评估已更新。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }
  const saveAssessmentReason = item => changeAssessment(item, 'assessmentReason', assessmentNotes[item.id] ?? item.assessmentReason ?? '', assessmentNotes[item.id] ?? item.assessmentReason ?? '')

  const runAgentAssessment = async (requestedEntries) => {
    if (agentBusy) return
    if (!requestedEntries) {
      try { requestedEntries = await readScope() } catch (error) { return setNotice(`⚠️ ${error.message}`) }
    }
    const controller = new AbortController()
    agentAbort.current = controller
    setAgentBusy(true)
    try {
      const result = await executeAgentEvidenceAssessment({
        entries: requestedEntries,
        sessionId,
        includeHuman: false,
        store,
        signal: controller.signal,
        onProgress: setAgentProgress,
        onStats: setAgentStats,
      })
      setRetryIds(result.remainingIds || [])
      setNotice(result.empty ? '所选证据均已人工处理；如需重判，请到「本次研究 → 科研梦境 → 批量初判」勾选「包含人工处理过的」。' : result.message)
    } catch (error) {
      setRetryIds(error.remainingIds || [])
      setNotice(`⚠️ ${error.message}`)
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

  const syncHasIssue = /待重试|无法导入|失败/.test(syncStatus)
  return h('div', { key: 'evidence-vault', style: { display: 'grid', gap: 12 } }, [
    h('div', { key: 'sync-status', role: 'status', style: { fontSize: 12, color: syncHasIssue ? C.amber : C.muted, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' } }, [
      syncHasIssue ? h('span', { key: 'msg', style: { marginRight: 'auto' } }, syncStatus) : null,
      h(Button, { key: 'retry', size: 'sm', variant: syncHasIssue ? 'soft' : 'quiet', icon: 'refresh', onClick: () => { invalidateEvidenceSync(project); refresh() } }, '重试同步'),
    ]),
    retryIds.length ? h(Button, { key: 'retry-agent', size: 'sm', disabled: agentBusy, onClick: async () => { try { await runAgentAssessment(await store.getMany(retryIds)) } catch (error) { setNotice(`⚠️ ${error.message}`) } } }, `继续未完成判断（${retryIds.length}）`) : null,
    degraded && !loading ? h(Notice, { key: 'degraded', tone: 'warn', icon: 'shield' },
      '当前浏览器不支持本地保存，刷新页面后记录会清空。建议随时通过右上角「时空囊」导出备份。') : null,
    notice && notice.startsWith('⚠️') ? h(Notice, { key: 'notice', tone: 'warn', icon: 'shield' },
      notice.replace(/^⚠️\s*/, '')) : null,

    // 项目与维护动作：一次性操作，不随滚动吸顶（分层原则见 docs/ARCHITECTURE.md §2.3）。
    h(EvidenceVaultTopCards, {
      key: 'top-cards',
      project, projectOptions, switchProject, activeWorkspace,
      newProjectOpen, setNewProjectOpen, newProject, setNewProject, createProject,
      workspaceRenameOpen, setWorkspaceRenameOpen, workspaceNameDraft, setWorkspaceNameDraft, renameProject,
      confirmArchiveWorkspace, setConfirmArchiveWorkspace, toggleProjectArchive,
      showArchivedWorkspaces, setShowArchivedWorkspaces,
      entries, claims, ledger, workspaces, filtered, counts,
      exportJson, exportExplainPack, setCitationOpen, exportCitations, backupOpen, setBackupOpen,
      confirmClear, setConfirmClear, clearScope,
      organizerBusy, loading, organizerJournal, previewOrganizer, undoOrganizer, finalizeOrganizer,
      organizerProgress, organizerLog, organizerPlan, setOrganizerPlan, applyOrganizer,
      backup, setBackup, importJson,
      quality,
      citationOpen, citationBusy, setNotice, citationText, setCitationText,
      citationPreviewRows, setCitationPreviewRows, citationPicked, setCitationPicked,
      previewCitations, citationWarnings, importCitations,
    }),
    // 二级吸顶带：检索与状态筛选是「随时要用的操作」，分层原则见 docs/ARCHITECTURE.md §2.3。
    h(Toolbar, { key: 'filters', sticky: true }, [
      h('div', { key: 'search', style: { position: 'relative', flex: '1 1 240px', minWidth: 180 } }, [
        h(Input, { key: 'i', value: query, onChange: value => { resetPages(); setQuery(value) }, placeholder: '搜索标题、来源、标识符、课题、标签……', ariaLabel: '搜索证据条目' }),
      ]),
      h(Segmented, { key: 'tabs', value: filter, options: filterOptions, onChange: value => { resetPages(); setFilter(value) }, ariaLabel: '证据核验状态筛选' }),
      h(Button, { key: 'pending', size: 'sm', variant: pendingOnly ? 'soft' : 'ghost', 'aria-pressed': pendingOnly, onClick: () => { resetPages(); setPendingOnly(value => !value) } }, '待筛选队列'),
      h(Button, { key: 'group', size: 'sm', variant: groupByTopic ? 'soft' : 'ghost', onClick: () => setGroupByTopic(value => !value), 'aria-pressed': groupByTopic }, groupByTopic ? '按主题分组 ✓' : '按主题分组'),
    ]),
    selectedEntries.length ? h('div', { key: 'selection-bar', className: 'rk-selection-bar rk-reveal', role: 'region', 'aria-label': '已选证据批量操作' }, [
      h('strong', { key: 'count', style: { fontSize: 12, color: C.teal } }, ['已选 ', h(CountValue, { key: 'n', value: selectedEntries.length }), ' 条']),
      h(Button, {
        key: 'assess-selected', size: 'sm', variant: 'soft',
        disabled: agentBusy || loading || !selectedAgentEligible || !sessionId,
        title: !sessionId ? '当前无活跃会话，暂不可调用 Agent 模型' : !selectedAgentEligible ? '所选条目均已人工处理；如需重判请到「科研梦境 → 批量初判」勾选包含人工处理过的' : undefined,
        onClick: () => runAgentAssessment(selectedEntries),
      }, agentBusy ? (agentProgress || '初判中…') : `初判所选（${selectedAgentEligible}/${selectedEntries.length}）`),
      agentBusy ? h(Button, { key: 'cancel-agent', size: 'sm', variant: 'ghost', onClick: () => agentAbort.current?.abort() }, '取消') : null,
      h(Button, { key: 'check-source', size: 'sm', variant: 'ghost', disabled: sourceCheckBusy || loading || !selectedEntries.length, onClick: checkSelectedSources }, sourceCheckBusy ? sourceCheckProgress : `核对来源（${selectedEntries.length}）`),
      h(Button, { key: 'screen', size: 'sm', variant: 'ghost', disabled: !selectedEntries.length, onClick: () => setScreeningOpen(value => !value) }, `筛选（${selectedEntries.length}）`),
      h(Button, { key: 'claim', size: 'sm', variant: 'ghost', disabled: !selectedEntries.length, onClick: () => setClaimFormOpen(value => !value) }, `建立论断（${selectedEntries.length}）`),
      h(Button, { key: 'write', size: 'sm', variant: 'primary', icon: 'edit', disabled: !selectedEntries.length || !canWrite, onClick: writeSelected }, `插入对话（${selectedEntries.length}）`),
      h(Button, { key: 'preview-toggle', size: 'sm', variant: citationPreviewOpen ? 'soft' : 'quiet', 'aria-expanded': citationPreviewOpen, onClick: () => setCitationPreviewOpen(open => !open) }, citationPreviewOpen ? '收起引用预览' : '预览引用块'),
      h(Button, { key: 'clear-sel', size: 'sm', variant: 'quiet', onClick: () => { setSelectedIds([]); setCitationPreviewOpen(false) }, style: { marginLeft: 'auto' } }, '取消选择'),
    ]) : null,
    agentBusy && agentStats ? h('div', { key: 'agent-progress', className: 'rk-reveal', role: 'status', style: { display: 'grid', gap: 6, padding: '8px 12px', background: C.surfaceAlt, border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 12, color: C.muted } }, [
      h('div', { key: 'line', style: { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } }, [
        h('strong', { key: 'phase', style: { color: C.ink } }, agentStats.phase),
        h('span', { key: 'count' }, `已完成 ${agentStats.completed} / ${agentStats.total} · 跳过 ${agentStats.skipped} · 失败 ${agentStats.failed}`),
      ]),
      h('div', { key: 'bar', style: { height: 6, borderRadius: 99, background: C.line, overflow: 'hidden' } },
        h('div', { className: 'rk-progress-fill', style: { width: '100%', height: '100%', background: C.teal, transform: `scaleX(${Math.min(1, (agentStats.completed + agentStats.skipped + agentStats.failed) / Math.max(1, agentStats.total))})` } })),
    ]) : null,
    h(EvidenceVaultActionPanels, {
      key: 'action-panels',
      screeningOpen, setScreeningOpen, selectedEntries, screeningDecision, setScreeningDecision,
      screeningReason, setScreeningReason, saveScreening,
      claimFormOpen, setClaimFormOpen, claimQuestion, setClaimQuestion, claimStatement, setClaimStatement,
      claimStance, setClaimStance, claimLocator, setClaimLocator, claimStudyDesign, setClaimStudyDesign,
      claimSample, setClaimSample, claimResult, setClaimResult, claimLimitations, setClaimLimitations, saveClaim,
      claims, ledger, counts, entries,
      exportLiteratureReview, exportScreeningReport, artifactOpen, setArtifactOpen, exportResearchRecord,
      artifactTitle, setArtifactTitle, artifactDataset, setArtifactDataset, artifactCode, setArtifactCode,
      artifactParameters, setArtifactParameters, artifactEnvironment, setArtifactEnvironment,
      artifactOutput, setArtifactOutput, artifactExecution, setArtifactExecution, saveArtifact,
    }),
    selectedEntries.length && citationPreviewOpen ? h(Card, { key: 'preview', className: 'rk-reveal', style: { padding: 12, background: C.tealTint, border: `1px solid ${C.tealLine}` } }, [
      h('strong', { key: 't', style: { fontSize: 13 } }, `引用块预览（${selectedEntries.length} 条）`),
      h('pre', { key: 'p', style: { margin: '8px 0 0', whiteSpace: 'pre-wrap', fontFamily: C.fontMono, fontSize: 12, lineHeight: 1.55 } }, citationPreview),
    ]) : null,
    loading ? h(Spinner, { key: 'loading', text: '正在加载证据条目……' }) : null,
    !loading && !filtered.length ? h(EmptyState, {
      key: 'empty',
      icon: 'database',
      text: entries.length ? '没有匹配的证据条目。' : (project ? `课题「${project}」还没有证据。` : '证据库还是空的。'),
      hint: entries.length ? '调整搜索或筛选条件。' : '在「科研工具 → 查来源」中查询公开数据源，逐条点「保存到证据库」。',
      action: !entries.length && typeof onNavigate === 'function' ? h(Button, { size: 'sm', variant: 'primary', onClick: () => onNavigate('catalog', { type: 'database' }) }, '去查文献') : null,
    }) : null,
    h('nav', { key: 'pagination', 'aria-label': '证据分页', style: { display: 'flex', gap: 8, alignItems: 'center' } }, [
      h(Button, { key: 'previous', size: 'sm', disabled: !pageHistory.length || loading, onClick: () => { setPageCursor(pageHistory.at(-1)); setPageHistory(rows => rows.slice(0, -1)) } }, '上一页'),
      h('span', { key: 'page', role: 'status', style: { fontSize: 12 } }, `第 ${pageHistory.length + 1} 页 · 本页 ${entries.length} 条 · 完整范围 ${counts.all} 条`),
      h(Button, { key: 'next', size: 'sm', disabled: !nextCursor || loading, onClick: () => { setPageHistory(rows => [...rows, pageCursor]); setPageCursor(nextCursor) } }, '下一页'),
    ]),
    h('div', { key: 'list', style: { display: 'grid', gap: 12 }     }, displayedEntries.map(item => item.__groupTopic ? h('div', { key: item.id, role: 'heading', 'aria-level': 3, style: { fontSize: 14, fontWeight: 700, color: C.teal, marginTop: 8 } }, `${item.__groupTopic} · ${item.__count}`) : h(Card, {
      key: item.__displayKey || item.id,
      'data-dream-focus': item.id,
      interactive: true,
      style: { contentVisibility: 'auto', containIntrinsicSize: '0 300px' },
    }, [
      h('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' } }, [
        h('div', { key: 'meta', style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 } }, [
          h('input', { key: 'select', type: 'checkbox', checked: selectedIdSet.has(item.id), onChange: () => setSelectedIds(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id]), 'aria-label': `选择「${item.title}」用于批量处理或插入对话`, style: { accentColor: C.teal } }),
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
          item.project ? h('p', { key: 'project', style: { margin: 0 } }, `课题：${item.project}`) : null,
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
        classificationEditId === item.id ? (() => {
          const picked = new Set(classificationDraft.split(/[;；\n]/).map(part => part.trim()).filter(Boolean))
          const toggleTopic = key => {
            const next = new Set(picked)
            if (next.has(key)) next.delete(key); else next.add(key)
            setClassificationDraft([...next].join('；'))
          }
          return h('div', { key: 'form', className: 'rk-reveal', style: { display: 'grid', gap: 8, padding: 10, borderRadius: 8, background: C.surfaceAlt, border: `1px solid ${C.line}` } }, [
            h('div', { key: 'chips', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, RESEARCH_TOPIC_OPTIONS.map(topic => {
              const key = `${topic.primary}/${topic.secondary}`
              const active = picked.has(key)
              return h(Button, {
                key, size: 'sm', variant: active ? 'primary' : 'ghost', 'aria-pressed': active,
                onClick: () => toggleTopic(key),
              }, `${topic.primary} · ${topic.secondary}`)
            })),
            h('div', { key: 'save-row', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
              h(Button, { key: 'save', size: 'sm', variant: 'primary', onClick: () => saveClassification(item) }, '保存人工分类'),
              h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => setClassificationEditId('') }, '取消'),
            ]),
          ])
        })() : null,
      ]),
      // 入口 B（反查跳转）：这条证据被哪些灵感资产引用，点击可直接跳到对应资产。
      citedByIndex.get(item.id)?.length
        ? h('div', { key: 'cited-by', style: { fontSize: 12, color: C.muted, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' } }, [
          h('span', { key: 'l', style: { color: C.teal, fontWeight: 650 } }, '被引用于：'),
          ...citedByIndex.get(item.id).map((ref, index) => ref.known && typeof onNavigate === 'function'
            ? h(Button, {
              key: `${ref.assetId}:${index}`, size: 'sm', variant: 'quiet',
              onClick: () => onNavigate('vault', { tab: 'assets', assetId: ref.assetId }),
              style: { padding: '2px 7px', fontSize: 12, color: C.teal },
            }, ref.title)
            : h('span', { key: `${ref.assetId}:${index}` }, index === 0 ? ref.title : `、${ref.title}`)),
        ])
        : null,
      h('div', { key: 'foot', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 } }, [
        item.status === 'unverified' ? h(Button, { key: 'quick-verify', size: 'sm', variant: 'soft', icon: 'check', onClick: () => changeStatus(item, 'verified') }, '标记已核验') : null,
        h('span', { key: 'label', style: { fontSize: 12, color: C.muted } }, '核验状态'),
        h(Select, {
          key: 'status',
          value: item.status,
          options: EVIDENCE_STATUSES.map(status => ({ value: status, label: EVIDENCE_STATUS_LABELS[status] })),
          onChange: value => changeStatus(item, value),
          ariaLabel: `设置「${item.title}」的核验状态`,
          style: { width: 'auto', minWidth: 96 },
        }),
        h(Button, {
          key: 'assess-toggle', size: 'sm', variant: expandedAssessId === item.id ? 'soft' : 'ghost',
          'aria-expanded': expandedAssessId === item.id,
          onClick: () => setExpandedAssessId(current => current === item.id ? '' : item.id),
        }, expandedAssessId === item.id ? '收起细评 ▴' : `细评 · ${EVIDENCE_DIMENSION_LABELS.strength[item.strength || 'ungraded']} ▾`),
        h('span', { key: 'spacer', style: { flex: '1 1 auto' } }),
        h(ConfirmDangerButton, {
          key: 'delete', label: '删除', confirmLabel: '确认删除？', title: '删除后可在提示条中撤销',
          onConfirm: () => removeEntry(item),
        }),
      ]),
      expandedAssessId === item.id ? h('div', { key: 'assessment', className: 'rk-reveal', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 8, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}` } }, [
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
      ]) : null,
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
