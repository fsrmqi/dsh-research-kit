import React from 'react'
import { h, C } from './theme.js'
import { Badge, Button, Card, Notice, Segmented, Spinner } from './ui.js'
import {
  DREAM_MODES,
  buildDreamSnapshot,
  buildWakeBrief,
  composeDreamInputs,
  mergeDreamProposals,
  normalizeDreamMode,
  planDreamAccept,
  runLocalDream,
  scopeDreamRecords,
  shouldSkipDream,
  formatDreamCompressionSummary,
} from './lib/research-dream.js'
import {
  getDreamAutoEnabled,
  getDreamWatermark,
  getHandledDreamSignatures,
  getPreferredDreamMode,
  latestDreamReport,
  listDreamReports,
  listStoredDreamAssets,
  pendingDreamInbox,
  saveDreamReport,
  setDreamAutoEnabled,
  setDreamWatermark,
  setPreferredDreamMode,
  subscribeDreamStore,
  updateDreamProposalStatus,
} from './dream-store.js'
import { evidenceVaultStore, linkAssetToEvidence, subscribeEvidenceVault } from './lib/evidence-vault-sync.js'
import { requestResearchClaims } from './lib/claim-review-client.js'
import { planAgentEvidenceBatch } from './lib/agent-evidence-batch.js'
import { executeAgentEvidenceAssessment } from './lib/evidence-agent-runner.js'
import {
  DREAM_MEMORY_PATH, coverIndex, dreamMemoryRefsExist, looseMemoryCards, memoryCardFromProposal, retireCoveredRecords, themeFromCards,
} from './lib/dream-memory.js'
import { researchAssetProvider } from '../dsh/prompt-studio-glue.js'
import { knowledgeStore } from './knowledge-store.js'
import { listResearchRuns } from './research-context-store.js'
import { supportsSafeInsert } from './lib/input-actions.js'
import { pushToast } from './lib/toast.js'

const MODE_LABELS = Object.fromEntries(DREAM_MODES.map(item => [item.value, item.label]))
const KIND_LABELS = {
  duplicate_evidence: '重复证据',
  conflict_alert: '立场冲突',
  link_suggestion: '关联建议',
  stale_review: '优先核验',
  gap_clue: '缺口线索',
  bridge_insight: '跨文献桥接',
  hypothesis_draft: '待核验假说',
}

