import { readLatestResearchAnswer } from './knowledge-deposition.js'
import React from 'react'
import { h, C } from './theme.js'
import { Button, Card, Field, Input, Textarea, Badge, EmptyState, Notice, Spinner } from './ui.js'
import { currentResearchContext, activeResearchRun, subscribeResearchContext } from './research-context-store.js'
import { evidenceVaultStore, publishEvidenceVault, syncEvidenceVaultWithFiles } from './lib/evidence-vault-sync.js'
import { requestResearchClaims, synchronizeResearchClaims } from './lib/claim-review-client.js'
import { downloadBlob, downloadText, downloadJsonFile } from './lib/download.js'
import { pushToast } from './lib/toast.js'

const CLAIM_REVIEW_API = '/dsh-research-kit/claim-review'
const CLAIM_AGENT_REVIEW_API = '/dsh-research-kit/claim-agent-review'
const CLAIM_REVIEW_LABELS = {
  extracted: '摘取待核验', inferred: '推断待核验', ambiguous: '存疑', verified: '已人工确认', rejected: '已驳回',
}

async function claimReviewRequest(project, body, signal) {
  const result = await requestResearchClaims(project, body, signal)
  if (body && !['extract', 'export'].includes(body.action)) publishEvidenceVault()
  return result
}

const CLAIM_EVIDENCE_GROUPS = [
  ['supports', '支持', C.statusVerified], ['refutes', '反驳', C.statusRefuted],
  ['insufficient', '证据不足', C.amber], ['unassessed', '待评估', C.muted],
]

export function ClaimEvidenceRelations({ claim, evidenceById }) {
  const ids = claim.evidence_ids
  const [local, setLocal] = React.useState(null)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    if (!ids?.length) return
    let alive = true
    evidenceVaultStore().getMany(ids).then(rows => {
      if (alive) setLocal(new Map(rows.map(row => [row.id, row])))
    }).catch(() => { if (alive) setError('本地证据读取失败。') })
    return () => { alive = false }
  }, [ids])
  const links = new Map((claim.links || []).map(link => [link.evidenceId, link]))
  return h('section', {
    'aria-label': '当前论断的证据关系',
    className: 'rk-reveal',
    style: { display: 'grid', gap: 8, borderTop: `1px solid ${C.line}`, paddingTop: 10 },
  }, [
    h('strong', { key: 'title' }, '当前论断的证据关系'),
    error ? h('span', { key: 'error', role: 'status' }, error) : null,
    !ids?.length ? h('p', { key: 'empty' }, '尚无关联证据。可在逐条审阅中选择已保存的来源。') : null,
    ...CLAIM_EVIDENCE_GROUPS.map(([stance, label, color]) => {
      const group = ids?.filter(id => (links.get(id)?.stance || 'unassessed') === stance)
      if (!group?.length) return null
      return h('div', { key: stance, role: 'group', 'aria-label': label,
        style: { borderInlineStart: `2px solid ${color}`, paddingInlineStart: 10 } }, [
        h(Badge, { key: 'relation', color }, `↑ ${label} · ${group.length}`),
        h('ul', { key: 'sources' }, group.map(id => {
          const link = links.get(id)
          const row = local?.get(id)
          const cached = row?.project === claim.project ? row : null
          const source = cached || evidenceById.get(id)
          const rawUrl = String(source?.url || '').trim()
          const doi = (source?.identifierKind || source?.identifier_type) === 'doi' ? source.identifier : ''
          const url = /^https?:\/\//i.test(rawUrl) ? rawUrl
            : /^10\.\d+\//.test(doi || '') ? `https://doi.org/${encodeURI(doi)}` : ''
          return h('li', { key: id, style: { marginBlock: 6, overflowWrap: 'anywhere' } }, [
            url
              ? h('a', { key: 'source', href: url, target: '_blank', rel: 'noopener noreferrer' }, source.title)
              : h('span', { key: 'source' }, source?.title || (local ? `未找到来源（${id}）` : id)),
            h('small', { key: 'locator', style: { display: 'block', color: C.muted } },
              [link?.locator && `原文位置 ${link.locator}`, link?.assessedBy && `评估人 ${link.assessedBy}`,
                (cached?.sourceVerification || cached?.status) === 'unverified' && '来源待核验'].filter(Boolean).join(' · ')),
          ])
        })),
      ])
    }),
  ])
}

