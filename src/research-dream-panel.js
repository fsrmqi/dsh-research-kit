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
import { evidenceVaultStore, linkAssetToEvidence } from './lib/evidence-vault-sync.js'
import { requestResearchClaims } from './lib/claim-review-client.js'
import {
  DREAM_MEMORY_PATH, coverIndex, looseMemoryCards, memoryCardFromProposal, retireCoveredRecords, themeFromCards,
} from './lib/dream-memory.js'
import { researchAssetProvider } from '../dsh/prompt-studio-glue.js'
import { knowledgeStore } from './knowledge-store.js'
import { listResearchRuns } from './research-context-store.js'
import { supportsSafeInsert } from './lib/input-actions.js'

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
  const [useHostModel, setUseHostModel] = React.useState(true)
  const [autoEnabled, setAutoEnabled] = React.useState(getDreamAutoEnabled)
  const [memory, setMemory] = React.useState(() => ({ schemaVersion: 1, project, cards: [], themes: [] }))
  const [running, setRunning] = React.useState(false)
  const dreamLock = React.useRef(false)
  const [feedback, setFeedback] = React.useState('')
  const [revision, setRevision] = React.useState(0)
  React.useEffect(() => subscribeDreamStore(() => setRevision(v => v + 1)), [])

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
      try {
        const response = await fetch(`${DREAM_MEMORY_PATH}?project=${encodeURIComponent(project || 'default')}`, { signal: AbortSignal.timeout(3000) })
        const payload = await response.json()
        if (response.ok && payload?.ok) {
          activeMemory = { schemaVersion: 1, project: payload.project || project, cards: payload.cards || [], themes: payload.themes || [] }
          setMemory(activeMemory)
        }
      } catch { /* 记忆服务不可达时沿用本页已确认的卡 */ }
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
        force,
        auto,
      })
      if (decision.skip) {
        setFeedback(decision.reason === 'cooldown'
          ? '距上次自动梦境不足 6 小时，已跳过。可以手动再整理一次。'
          : '这一轮冷记录已经看过。它们还在库里，没有删除；有新材料，或再点「整理未决项」，才会继续往后整合。')
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

      if (sessionId && useHostModel && modelWorthCalling) {
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
        markProposal(proposal, 'accepted')
        setFeedback('已存为待核验灵感，并挂上提案里的证据。正文仍待你核对。')
        return
      }
      if (op.type === 'register_claim') {
        await requestResearchClaims(project || 'default', { ...op.claim, project: project || 'default' })
        markProposal(proposal, 'accepted')
        setFeedback('已登记为待核验 Claim，没有标成已证实。')
        return
      }
      if (op.type === 'link_evidence') {
        for (const pair of op.pairs || []) await linkAssetToEvidence({ ...pair, project })
        markProposal(proposal, 'accepted')
        setFeedback('已建立灵感与证据的互链，没有改写原文。')
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
            setFeedback('已将梦境研究草稿写入会话输入框，并标记为已采纳。')
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

  const markProposal = (proposal, status) => {
    const signature = proposal?.signature || ''
    const matches = reports.flatMap(report => (report.proposals || [])
      .filter(item => item.status === 'pending' && (signature ? item.signature === signature : item.id === proposal?.id))
      .map(item => ({ reportId: report.id, proposalId: item.id })))
    const targets = matches.length ? matches : (proposal?.reportId ? [{ reportId: proposal.reportId, proposalId: proposal.id }] : [])
    if (!targets.length) return
    for (const target of targets) updateDreamProposalStatus({ ...target, status, project })
    if (status === 'accepted') rememberProposal(proposal)
    setFeedback(status === 'accepted' ? '已标记采纳，并写入一张可展开的记忆卡。原文仍在库里。' : '已忽略该提案，后续梦境不再重复提示。')
  }

  const rememberProposal = async proposal => {
    const card = memoryCardFromProposal(proposal, { project: project || 'default' })
    if (!card) return
    try {
      const response = await fetch(`${DREAM_MEMORY_PATH}?project=${encodeURIComponent(project || 'default')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'record_card', project: project || 'default', card }),
        signal: AbortSignal.timeout(5000),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '记忆卡没有写入')
      setMemory(payload.memory)
    } catch (error) {
      setMemory(current => ({ ...current, cards: [card, ...(current.cards || [])] }))
      setFeedback(`提案已采纳。记忆卡先留在本页，文件同步未完成：${error?.message || error}`)
    }
  }

  const foldTheme = async () => {
    const theme = themeFromCards(looseMemoryCards(memory))
    if (!theme) return
    try {
      const response = await fetch(`${DREAM_MEMORY_PATH}?project=${encodeURIComponent(project || 'default')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'record_theme', project: project || 'default', theme }),
        signal: AbortSignal.timeout(5000),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '主题摘要没有写入')
      setMemory(payload.memory)
      setFeedback('已把记忆卡收成主题摘要。以后默认读这张摘要，展开仍能回到原来的编号。')
    } catch (error) {
      setFeedback(error?.message || '主题摘要还没写入。')
    }
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
          h(Badge, { key: 'b', color: C.teal }, '高信号压缩 · Top 5'),
          pendingProposals.length ? h(Badge, { key: 'pending', color: C.amber }, `待审 ${pendingProposals.length}`) : null,
        ]),
        h('small', { key: 'hint', style: { color: C.muted, lineHeight: 1.5 } },
          `${currentModeMeta.hint}。绝不静默改写已有证据或论断。`),
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
          onClick: () => runDream(),
        }, running ? '正在整理梦境…' : '开始一次梦境'),
        h(Button, {
          key: 'force',
          variant: 'quiet',
          size: 'sm',
          disabled: running,
          onClick: () => runDream({ force: true }),
        }, '整理未决项'),
      ]),
    ]),
    sessionId ? h('label', {
      key: 'llm-opt',
      style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, cursor: 'pointer', width: 'fit-content' },
    }, [
      h('input', {
        key: 'chk',
        type: 'checkbox',
        checked: useHostModel,
        onChange: event => setUseHostModel(event.target.checked),
      }),
      '优先使用当前会话模型深度提炼（只在有新材料时调用；不可用时自动降级到本地规则引擎）',
    ]) : null,
    h('label', {
      key: 'auto-opt',
      style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, cursor: 'pointer', width: 'fit-content' },
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
      '有新材料时自动做梦（默认关闭，距上次至少 6 小时，无新材料不调用模型）',
    ]),
    running ? h(Spinner, { key: 'spin', text: '正在扫描当前课题的证据、论断与知识节点并压缩高信号提案……' }) : null,
    feedback ? h(Notice, { key: 'feedback', tone: 'info' }, feedback) : null,
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
        h('strong', { key: 'label' }, `长期记忆 · 主题 ${memory.themes?.length || 0} · 未收拢的卡 ${looseMemoryCards(memory).length}`),
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
        : h('p', { key: 'empty', style: { margin: 0, fontSize: 13, color: C.muted } },
          handledProposals.length
            ? '收件箱里的提案都已处理。再跑一次梦境时，未处理项仍会留在这里。'
            : '当前课题积累较少或暂无新的高信号提案；继续收集证据与论断后可再次触发梦境。'),
      handledProposals.length || reports.length > 1 ? h('details', { key: 'history' }, [
        h('summary', { key: 'sum', style: { cursor: 'pointer', fontSize: 12, color: C.muted } },
          `查看已处理提案（${handledProposals.length}）与历史梦境（${reports.length}）`),
        h('div', { key: 'body', style: { display: 'grid', gap: 6, marginTop: 8, fontSize: 12, color: C.muted } }, [
          ...handledProposals.map(item => h('div', { key: item.id },
            `[${item.status === 'accepted' ? '已采纳' : '已忽略'}] ${item.title}`)),
          ...reports.slice(1, 5).map(rep => h('div', { key: rep.id },
            `${formatDreamTime(rep.createdAt)} · ${MODE_LABELS[rep.mode] || rep.mode} · ${rep.digest}`)),
        ]),
      ]) : null,
    ]) : h('p', { key: 'placeholder', style: { margin: 0, fontSize: 13, color: C.muted } },
      '积累了多篇文献、证据或论断后，点「开始一次梦境」即可压缩出最值得立即看的 Top 5 整理与联想提案。'),
  ])
}