function formatDreamTime(at) {
  if (!at) return ''
  try {
    return new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function ResearchDreamPanel({
  project = '',
  sessionId = '',
  claims = [],
  onNavigate,
  inputActions,
}) {
  const [mode, setMode] = React.useState(getPreferredDreamMode)
  const [autoEnabled, setAutoEnabled] = React.useState(getDreamAutoEnabled)
  const [prefsOpen, setPrefsOpen] = React.useState(false)
  const [batchOpen, setBatchOpen] = React.useState(false)
  const [batchEntries, setBatchEntries] = React.useState([])
  const [includeHuman, setIncludeHuman] = React.useState(false)
  const [batchBusy, setBatchBusy] = React.useState(false)
  const [batchProgress, setBatchProgress] = React.useState('')
  const [batchStats, setBatchStats] = React.useState(null)
  const [batchRetryIds, setBatchRetryIds] = React.useState([])
  const batchAbort = React.useRef(null)
  const mounted = React.useRef(false)
  const memoryBusy = React.useRef(false)
  React.useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; batchAbort.current?.abort() }
  }, [])
  const [memory, setMemory] = React.useState(() => ({ schemaVersion: 1, project, cards: [], themes: [] }))
  const [running, setRunning] = React.useState(false)
  const dreamLock = React.useRef(false)
  const [feedback, setFeedback] = React.useState('')
  const [revision, setRevision] = React.useState(0)
  React.useEffect(() => subscribeDreamStore(() => setRevision(v => v + 1)), [])
  const loadBatchScope = React.useCallback(async () => {
    try {
      const rows = await evidenceVaultStore().list({ project: project || undefined })
      if (mounted.current) setBatchEntries(rows || [])
    } catch { /* 本地证据库不可读时保持空列表 */ }
  }, [project])
  React.useEffect(() => {
    if (!batchOpen) return undefined
    loadBatchScope()
    return subscribeEvidenceVault(loadBatchScope)
  }, [batchOpen, loadBatchScope])
  const batchPlan = React.useMemo(
    () => planAgentEvidenceBatch(batchEntries, { includeHuman }),
    [batchEntries, includeHuman],
  )
  const runBatchAssessment = async requestedEntries => {
    if (!mounted.current || batchAbort.current) return
    const controller = new AbortController()
    batchAbort.current = controller
    const store = evidenceVaultStore()
    setBatchBusy(true)
    setFeedback('')
    try {
      const target = requestedEntries
        ? await store.getMany(requestedEntries)
        : await store.list({ project: project || undefined })
      if (controller.signal.aborted) return
      const result = await executeAgentEvidenceAssessment({
        entries: project ? scopeDreamRecords(target, project) : target,
        sessionId,
        includeHuman,
        store,
        signal: controller.signal,
        onProgress: value => { if (mounted.current) setBatchProgress(value) },
        onStats: value => { if (mounted.current) setBatchStats(value) },
      })
      if (!mounted.current) return
      setBatchRetryIds(result.remainingIds || [])
      setFeedback(result.message)
      pushToast({ message: result.message })
    } catch (error) {
      if (!mounted.current) return
      setBatchRetryIds(error.remainingIds || [])
      setFeedback(error.message)
      pushToast({ message: error.message, tone: 'warn' })
    } finally {
      batchAbort.current = null
      if (mounted.current) setBatchBusy(false)
      setBatchProgress('')
    }
  }

  const reports = React.useMemo(() => listDreamReports(project), [project, revision])
  const latest = reports[0] || latestDreamReport(project)
  const pendingProposals = React.useMemo(() => pendingDreamInbox(reports), [reports])
  const handledProposals = React.useMemo(() => {
    const seen = new Set()
    const items = []
    for (const report of reports) {
      for (const item of report.proposals || []) {
        if (!item || item.status === 'pending') continue
        const key = String(item.signature || item.id || '')
        if (!key || seen.has(key)) continue
        seen.add(key)
        items.push(item)
      }
    }
    return items
  }, [reports])
  const currentModeMeta = DREAM_MODES.find(item => item.value === mode) || DREAM_MODES[0]
  const wake = buildWakeBrief({
    pending: pendingProposals,
    run: listResearchRuns({ project })[0] || null,
    report: latest,
  })

  const changeMode = next => {
    const saved = setPreferredDreamMode(next)
    setMode(saved)
  }

  const runDream = async ({ force = false, auto = false } = {}) => {
    if (running || dreamLock.current) return
    dreamLock.current = true
    setRunning(true)
    setFeedback('')
    try {
      const now = Date.now()
      let activeMemory = memory
      try { activeMemory = await loadMemory() } catch { /* 沿用当前课题已读取的记忆 */ }
      if (!mounted.current) return
      const retired = coverIndex(activeMemory)
      const store = evidenceVaultStore()
      const kStore = knowledgeStore()
      const [evidence, allNodes, allKnowledgeClaims] = await Promise.all([
        store.list({ project }),
        kStore.listNodes(),
        kStore.listClaims(),
      ])
      let assets = listStoredDreamAssets()
      if (typeof researchAssetProvider?.list === 'function') {
        try { assets = await researchAssetProvider.list() } catch { /* 灵感服务未就绪时使用本地库 */ }
      }
      const scopedNodes = scopeDreamRecords(allNodes, project)
      const scopedKnowledgeClaims = scopeDreamRecords(allKnowledgeClaims, project)
      const scopedAssets = scopeDreamRecords(assets, project)
      const runs = listResearchRuns({ project })
      const watermark = getDreamWatermark(project)
      const composed = composeDreamInputs({
        evidence: retireCoveredRecords(evidence, 'evidence', retired),
        claims: retireCoveredRecords(claims, 'claims', retired),
        knowledgeNodes: retireCoveredRecords(scopedNodes, 'knowledgeNodes', retired),
        knowledgeClaims: retireCoveredRecords(scopedKnowledgeClaims, 'knowledgeClaims', retired),
        assets: retireCoveredRecords(scopedAssets, 'assets', retired),
        runs,
        watermark,
        anchorCursor: watermark?.coldCursor ?? watermark?.anchorCursor ?? 0,
        force,
      })
      const decision = shouldSkipDream({
        deltaCount: composed.deltaCount,
        anchorFingerprint: composed.anchorFingerprint,
        coldCount: composed.coldCount,
        coldCursor: composed.coldCursor,
        watermark,
        now,
        force: force || !auto,
        auto,
      })
      if (decision.skip) {
        setFeedback(decision.reason === 'cooldown'
          ? '距上次自动整理不足 6 小时，已跳过。'
          : '当前课题的较早记录均已看过，有新材料后会继续整理。')
        return
      }
      const snapshot = buildDreamSnapshot({
        project,
        evidence: composed.evidence,
        claims: composed.claims,
        knowledgeNodes: composed.knowledgeNodes,
        knowledgeClaims: composed.knowledgeClaims,
        assets: composed.assets,
        runs: composed.runs,
      })
      snapshot.counts = {
        ...snapshot.counts,
        corpusEvidence: composed.totals.evidence,
        delta: composed.deltaCount,
      }
      const handledSignatures = getHandledDreamSignatures(project)
      const localResult = runLocalDream({ snapshot, mode, handledSignatures, now })

      let finalReport = { ...localResult, project }
      let fallbackNotice = ''
      const modelWorthCalling = composed.deltaCount > 0
        && (snapshot.counts.evidence + snapshot.counts.claims + snapshot.counts.knowledgeNodes + snapshot.counts.assets > 0)

      if (sessionId && modelWorthCalling) {
        try {
          const query = new URLSearchParams({ session_id: sessionId })
          const response = await fetch(`/dsh-research-kit/research-dream?${query}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode, snapshot, handled_signatures: handledSignatures }),
            signal: AbortSignal.timeout(45_000),
          })
          const payload = await response.json()
          if (response.ok && payload?.ok && Array.isArray(payload.proposals) && payload.proposals.length > 0) {
            const safeMode = normalizeDreamMode(payload.mode || mode)
            const proposals = safeMode === 'full'
              ? mergeDreamProposals({ local: localResult.proposals, host: payload.proposals, mode: 'full' })
              : payload.proposals
            finalReport = {
              project,
              mode: safeMode,
              engine: safeMode === 'full' ? 'merged' : 'host-llm',
              model: payload.model || '',
              createdAt: Date.now(),
              counts: snapshot.counts,
              digest: formatDreamCompressionSummary(snapshot.counts, proposals.length),
              proposals,
            }
          } else if (!response.ok) {
            fallbackNotice = `宿主模型暂不可用（${payload?.error || `HTTP ${response.status}`}），已自动切回本地规则引擎。`
          }
        } catch {
          fallbackNotice = '宿主模型暂不可达，已自动使用本地规则引擎完成提炼。'
        }
      }

      if (!mounted.current) return
      saveDreamReport(finalReport)
      setDreamWatermark(project, {
        at: now,
        lastDreamAt: now,
        anchorFingerprint: composed.anchorFingerprint,
        anchorCursor: composed.nextColdCursor,
        coldCursor: composed.nextColdCursor,
      })
      const coldNote = composed.coldTaken
        ? `其中 ${composed.coldTaken} 条是最久没回顾的冷记录，采纳或忽略后不再重复推。`
        : ''
      const kept = composed.totals.evidence - snapshot.counts.evidence
      setFeedback(fallbackNotice || (finalReport.proposals.length
        ? `梦境完成：窗口内 ${snapshot.counts.evidence} 条证据压成 ${finalReport.proposals.length} 条提案。${coldNote}${kept > 0 ? `另有 ${kept} 条更早的记录仍留在主库。` : ''}`
        : composed.coldTaken
          ? `没有新的高信号提案。这 ${composed.coldTaken} 条冷记录先记到这里，需要你决定留还是忽略。`
          : '本次窗口里没有新的高信号待处理项。已核实的记录继续留在主库。'))
    } catch (error) {
      setFeedback(`梦境整理失败：${error?.message || String(error)}`)
    } finally {
      dreamLock.current = false
      setRunning(false)
    }
  }

  React.useEffect(() => {
    if (!autoEnabled) return undefined
    const timer = window.setTimeout(() => { runDream({ auto: true }) }, 800)
    return () => window.clearTimeout(timer)
  }, [project, autoEnabled])

  const applyAccept = async (proposal, op) => {
    setFeedback('')
    try {
      if (op.type === 'save_asset') {
        const { loadPromptKit } = await import('./promptkit-loader.js')
        const { ensureResearchProviders } = await import('../dsh/prompt-studio-glue.js')
        const provider = ensureResearchProviders(await loadPromptKit()).researchAssetProvider
        const saved = await provider.save({ ...op.asset, project: project || '' })
        if (saved?.id) {
          for (const evidenceId of op.evidenceIds || []) {
            await linkAssetToEvidence({ assetId: saved.id, evidenceId, project })
          }
        }
        await markProposal(proposal, 'accepted')
        return
      }
      if (op.type === 'register_claim') {
        await requestResearchClaims(project || 'default', { ...op.claim, project: project || 'default' })
        await markProposal(proposal, 'accepted')
        return
      }
      if (op.type === 'link_evidence') {
        for (const pair of op.pairs || []) await linkAssetToEvidence({ ...pair, project })
        await markProposal(proposal, 'accepted')
      }
    } catch (error) {
      setFeedback(error?.message || '这条提案还没写进主库，可稍后再试。')
    }
  }

  const handlePrimaryAction = proposal => {
    setFeedback('')
    if (proposal.action?.type === 'insert_prompt' && proposal.promptDraft) {
      if (supportsSafeInsert(inputActions)) {
        try {
          const ok = inputActions.insertText(proposal.promptDraft, inputActions.captureInsertion()) === true
          if (ok) {
            markProposal(proposal, 'accepted')
            return
          }
        } catch (error) {
          setFeedback(error?.message || '草稿暂不可写入，请切回会话后重试。')
          return
        }
      }
      if (proposal.action.workflowId && onNavigate) {
        onNavigate('catalog', { workflowId: proposal.action.workflowId })
      }
      return
    }
    if (proposal.action?.type === 'navigate' && onNavigate) {
      onNavigate(proposal.action.target, proposal.action.options || {})
    }
  }

  const restoreProposalTargets = async (targets, proposal, wasAccepted) => {
    try {
      if (wasAccepted) await writeMemory({ action: 'revoke_proposal', proposalId: proposal.id })
      for (const target of targets) updateDreamProposalStatus({ ...target, status: 'pending', project })
      setFeedback(wasAccepted
        ? '已恢复待审并撤回记忆卡。此前写入的灵感、论断或关联可在对应库中管理。'
        : '已恢复该提案到待处理收件箱。')
    } catch (error) { setFeedback(`恢复待审失败：${error.message}`) }
  }
  const restoreHandledProposal = proposal => {
    const signature = proposal?.signature || ''
    const matches = reports.flatMap(report => (report.proposals || [])
      .filter(item => item.status !== 'pending' && (signature ? item.signature === signature : item.id === proposal?.id))
      .map(item => ({ reportId: report.id, proposalId: item.id })))
    const targets = matches.length ? matches : (proposal?.reportId ? [{ reportId: proposal.reportId, proposalId: proposal.id }] : [])
    if (!targets.length) return
    return restoreProposalTargets(targets, proposal, proposal.status === 'accepted')
  }
  const memoryUrl = `${DREAM_MEMORY_PATH}?project=${encodeURIComponent(project || 'default')}`
  const loadMemory = async () => {
    const response = await fetch(memoryUrl, { signal: AbortSignal.timeout(3000) })
    const payload = await response.json()
    if (!response.ok || !payload?.ok) throw new Error('读取梦境记忆失败。')
    if (mounted.current) setMemory(payload)
    return payload
  }
  React.useEffect(() => { loadMemory().catch(() => {}) }, [memoryUrl])

  const writeMemory = async body => {
    if (memoryBusy.current) throw new Error('记忆正在更新，请稍后重试。')
    memoryBusy.current = true
    try {
      const response = await fetch(memoryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '记忆更新失败。')
      if (mounted.current) setMemory(payload.memory)
    } finally { memoryBusy.current = false }
  }

  const markProposal = async (proposal, status) => {
    const signature = proposal?.signature || ''
    const targets = reports.flatMap(report => (report.proposals || [])
      .filter(item => item.status === 'pending' && (signature ? item.signature === signature : item.id === proposal?.id))
      .map(item => ({ reportId: report.id, proposalId: item.id })))
    if (!targets.length) return
    try {
      if (status === 'accepted') {
        const card = memoryCardFromProposal(proposal, { project: project || 'default' })
        if (card) await writeMemory({ action: 'record_card', card })
      }
      for (const target of targets) updateDreamProposalStatus({ ...target, status, project })
      setFeedback(status === 'accepted' ? '已采纳提案。' : '已忽略该提案。')
      pushToast({
        message: status === 'accepted' ? `已采纳「${proposal.title}」。` : `已忽略「${proposal.title}」。`,
        actionLabel: status === 'accepted' ? '恢复待审并撤回记忆' : '撤销忽略',
        onAction: () => restoreProposalTargets(targets, proposal, status === 'accepted'),
      })
    } catch (error) { setFeedback(`记忆卡写入失败：${error.message}。提案仍待审，可重试标记采纳。`) }
  }

  const reviewMemory = async (item, decision) => {
    try {
      if (decision === 'confirm') {
        const store = evidenceVaultStore()
        const knowledge = knowledgeStore()
        const [evidence, currentClaims, nodes, edges, assets] = await Promise.all([
          store.list({ project }), store.listResearchClaims(), knowledge.listNodes(), knowledge.listClaims(),
          researchAssetProvider?.list().catch(listStoredDreamAssets) ?? listStoredDreamAssets(),
        ])
        const records = {
          evidenceIds: evidence,
          claimIds: scopeDreamRecords(currentClaims, project),
          nodeIds: scopeDreamRecords(nodes, project), knowledgeClaimIds: scopeDreamRecords(edges, project),
          assetIds: scopeDreamRecords(assets, project),
        }
        if (!dreamMemoryRefsExist(item.covers, records)) throw new Error('请核对来源：有记录已删除或不属于当前课题。')
      }
      await writeMemory({ action: 'review_draft', id: item.id, decision })
      setFeedback(decision === 'confirm' ? '已确认记忆。' : '已忽略记忆草稿。')
    } catch (error) { setFeedback(error.message) }
  }

  const foldTheme = async () => {
    const theme = themeFromCards(looseMemoryCards(memory))
    if (!theme) return
    try {
      await writeMemory({ action: 'record_theme', theme })
      setFeedback('已将记忆卡合成主题摘要。')
    } catch (error) { setFeedback(error.message) }
  }

  return h(Card, {
    as: 'section',
    'aria-label': '科研梦境',
    style: { display: 'grid', gap: 12, marginTop: 12 },
  }, [
    h('div', {
      key: 'head',
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
    }, [
      h('div', { key: 'title-group', style: { display: 'grid', gap: 4, minWidth: 0 } }, [
        h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
          h('strong', { key: 't', style: { fontSize: 15 } }, '科研梦境'),
          h(Badge, { key: 'b', color: C.teal }, '重点提炼 · Top 5'),
          pendingProposals.length ? h(Badge, { key: 'pending', color: C.amber }, `待审 ${pendingProposals.length}`) : null,
        ]),
        h('small', { key: 'hint', style: { color: C.muted, lineHeight: 1.5 } },
          `${currentModeMeta.hint}。仅给出提案，不改写已有记录。`),
      ]),
      h('div', { key: 'controls', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
        h(Segmented, {
          key: 'mode',
          value: mode,
          options: DREAM_MODES.map(item => ({ value: item.value, label: item.label })),
          onChange: changeMode,
          ariaLabel: '梦境模式',
        }),
        h(Button, {
          key: 'run',
          variant: 'primary',
          size: 'sm',
          disabled: running,
          onClick: () => runDream({ force: true }),
        }, running ? '正在整理…' : '开始一次梦境'),
        h(Button, {
          key: 'batch',
          variant: batchOpen ? 'soft' : 'ghost',
          size: 'sm',
          'aria-expanded': batchOpen,
          onClick: () => { setBatchOpen(open => !open); setPrefsOpen(false) },
        }, batchBusy ? '初判中…' : '批量初判 ▾'),
        h(Button, {
          key: 'prefs',
          variant: prefsOpen ? 'soft' : 'ghost',
          size: 'sm',
          'aria-expanded': prefsOpen,
          onClick: () => { setPrefsOpen(open => !open); setBatchOpen(false) },
        }, '偏好 ▾'),
      ]),
    ]),
    batchOpen ? h('div', {
      key: 'batch-panel',
      className: 'rk-reveal',
      style: { display: 'grid', gap: 8, padding: '10px 12px', borderRadius: 9, background: C.surfaceAlt, border: `1px solid ${C.line}` },
    }, [
      h('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
        h('strong', { key: 't', style: { fontSize: 13, color: C.ink } }, '证据批量初判'),
        h('span', { key: 'scope', style: { fontSize: 12, color: C.muted } }, `${project ? `课题「${project}」` : '全部课题'} · 待评 ${batchPlan.eligible.length} / 共 ${batchEntries.length} 条`),
      ]),
      h('div', { key: 'actions', style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } }, [
        h(Button, {
          key: 'run', size: 'sm', variant: 'primary',
          disabled: batchBusy || !batchEntries.length || !sessionId,
          title: !sessionId ? '当前无活跃会话，请先打开或切回一个会话后再运行' : undefined,
          onClick: () => runBatchAssessment(),
        }, batchBusy ? (batchProgress || '判断中…') : `用 Agent 判断完整范围（${batchEntries.length}）`),
        batchBusy ? h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => batchAbort.current?.abort() }, '取消') : null,
        batchRetryIds.length && !batchBusy ? h(Button, {
          key: 'retry', size: 'sm', variant: 'soft',
          onClick: () => runBatchAssessment(batchRetryIds),
        }, `继续未完成（${batchRetryIds.length}）`) : null,
        h('label', { key: 'include', style: { display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12, color: C.ink, cursor: 'pointer' } }, [
          h('input', {
            key: 'check', type: 'checkbox', checked: includeHuman, disabled: batchBusy,
            onChange: event => setIncludeHuman(event.target.checked),
          }),
          '包含人工处理过的',
        ]),
      ]),
      batchBusy && batchStats ? h('div', { key: 'progress', role: 'status', style: { display: 'grid', gap: 6, padding: '8px 10px', background: C.canvas, borderRadius: 8, fontSize: 12, color: C.muted } }, [
        h('div', { key: 'line', style: { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } }, [
          h('strong', { key: 'phase', style: { color: C.ink } }, batchStats.phase),
          h('span', { key: 'count' }, `已完成 ${batchStats.completed} / ${batchStats.total} · 跳过 ${batchStats.skipped} · 失败 ${batchStats.failed}`),
        ]),
        h('div', { key: 'bar', style: { height: 6, borderRadius: 99, background: C.line, overflow: 'hidden' } },
          h('div', { style: { width: '100%', height: '100%', background: C.teal, transformOrigin: 'left center', transform: `scaleX(${Math.min(1, (batchStats.completed + batchStats.skipped + batchStats.failed) / Math.max(1, batchStats.total))})`, transition: 'transform var(--rk-dur-base) var(--rk-ease-out)' } })),
        batchStats.last ? h('span', { key: 'last' }, `最近：${batchStats.last}`) : null,
      ]) : null,
      h('small', { key: 'note', style: { color: C.muted, lineHeight: 1.5 } }, '逐条写入元数据初判（与人工评估分开保存，不改变核验状态）；选中单条也可在证据库内局部初判。'),
    ]) : null,
    prefsOpen ? h('label', {
      key: 'auto-opt',
      className: 'rk-reveal',
      style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, cursor: 'pointer', width: 'fit-content', padding: '8px 10px', borderRadius: 8, background: C.surfaceAlt, border: `1px solid ${C.line}` },
    }, [
      h('input', {
        key: 'auto',
        type: 'checkbox',
        checked: autoEnabled,
        onChange: event => {
          const enabled = setDreamAutoEnabled(event.target.checked)
          setAutoEnabled(enabled)
        },
      }),
      '有新材料时自动整理（距上次至少 6 小时，无新材料不调用模型）',
    ]) : null,
    running ? h(Spinner, { key: 'spin', text: '正在扫描当前课题的证据、论断与知识节点并压缩高信号提案……' }) : null,
    feedback ? h(Notice, { key: 'feedback', tone: 'info' }, feedback) : null,
    ...(memory.pending || []).map(item => h('div', { key: item.id, className: 'rk-compose-actions' }, [
      h('span', { key: 'text' }, `待审记忆：${item.gist}`),
      h('small', { key: 'refs' }, Object.values(item.covers || {}).flat().join('、')),
      h(Button, { key: 'confirm', size: 'sm', onClick: () => reviewMemory(item, 'confirm') }, '确认记忆'),
      h(Button, { key: 'dismiss', size: 'sm', variant: 'quiet', onClick: () => reviewMemory(item, 'dismiss') }, '忽略草稿'),
    ])),
    latest ? h('div', { key: 'report', style: { display: 'grid', gap: 10 } }, [
      h('div', {
        key: 'digest',
        style: {
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '8px 12px', borderRadius: 8, background: C.surfaceAlt, border: `1px solid ${C.line}`, fontSize: 12,
        },
      }, [
        h('span', { key: 'text', style: { color: C.ink, fontWeight: 600 } }, latest.digest),
        h('div', { key: 'meta', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
          h(Badge, { key: 'mode', color: C.teal }, MODE_LABELS[latest.mode] || latest.mode),
          h(Badge, { key: 'engine', color: latest.engine === 'local-rules' ? C.muted : C.teal },
            latest.engine === 'merged'
              ? `宿主模型 + 本地规则${latest.model ? ` · ${latest.model}` : ''}`
              : latest.engine === 'host-llm' && latest.model ? `宿主模型 · ${latest.model}` : '本地规则引擎'),
          latest.createdAt ? h('span', { key: 'time', style: { color: C.muted } }, formatDreamTime(latest.createdAt)) : null,
        ]),
      ]),
      wake.pendingCount || wake.stoppedAt ? h('div', {
        key: 'wake',
        style: { display: 'grid', gap: 4, fontSize: 12, color: C.ink, lineHeight: 1.5 },
      }, [
        wake.stoppedAt ? h('span', { key: 'stop' }, `上次停在：${wake.stoppedAt}`) : null,
        h('span', { key: 'counts' }, `醒来待看 ${wake.pendingCount} 条 · 冲突或重复 ${wake.conflictCount} · 梦境线索 ${wake.clueCount}`),
        wake.top.length ? h('span', { key: 'top' }, `先看：${wake.top.map(item => item.title).join('；')}`) : null,
      ]) : null,
      (memory.themes?.length || memory.cards?.length) ? h('div', {
        key: 'memory',
        style: { display: 'grid', gap: 6, fontSize: 12, color: C.ink, lineHeight: 1.5 },
      }, [
        h('strong', { key: 'label' }, `长期记忆 · 主题 ${memory.themes?.length || 0} · 待归档笔记 ${looseMemoryCards(memory).length}`),
        ...(memory.themes || []).slice(0, 2).map(theme => h('span', { key: theme.id }, `主题：${theme.gist}`)),
        ...looseMemoryCards(memory).slice(0, 3).map(card => h('span', { key: card.id }, `记忆卡 · ${card.judgment}：${card.gist}`)),
        looseMemoryCards(memory).length >= 3 ? h(Button, {
          key: 'fold', size: 'sm', variant: 'quiet', onClick: foldTheme,
        }, '把这些记忆卡收成主题摘要') : null,
      ]) : null,
      pendingProposals.length
        ? h('div', { key: 'list', role: 'list', 'aria-label': '待处理梦境提案', style: { display: 'grid', gap: 8 } },
          pendingProposals.map(proposal => h('article', {
            key: proposal.id,
            role: 'listitem',
            style: {
              display: 'grid', gap: 6, padding: 12, borderRadius: 10,
              border: `1px solid ${proposal.unverifiedInference ? C.amberLine : C.line}`,
              background: C.surface,
            },
          }, [
            h('div', { key: 'top', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
              h(Badge, { key: 'cat', color: proposal.unverifiedInference ? C.amber : C.teal },
                proposal.unverifiedInference ? '梦境推论 · 待核验' : '巩固整理'),
              h(Badge, { key: 'kind', color: C.muted }, KIND_LABELS[proposal.kind] || proposal.kind),
              h('strong', { key: 'title', style: { fontSize: 13, color: C.ink } }, proposal.title),
            ]),
            h('p', { key: 'summary', style: { margin: 0, fontSize: 13, color: C.ink, lineHeight: 1.55 } }, proposal.summary),
            proposal.refLabels?.length ? h('div', { key: 'refs', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              proposal.refLabels.map((label, idx) => h('span', {
                key: `${proposal.id}-ref-${idx}`,
                style: { fontSize: 11, color: C.muted, padding: '2px 7px', borderRadius: 6, background: C.surfaceAlt, border: `1px solid ${C.line}` },
              }, label))) : null,
            h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 } }, [
              proposal.action ? h(Button, {
                key: 'primary',
                size: 'sm',
                variant: 'soft',
                onClick: () => handlePrimaryAction(proposal),
              }, proposal.action.label) : null,
              ...planDreamAccept(proposal).map(op => h(Button, {
                key: op.type,
                size: 'sm',
                variant: 'soft',
                onClick: () => applyAccept(proposal, op),
              }, op.label)),
              h(Button, {
                key: 'accept',
                size: 'sm',
                variant: 'ghost',
                onClick: () => markProposal(proposal, 'accepted'),
              }, '标记已采纳'),
              h(Button, {
                key: 'dismiss',
                size: 'sm',
                variant: 'quiet',
                onClick: () => markProposal(proposal, 'dismissed'),
              }, '忽略（不再提示）'),
            ]),
          ])))
        : (handledProposals.length ? h('p', { key: 'empty', style: { margin: 0, fontSize: 12, color: C.muted } }, '收件箱里的提案都已处理。再跑一次梦境时，未处理项仍会留在这里。') : null),
      handledProposals.length || reports.length > 1 ? h('details', { key: 'history' }, [
        h('summary', { key: 'sum', style: { cursor: 'pointer', fontSize: 12, color: C.muted } },
          `查看已处理提案（${handledProposals.length}）与历史梦境（${reports.length}）`),
        h('div', { key: 'body', style: { display: 'grid', gap: 6, marginTop: 8, fontSize: 12, color: C.muted } }, [
          ...handledProposals.map(item => h('div', { key: item.id, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } }, [
            h('span', { key: 'label' }, `[${item.status === 'accepted' ? '已采纳' : '已忽略'}] ${item.title}`),
            h(Button, { key: 'restore', size: 'sm', variant: 'quiet', onClick: () => restoreHandledProposal(item) }, '恢复待审'),
          ])),
          ...reports.slice(1, 5).map(rep => h('div', { key: rep.id },
            `${formatDreamTime(rep.createdAt)} · ${MODE_LABELS[rep.mode] || rep.mode} · ${rep.digest}`)),
        ]),
      ]) : null,
    ]) : h('p', { key: 'placeholder', style: { margin: 0, fontSize: 13, color: C.muted } },
      '积累了多篇文献、证据或论断后，点「开始一次梦境」即可压缩出最值得立即看的 Top 5 整理与联想提案。'),
  ])
}