export function ResearchClaimReview({ sessionId = '', focusClaimId = '' }) {
  const [context, setContext] = React.useState(currentResearchContext)
  const project = context.project || 'default'
  const [claims, setClaims] = React.useState([])
  const [claimPage, setClaimPage] = React.useState(0)
  const [evidence, setEvidence] = React.useState([])
  const [limits, setLimits] = React.useState({})
  const [loading, setLoading] = React.useState(true)
  const [syncWarning, setSyncWarning] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [notice, setNoticeRaw] = React.useState('')
  const setNotice = React.useCallback((message, options = {}) => {
    const text = String(message || '')
    const needsCorrection = /失败|请填写|至少|未通过/.test(text)
    setNoticeRaw(needsCorrection ? text : '')
    if (text && !needsCorrection) pushToast({ ...options, message: text })
  }, [])
  const [addOpen, setAddOpen] = React.useState(false)
  const [exportMenuOpen, setExportMenuOpen] = React.useState(false)
  const [statement, setStatement] = React.useState('')
  const [sourceText, setSourceText] = React.useState('')
  const [candidates, setCandidates] = React.useState([])
  const [pickedCandidates, setPickedCandidates] = React.useState([])
  const [reviewer, setReviewerRaw] = React.useState(() => {
    try { return window.localStorage.getItem('dsh-research-kit.reviewer.v1') || '' } catch { return '' }
  })
  const [editingReviewer, setEditingReviewer] = React.useState(false)
  const setReviewer = React.useCallback(value => {
    setReviewerRaw(value)
    try { window.localStorage.setItem('dsh-research-kit.reviewer.v1', value) } catch { /* 忽略 */ }
  }, [])
  const [editingId, setEditingId] = React.useState('')
  const [relationId, setRelationId] = React.useState('')
  const [draft, setDraft] = React.useState({ state: 'ambiguous', reason: '', evidenceIds: [] })
  const requestVersion = React.useRef(0)

  React.useEffect(() => subscribeResearchContext(setContext), [])
  React.useEffect(() => { setCandidates([]); setPickedCandidates([]); setEditingId(''); setRelationId(''); setClaimPage(0) }, [project])
  const refresh = React.useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    try {
      let warning = ''
      await syncEvidenceVaultWithFiles(context.project || undefined)
        .catch(error => { warning = `文件同步失败：${error.message}` })
      const result = await synchronizeResearchClaims(evidenceVaultStore(), context.project || '')
      if (version !== requestVersion.current) return
      setSyncWarning(warning)
      setClaims(result.claims)
      setClaimPage(page => Math.min(page, Math.max(0, Math.ceil(result.claims.length / 50) - 1)))
      setEvidence(result.evidence)
      setLimits({ claims: result.claim_limit_reached, evidence: result.evidence_limit_reached })
    } catch (error) {
      if (version === requestVersion.current) setNotice(`读取论断失败：${error.message}`)
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
      setAddOpen(false)
      setNotice('论断草稿已登记，等待审阅。')
      await refresh()
    } catch (error) { setNotice(`登记失败：${error.message}`) }
    finally { setBusy(false) }
  }

  const extract = async (overrideText) => {
    const targetText = typeof overrideText === 'string' ? overrideText : sourceText
    if (!targetText.trim() || busy) return
    setBusy(true)
    try {
      const result = await claimReviewRequest(project, { action: 'extract', project, text: targetText })
      setCandidates(result.drafts)
      setPickedCandidates(result.drafts.map((_, index) => index))
      setAddOpen(true)
      setNotice(result.drafts.length ? `已提取 ${result.drafts.length} 条论断候选（已默认勾选）。` : '未找到带 DOI、PMID 或 arXiv 引用的可定位论断。')
    } catch (error) { setNotice(`候选提取失败：${error.message}`) }
    finally { setBusy(false) }
  }
  const extractFromLatestAnswer = () => {
    const found = readLatestResearchAnswer(sessionId)
    if (!found) return setNotice('当前会话没有可读取的助手回答；可展开「添加论断」手动粘贴段落。')
    const text = found.text.slice(0, 12000)
    setSourceText(text); setCandidates([]); setPickedCandidates([])
    setAddOpen(true)
    void extract(text)
  }

  const saveCandidates = async () => {
    if (!pickedCandidates.length || busy) return
    setBusy(true)
    try {
      const run = activeResearchRun()
      const result = await claimReviewRequest(project, { action: 'save_drafts', project, text: sourceText,
        selected_indices: pickedCandidates, run_id: run?.project === context.project ? run.id : '' })
      setNotice(`已登记 ${result.saved.length} 条论断草稿${result.duplicates.length ? `，跳过 ${result.duplicates.length} 条重复` : ''}。`)
      setCandidates([])
      setPickedCandidates([])
      setSourceText('')
      setAddOpen(false)
      await refresh()
    } catch (error) { setNotice(`候选登记失败：${error.message}`) }
    finally { setBusy(false) }
  }

  const agentReview = async claimIds => {
    if (busy || !claimIds.length) return
    if (!sessionId) return setNotice('当前无活跃会话，暂不可调用 Agent 审阅。')
    setBusy(true)
    try {
      const response = await fetch(`${CLAIM_AGENT_REVIEW_API}?session_id=${encodeURIComponent(sessionId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, claim_ids: claimIds }),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`)
      setNotice(`Agent 已审阅 ${result.reviewed} 条论断，建议已单独记录。`)
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
        setNotice(`发布检查未通过：${result.blockers.length} 条论断需要处理。${result.blockers.slice(0, 2).map(item => ` ${item.claim_id}：${item.reason}`).join('')}`)
        return
      }
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`)
      downloadJsonFile(JSON.stringify(result.payload, null, 2) + '\n', `research-evidence-${mode}.json`)
      setNotice(mode === 'publication' ? '发布检查通过，已导出研究证据。' : '已导出带状态标注的论断草稿。')
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
    setNoticeRaw('')
  }
  const appliedClaimFocus = React.useRef('')
  React.useEffect(() => {
    if (!focusClaimId || loading || appliedClaimFocus.current === focusClaimId) return
    const index = claims.findIndex(claim => claim.id === focusClaimId)
    if (index < 0) return
    appliedClaimFocus.current = focusClaimId
    setClaimPage(Math.floor(index / 50))
    openReview(claims[index])
  }, [focusClaimId, loading, claims])

  const saveReview = async claim => {
    if (busy) return
    if (!reviewer.trim() || !draft.reason.trim()) return setNotice('请填写评估人和评估理由。')
    if (draft.state === 'verified' && !draft.evidenceIds.length) return setNotice('确认论断前至少关联一条已保存证据。')
    const previous = {
      state: claim.state, reason: claim.assessment_reason || '', evidenceIds: claim.evidence_ids || [],
      links: claim.links || [], assessedBy: claim.assessed_by || '',
    }
    setBusy(true)
    try {
      const saved = await claimReviewRequest(project, {
        project, claim_id: claim.id, statement: claim.statement, state: draft.state, expected_revision: claim.revision,
        evidence_ids: draft.evidenceIds, assessed_by: reviewer.trim(), assessment_reason: draft.reason.trim(),
      })
      setEditingId('')
      setEditingReviewer(false)
      const nextRev = saved?.claim?.revision ?? ((claim.revision || 0) + 1)
      setNotice(`论断已更新为「${CLAIM_REVIEW_LABELS[draft.state]}」。`, {
        actionLabel: '撤销',
        onAction: async () => {
          try {
            await claimReviewRequest(project, {
              project, claim_id: claim.id, statement: claim.statement, state: previous.state,
              expected_revision: nextRev, evidence_ids: previous.evidenceIds, links: previous.links,
              assessed_by: previous.assessedBy, assessment_reason: previous.reason,
            })
            setNotice('已撤销上次审阅。')
            await refresh()
          } catch (error) { pushToast({ message: `撤销失败：${error.message}`, tone: 'warn' }) }
        },
      })
      await refresh()
    } catch (error) { setNotice(`审阅失败：${error.message}`) }
    finally { setBusy(false) }
  }

  const evidenceById = new Map(evidence.map(item => [item.id, item]))
  const toggleEvidence = id => setDraft(current => ({ ...current,
    evidenceIds: current.evidenceIds.includes(id)
      ? current.evidenceIds.filter(item => item !== id) : current.evidenceIds.length < 50 ? [...current.evidenceIds, id] : current.evidenceIds,
  }))
  const pendingForAgent = claims.filter(claim => !['verified', 'rejected'].includes(claim.state) && !claim.agent_review).slice(0, 6)

  return h('section', { 'aria-label': '论断审阅', style: { display: 'grid', gap: 12, marginTop: 16 } }, [
    h(Card, { key: 'toolbar', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
      h(Button, { key: 'add', size: 'sm', variant: addOpen ? 'soft' : 'primary', icon: 'plus', 'aria-expanded': addOpen, onClick: () => setAddOpen(open => !open) }, addOpen ? '收起添加' : '添加论断'),
      h(Button, { key: 'latest-answer', size: 'sm', variant: 'soft', disabled: busy, onClick: extractFromLatestAnswer }, '从最近回答提取'),
      pendingForAgent.length ? h(Button, { key: 'agent', size: 'sm', variant: 'ghost', disabled: busy || !sessionId, title: !sessionId ? '当前无活跃会话，暂不可调用 Agent' : undefined,
        onClick: () => agentReview(pendingForAgent.map(item => item.id)) }, `Agent 审阅待核验 ${pendingForAgent.length} 条`) : null,
      h('span', { key: 'spacer', style: { flex: '1 1 auto' } }),
      claims.length ? h(Button, { key: 'export-toggle', size: 'sm', variant: exportMenuOpen ? 'soft' : 'ghost', 'aria-expanded': exportMenuOpen, onClick: () => setExportMenuOpen(open => !open) }, '导出 ▾') : null,
      h(Button, { key: 'refresh', size: 'sm', variant: 'ghost', disabled: loading || busy, onClick: refresh }, '刷新'),
    ]),
    exportMenuOpen && claims.length ? h('div', { key: 'export-menu', className: 'rk-reveal', style: { display: 'flex', gap: 8, flexWrap: 'wrap', padding: '8px 12px', borderRadius: 9, background: C.surfaceAlt, border: `1px solid ${C.line}` } }, [
      h(Button, { key: 'publication-export', size: 'sm', variant: 'primary', disabled: busy || limits.claims, onClick: () => exportClaims('publication') }, '发布检查并导出'),
      h(Button, { key: 'draft-export', size: 'sm', variant: 'ghost', disabled: busy || limits.claims, onClick: () => exportClaims('draft') }, '导出带状态草稿'),
    ]) : null,
    addOpen ? h(Card, { key: 'add-drawer', className: 'rk-reveal', style: { display: 'grid', gap: 14, border: `1px solid ${C.tealLine}` } }, [
      h('div', { key: 'manual', style: { display: 'grid', gap: 8 } }, [
        h(Field, { key: 'statement', label: '登记单条论断', hint: '写一句可检验的短结论，默认以「摘取待核验」入库。' },
          h(Textarea, { value: statement, onChange: setStatement, rows: 2, maxLength: 800, ariaLabel: '新建论断内容', placeholder: '例如：在指定样本与条件下，干预 A 改善结果 B。' })),
        h(Button, { key: 'create', size: 'sm', variant: 'primary', disabled: busy || !statement.trim(), onClick: create, style: { justifySelf: 'start' } }, '登记草稿'),
      ]),
      h('div', { key: 'extract', style: { display: 'grid', gap: 8, paddingTop: 12, borderTop: `1px solid ${C.line}` } }, [
        h('strong', { key: 'title', style: { fontSize: 13 } }, '或从带引用的研究段落批量提取'),
        h(Textarea, { key: 'input', value: sourceText, onChange: value => { setSourceText(value); setCandidates([]); setPickedCandidates([]) }, rows: 3,
          maxLength: 12000, ariaLabel: '待提取的研究段落', placeholder: '粘贴含 DOI、PMID 或 arXiv 引用的段落……' }),
        h(Button, { key: 'extract-button', size: 'sm', variant: 'soft', disabled: busy || !sourceText.trim(), onClick: extract, style: { justifySelf: 'start' } }, '提取候选'),
        candidates.length ? h('div', { key: 'candidates', role: 'group', 'aria-label': '论断候选列表', style: { display: 'grid', gap: 8 } }, [
          ...candidates.map((candidate, index) => h('label', { key: index, style: { display: 'flex', gap: 8, padding: 9, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, lineHeight: 1.5, cursor: 'pointer' } }, [
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
    ]) : null,
    notice && /失败|请填写|至少|未通过/.test(notice) ? h(Notice, { key: 'notice', tone: 'error' }, notice) : null,
    limits.claims || limits.evidence ? h(Notice, { key: 'limit', tone: 'warn' }, '证据选择器显示最近 200 条；更早来源可从证据库建立论断后，在此审核。') : null,
    syncWarning ? h(Notice, { key: 'sync-warning', tone: 'warn' }, syncWarning) : null,
    loading ? h(Spinner, { key: 'loading', text: '正在读取论断台账……' }) : null,
    !loading && !claims.length ? h(EmptyState, {
      key: 'empty',
      text: '当前课题还没有论断。',
      hint: '可直接从最近一条助手回答中提取候选，或点上方「添加论断」手动登记。',
      action: h(Button, { size: 'sm', variant: 'primary', disabled: busy, onClick: extractFromLatestAnswer }, '从最近回答提取'),
    }) : null,
    claims.length > 50 ? h('div', { key: 'claim-pagination', style: { display: 'flex', gap: 8, alignItems: 'center' } }, [
      h(Button, { key: 'prev', size: 'sm', disabled: !claimPage || busy, onClick: () => setClaimPage(page => page - 1) }, '上一页论断'),
      h('span', { key: 'count' }, `第 ${claimPage + 1} 页 · 共 ${claims.length} 条`),
      h(Button, { key: 'next', size: 'sm', disabled: (claimPage + 1) * 50 >= claims.length || busy, onClick: () => setClaimPage(page => page + 1) }, '下一页论断'),
    ]) : null,
    ...claims.slice(claimPage * 50, (claimPage + 1) * 50).map(claim => h(Card, { key: claim.id, 'data-dream-focus': claim.id, style: { display: 'grid', gap: 10 } }, [
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
          h(Button, { key: 'relations', size: 'sm', variant: 'ghost', 'aria-expanded': relationId === claim.id,
            onClick: () => setRelationId(relationId === claim.id ? '' : claim.id) },
          relationId === claim.id ? '收起证据关系' : '查看证据关系'),
          h(Button, { key: 'edit', size: 'sm', variant: editingId === claim.id ? 'soft' : 'ghost', disabled: busy,
            onClick: () => editingId === claim.id ? setEditingId('') : openReview(claim) }, editingId === claim.id ? '收起审阅' : '逐条审阅'),
        ]),
      ]),
      relationId === claim.id ? h(ClaimEvidenceRelations, { key: 'relations', claim, evidenceById }) : null,
      editingId === claim.id ? h('div', { key: 'editor', className: 'rk-reveal', style: { display: 'grid', gap: 11, borderTop: `1px solid ${C.line}`, paddingTop: 12 } }, [
        h('div', { key: 'actions', role: 'group', 'aria-label': '论断审阅结论', style: { display: 'flex', gap: 7, flexWrap: 'wrap' } },
          [['verified', '确认'], ['ambiguous', '存疑'], ['rejected', '驳回']].map(([state, label]) => h(Button, {
            key: state, size: 'sm', variant: draft.state === state ? 'primary' : 'ghost',
            'aria-pressed': draft.state === state, onClick: () => setDraft(current => ({ ...current, state })),
          }, label))),
        reviewer.trim() && !editingReviewer
          ? h('div', { key: 'reviewer-compact', style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: C.muted } }, [
            h('span', { key: 'who' }, `评估人：${reviewer.trim()}`),
            h(Button, { key: 'change', size: 'sm', variant: 'quiet', onClick: () => setEditingReviewer(true) }, '修改'),
          ])
          : h(Field, { key: 'reviewer', label: '评估人', required: true },
            h(Input, { value: reviewer, onChange: setReviewer, maxLength: 120, ariaLabel: '论断评估人', placeholder: '姓名或研究角色（填一次会自动记住）' })),
        h(Field, { key: 'reason', label: '评估理由', required: true },
          h(Textarea, { value: draft.reason, onChange: reason => setDraft(current => ({ ...current, reason })),
            maxLength: 500, rows: 3, ariaLabel: '论断评估理由', placeholder: '写明来源位置、研究条件和判断依据。' })),
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
