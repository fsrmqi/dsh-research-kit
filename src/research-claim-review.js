import React from 'react'
import { h, C } from './theme.js'
import { Button, Card, Field, Input, Textarea, Badge, EmptyState, Notice, Spinner } from './ui.js'
import { currentResearchContext, activeResearchRun, subscribeResearchContext } from './research-context-store.js'

const CLAIM_REVIEW_API = '/dsh-research-kit/claim-review'
const CLAIM_AGENT_REVIEW_API = '/dsh-research-kit/claim-agent-review'
const CLAIM_REVIEW_LABELS = {
  extracted: '摘取待核验', inferred: '推断待核验', ambiguous: '存疑', verified: '已人工确认', rejected: '已驳回',
}

async function claimReviewRequest(project, body, signal) {
  const response = await fetch(body ? CLAIM_REVIEW_API : `${CLAIM_REVIEW_API}?project=${encodeURIComponent(project)}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`)
  return result
}

export function ResearchClaimReview({ sessionId = '' }) {
  const [context, setContext] = React.useState(currentResearchContext)
  const project = context.project || 'default'
  const [claims, setClaims] = React.useState([])
  const [evidence, setEvidence] = React.useState([])
  const [limits, setLimits] = React.useState({})
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  const [statement, setStatement] = React.useState('')
  const [sourceText, setSourceText] = React.useState('')
  const [candidates, setCandidates] = React.useState([])
  const [pickedCandidates, setPickedCandidates] = React.useState([])
  const [reviewer, setReviewer] = React.useState('')
  const [editingId, setEditingId] = React.useState('')
  const [draft, setDraft] = React.useState({ state: 'ambiguous', reason: '', evidenceIds: [] })
  const requestVersion = React.useRef(0)

  React.useEffect(() => subscribeResearchContext(setContext), [])
  React.useEffect(() => { setCandidates([]); setPickedCandidates([]); setEditingId('') }, [project])
  const refresh = React.useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    try {
      const result = await claimReviewRequest(project)
      if (version !== requestVersion.current) return
      setClaims(result.claims)
      setEvidence(result.evidence)
      setLimits({ claims: result.claim_limit_reached, evidence: result.evidence_limit_reached })
    } catch (error) {
      if (version === requestVersion.current) setNotice(`读取 Claim 失败：${error.message}`)
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [project])
  React.useEffect(() => { refresh(); return () => { requestVersion.current++ } }, [refresh])

  const create = async () => {
    if (!statement.trim() || busy) return
    setBusy(true)
    try {
      const run = activeResearchRun()
      await claimReviewRequest(project, {
        project, run_id: run?.project === context.project ? run.id : '',
        statement: statement.trim(), state: 'extracted',
      })
      setStatement('')
      setNotice('Claim 草稿已登记，等待逐条审阅。')
      await refresh()
    } catch (error) { setNotice(`登记失败：${error.message}`) }
    finally { setBusy(false) }
  }

  const extract = async () => {
    if (!sourceText.trim() || busy) return
    setBusy(true)
    try {
      const result = await claimReviewRequest(project, { action: 'extract', project, text: sourceText })
      setCandidates(result.drafts)
      setPickedCandidates([])
      setNotice(result.drafts.length ? `找到 ${result.drafts.length} 条带引用的 Claim 候选；请勾选要登记的条目。` : '未找到带 DOI、PMID 或 arXiv 引用的可定位 Claim。')
    } catch (error) { setNotice(`候选提取失败：${error.message}`) }
    finally { setBusy(false) }
  }

  const saveCandidates = async () => {
    if (!pickedCandidates.length || busy) return
    setBusy(true)
    try {
      const run = activeResearchRun()
      const result = await claimReviewRequest(project, { action: 'save_drafts', project, text: sourceText,
        selected_indices: pickedCandidates, run_id: run?.project === context.project ? run.id : '' })
      setNotice(`已登记 ${result.saved.length} 条 Claim 草稿；${result.duplicates.length} 条重复候选已跳过。`)
      setCandidates([])
      setPickedCandidates([])
      setSourceText('')
      await refresh()
    } catch (error) { setNotice(`候选登记失败：${error.message}`) }
    finally { setBusy(false) }
  }

  const agentReview = async claimIds => {
    if (busy || !claimIds.length) return
    if (!sessionId) return setNotice('当前会话没有 session ID，无法调用 Agent 审阅。')
    setBusy(true)
    try {
      const response = await fetch(`${CLAIM_AGENT_REVIEW_API}?session_id=${encodeURIComponent(sessionId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, claim_ids: claimIds }),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`)
      setNotice(`Agent 已审阅 ${result.reviewed} 条 Claim；建议已单独记录，等待研究者核对。`)
      await refresh()
    } catch (error) { setNotice(`Agent 审阅失败：${error.message}`) }
    finally { setBusy(false) }
  }

  const exportClaims = async mode => {
    if (busy) return
    setBusy(true)
    try {
      const response = await fetch(CLAIM_REVIEW_API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'export', project, mode }) })
      const result = await response.json()
      if (result.ready === false) {
        setNotice(`发布检查未通过：${result.blockers.length} 条 Claim 需要处理。${result.blockers.slice(0, 2).map(item => ` ${item.claim_id}：${item.reason}`).join('')}`)
        return
      }
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`)
      const blob = new Blob([JSON.stringify(result.payload, null, 2) + '\n'], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `research-evidence-${mode}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(mode === 'publication' ? '发布检查通过，已导出带人工判断的研究证据。' : '已导出带状态标注的 Claim 草稿。')
    } catch (error) { setNotice(`导出失败：${error.message}`) }
    finally { setBusy(false) }
  }

  const openReview = claim => {
    setEditingId(claim.id)
    setDraft({
      state: ['verified', 'rejected', 'ambiguous'].includes(claim.state) ? claim.state : 'ambiguous',
      reason: claim.assessment_reason || '',
      evidenceIds: Array.isArray(claim.evidence_ids) ? claim.evidence_ids : [],
    })
    setNotice('')
  }

  const saveReview = async claim => {
    if (busy) return
    if (!reviewer.trim() || !draft.reason.trim()) return setNotice('请填写评估人和评估理由。')
    if (draft.state === 'verified' && !draft.evidenceIds.length) return setNotice('确认 Claim 前至少关联一条已保存证据。')
    setBusy(true)
    try {
      await claimReviewRequest(project, {
        project, claim_id: claim.id, statement: claim.statement, state: draft.state,
        evidence_ids: draft.evidenceIds, assessed_by: reviewer.trim(), assessment_reason: draft.reason.trim(),
      })
      setEditingId('')
      setNotice(`Claim 已更新为「${CLAIM_REVIEW_LABELS[draft.state]}」。`)
      await refresh()
    } catch (error) { setNotice(`审阅失败：${error.message}`) }
    finally { setBusy(false) }
  }

  const evidenceById = new Map(evidence.map(item => [item.id, item]))
  const toggleEvidence = id => setDraft(current => ({ ...current,
    evidenceIds: current.evidenceIds.includes(id)
      ? current.evidenceIds.filter(item => item !== id) : current.evidenceIds.length < 30 ? [...current.evidenceIds, id] : current.evidenceIds,
  }))
  const pendingForAgent = claims.filter(claim => !['verified', 'rejected'].includes(claim.state) && !claim.agent_review).slice(0, 6)

  return h('section', { 'aria-label': 'Claim 审阅', style: { display: 'grid', gap: 12, marginTop: 16 } }, [
    h(Card, { key: 'intro', style: { display: 'grid', gap: 10 } }, [
      h('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10, flexWrap: 'wrap' } }, [
        h('div', { key: 'text' }, [
          h('h2', { key: 'title', style: { margin: 0, fontSize: 17 } }, '科研 Claim 审阅'),
          h('p', { key: 'hint', style: { margin: '5px 0 0', color: C.muted, fontSize: 12, lineHeight: 1.6 } },
            `当前课题：${project}。确认结论须由研究者填写理由，并关联本课题已保存的证据。`),
        ]),
        h(Button, { key: 'refresh', size: 'sm', variant: 'ghost', disabled: loading || busy, onClick: refresh }, '刷新台账'),
      ]),
      h(Field, { key: 'statement', label: '新建 Claim 草稿', hint: '只写一句可检验的短声明；创建后状态为“摘取待核验”。' },
        h(Textarea, { value: statement, onChange: setStatement, rows: 2, maxLength: 800, ariaLabel: '新建 Claim 内容', placeholder: '例如：在指定样本与条件下，干预 A 改善结果 B。' })),
      h(Button, { key: 'create', size: 'sm', variant: 'primary', disabled: busy || !statement.trim(), onClick: create, style: { justifySelf: 'start' } }, '登记草稿'),
    ]),
    h(Card, { key: 'extract', style: { display: 'grid', gap: 10 } }, [
      h('h3', { key: 'title', style: { margin: 0, fontSize: 14 } }, '从研究段落提取候选'),
      h('p', { key: 'hint', style: { margin: 0, color: C.muted, fontSize: 12, lineHeight: 1.5 } }, '粘贴带 DOI、PMID 或 arXiv 引用的段落；先预览并勾选，再登记为待核验 Claim。原文不会整篇保存。'),
      h(Textarea, { key: 'input', value: sourceText, onChange: value => { setSourceText(value); setCandidates([]); setPickedCandidates([]) }, rows: 4,
        maxLength: 12000, ariaLabel: '待提取的研究段落', placeholder: '例如：在某研究条件下，干预 A 改善结局 B [1](https://doi.org/10.1000/example)。' }),
      h(Button, { key: 'extract-button', size: 'sm', disabled: busy || !sourceText.trim(), onClick: extract, style: { justifySelf: 'start' } }, '提取候选'),
      candidates.length ? h('div', { key: 'candidates', role: 'group', 'aria-label': 'Claim 候选列表', style: { display: 'grid', gap: 8 } }, [
        ...candidates.map((candidate, index) => h('label', { key: index, style: { display: 'flex', gap: 8, padding: 9, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, lineHeight: 1.5 } }, [
          h('input', { key: 'checkbox', type: 'checkbox', checked: pickedCandidates.includes(index),
            onChange: () => setPickedCandidates(current => current.includes(index) ? current.filter(item => item !== index) : [...current, index]),
            'aria-label': `登记候选 ${index + 1}` }),
          h('span', { key: 'text' }, [
            h('strong', { key: 'statement', style: { display: 'block', overflowWrap: 'anywhere' } }, candidate.statement),
            h('span', { key: 'source', style: { color: C.muted } }, `${candidate.source_ref.citation_type.toUpperCase()}：${candidate.source_ref.citation} · ${candidate.source_ref.locator} · ${candidate.matched_evidence ? '已匹配证据库' : '证据库未匹配'}`),
          ]),
        ])),
        h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: busy || !pickedCandidates.length,
          onClick: saveCandidates, style: { justifySelf: 'start' } }, `登记所选 ${pickedCandidates.length} 条`),
      ]) : null,
    ]),
    h(Card, { key: 'review-actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
      h(Button, { key: 'agent', size: 'sm', disabled: busy || !pendingForAgent.length,
        onClick: () => agentReview(pendingForAgent.map(item => item.id)) }, `Agent 审阅待核验 ${pendingForAgent.length} 条`),
      h(Button, { key: 'draft-export', size: 'sm', variant: 'ghost', disabled: busy || !claims.length || limits.claims,
        onClick: () => exportClaims('draft') }, '导出带状态草稿'),
      h(Button, { key: 'publication-export', size: 'sm', variant: 'soft', disabled: busy || !claims.length || limits.claims,
        onClick: () => exportClaims('publication') }, '发布检查并导出'),
    ]),
    notice ? h(Notice, { key: 'notice', tone: /失败|请填写|至少/.test(notice) ? 'error' : 'info' }, notice) : null,
    limits.claims || limits.evidence ? h(Notice, { key: 'limit', tone: 'warn' }, '当前只展示最近 200 条 Claim 或证据；更早记录请使用 MCP 工具查询。') : null,
    loading ? h(Spinner, { key: 'loading', text: '正在读取 Claim 台账……' }) : null,
    !loading && !claims.length ? h(EmptyState, { key: 'empty', text: '当前课题还没有 Claim。', hint: '可先登记一条草稿，再逐条审阅。' }) : null,
    ...claims.map(claim => h(Card, { key: claim.id, style: { display: 'grid', gap: 10 } }, [
      h('div', { key: 'summary', style: { display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' } }, [
        h('div', { key: 'claim', style: { minWidth: 0, flex: '1 1 280px' } }, [
          h('div', { key: 'labels', style: { display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' } }, [
            h(Badge, { key: 'state', color: claim.state === 'verified' ? C.statusVerified : claim.state === 'rejected' ? C.statusRefuted : C.statusToVerify }, CLAIM_REVIEW_LABELS[claim.state] || claim.state),
            claim.run_id ? h('span', { key: 'run', style: { color: C.muted, fontSize: 11 } }, `运行 ${claim.run_id}`) : null,
          ]),
          h('p', { key: 'statement', style: { margin: '7px 0 0', color: C.ink, fontSize: 14, lineHeight: 1.6, overflowWrap: 'anywhere' } }, claim.statement),
          claim.assessment_reason ? h('p', { key: 'reason', style: { margin: '6px 0 0', color: C.muted, fontSize: 12, lineHeight: 1.5 } },
            `上次审阅：${claim.assessed_by || '未署名'} · ${claim.assessment_reason}`) : null,
          claim.evidence_ids?.length ? h('p', { key: 'evidence', style: { margin: '5px 0 0', color: C.muted, fontSize: 12 } },
            `关联证据：${claim.evidence_ids.map(id => evidenceById.get(id)?.title || id).join('、')}`) : null,
          claim.source_ref ? h('p', { key: 'source-ref', style: { margin: '5px 0 0', color: C.muted, fontSize: 12 } },
            `来源位置：${claim.source_ref.citation_type.toUpperCase()} ${claim.source_ref.citation} · ${claim.source_ref.locator}`) : null,
          claim.agent_review ? h(Notice, { key: 'agent-review', tone: 'warn', style: { marginTop: 8 } },
            `Agent ${['verified', 'rejected'].includes(claim.state) ? '历史' : ''}建议「${CLAIM_REVIEW_LABELS[claim.agent_review.suggested_state]}」（${claim.agent_review.confidence}）：${claim.agent_review.reason}。${['verified', 'rejected'].includes(claim.state) ? '当前结论以人工审阅为准。' : '请人工核对后再决定。'}`) : null,
        ]),
        h('div', { key: 'buttons', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
          !['verified', 'rejected'].includes(claim.state) ? h(Button, { key: 'agent', size: 'sm', variant: 'ghost', disabled: busy,
            onClick: () => agentReview([claim.id]) }, 'Agent 审阅') : null,
          h(Button, { key: 'edit', size: 'sm', variant: editingId === claim.id ? 'soft' : 'ghost', disabled: busy,
            onClick: () => editingId === claim.id ? setEditingId('') : openReview(claim) }, editingId === claim.id ? '收起审阅' : '逐条审阅'),
        ]),
      ]),
      editingId === claim.id ? h('div', { key: 'editor', style: { display: 'grid', gap: 11, borderTop: `1px solid ${C.line}`, paddingTop: 12 } }, [
        h('div', { key: 'actions', role: 'group', 'aria-label': 'Claim 审阅结论', style: { display: 'flex', gap: 7, flexWrap: 'wrap' } },
          [['verified', '确认'], ['ambiguous', '存疑'], ['rejected', '驳回']].map(([state, label]) => h(Button, {
            key: state, size: 'sm', variant: draft.state === state ? 'primary' : 'ghost',
            'aria-pressed': draft.state === state, onClick: () => setDraft(current => ({ ...current, state })),
          }, label))),
        h(Field, { key: 'reviewer', label: '评估人', required: true },
          h(Input, { value: reviewer, onChange: setReviewer, maxLength: 120, ariaLabel: 'Claim 评估人', placeholder: '姓名或研究角色' })),
        h(Field, { key: 'reason', label: '评估理由', required: true },
          h(Textarea, { value: draft.reason, onChange: reason => setDraft(current => ({ ...current, reason })),
            maxLength: 500, rows: 3, ariaLabel: 'Claim 评估理由', placeholder: '写明来源位置、研究条件和判断依据。' })),
        h('fieldset', { key: 'evidence-list', style: { border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, maxHeight: 220, overflow: 'auto' } }, [
          h('legend', { key: 'legend', style: { fontSize: 12, fontWeight: 700 } }, `关联已保存证据${draft.state === 'verified' ? '（确认时至少一条）' : '（可选）'}`),
          ...evidence.map(item => h('label', { key: item.id, style: { display: 'flex', gap: 8, alignItems: 'start', padding: '5px 0', fontSize: 12, overflowWrap: 'anywhere' } }, [
            h('input', { key: 'check', type: 'checkbox', checked: draft.evidenceIds.includes(item.id), onChange: () => toggleEvidence(item.id), 'aria-label': `关联证据：${item.title}` }),
            h('span', { key: 'text' }, `${item.title}${item.identifier ? ` · ${item.identifier}` : ''}`),
          ])),
          !evidence.length ? h('p', { key: 'none', style: { margin: 0, color: C.muted, fontSize: 12 } }, '当前课题尚无已保存证据；可在证据库先保存来源。') : null,
        ]),
        h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: busy, onClick: () => saveReview(claim), style: { justifySelf: 'start' } }, busy ? '正在保存……' : '保存审阅'),
      ]) : null,
    ])),
  ])
}
