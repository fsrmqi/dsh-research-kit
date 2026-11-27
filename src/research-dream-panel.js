import React from 'react'
import { h, C } from './theme.js'
import { Badge, Button, Card, Notice, Segmented, Spinner } from './ui.js'
import {
  DREAM_MODES,
  buildDreamSnapshot,
  mergeDreamProposals,
  normalizeDreamMode,
  runLocalDream,
  scopeDreamRecords,
  formatDreamCompressionSummary,
} from './lib/research-dream.js'
import {
  getHandledDreamSignatures,
  getPreferredDreamMode,
  latestDreamReport,
  listDreamReports,
  pendingDreamInbox,
  saveDreamReport,
  setPreferredDreamMode,
  subscribeDreamStore,
  updateDreamProposalStatus,
} from './dream-store.js'
import { evidenceVaultStore } from './lib/evidence-vault-sync.js'
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
  const [running, setRunning] = React.useState(false)
  const [feedback, setFeedback] = React.useState('')
  const [revision, setRevision] = React.useState(0)
  React.useEffect(() => subscribeDreamStore(() => setRevision(v => v + 1)), [])

  const reports = React.useMemo(() => listDreamReports(project), [project, revision])
  const latest = reports[0] || latestDreamReport(project)
  const pendingProposals = React.useMemo(() => pendingDreamInbox(reports), [reports])
  const handledProposals = reports.flatMap(report => (report.proposals || [])
    .filter(item => item.status !== 'pending')
    .map(item => ({ ...item, reportId: report.id })))
  const currentModeMeta = DREAM_MODES.find(item => item.value === mode) || DREAM_MODES[0]

  const changeMode = next => {
    const saved = setPreferredDreamMode(next)
    setMode(saved)
  }

  const runDream = async () => {
    if (running) return
    setRunning(true)
    setFeedback('')
    try {
      const store = evidenceVaultStore()
      const kStore = knowledgeStore()
      const [evidence, allNodes, allKnowledgeClaims] = await Promise.all([
        store.list({ project }),
        kStore.listNodes(),
        kStore.listClaims(),
      ])
      const scopedNodes = scopeDreamRecords(allNodes, project)
      const scopedKnowledgeClaims = scopeDreamRecords(allKnowledgeClaims, project)
      const runs = listResearchRuns({ project })
      const snapshot = buildDreamSnapshot({
        project,
        evidence,
        claims,
        knowledgeNodes: scopedNodes,
        knowledgeClaims: scopedKnowledgeClaims,
        runs,
      })
      const handledSignatures = getHandledDreamSignatures(project)
      const localResult = runLocalDream({ snapshot, mode, handledSignatures })

      let finalReport = { ...localResult, project }
      let fallbackNotice = ''

      if (sessionId && useHostModel && (snapshot.counts.evidence + snapshot.counts.claims + snapshot.counts.knowledgeNodes > 0)) {
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
      setFeedback(fallbackNotice || (finalReport.proposals.length
        ? `梦境完成：已压缩为 ${finalReport.proposals.length} 条高信号提案。`
        : '本次扫描未发现新的高信号待处理项。'))
    } catch (error) {
      setFeedback(`梦境整理失败：${error?.message || String(error)}`)
    } finally {
      setRunning(false)
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
    setFeedback(status === 'accepted' ? '已标记采纳，后续梦境不再重复提示。' : '已忽略该提案，后续梦境不再重复提示。')
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
          onClick: runDream,
        }, running ? '正在整理梦境…' : '开始一次梦境'),
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
      '优先使用当前会话模型深度提炼（不可用时自动降级到本地规则引擎）',
    ]) : null,
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
