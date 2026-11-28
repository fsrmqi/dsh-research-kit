import React from 'react'
import { createPortal } from 'react-dom'
import { extractKnowledge, KNOWLEDGE_KIND_LABELS } from './lib/knowledge-extract.js'
import { extractAnswerEvidence, researchCitationHref } from './lib/answer-evidence.js'
import { currentResearchContext } from './research-context-store.js'
import { requestResearchClaims, projectClaimProjection } from './lib/claim-review-client.js'
import { ClaimEvidenceRelations } from './research-claim-review.js'
import { C } from './theme.js'
import { inheritResearchAutoSession, readResearchAutoSession, subscribeResearchAutoSessions, RESEARCH_STEPS_HEADING } from './composer-overlay.js'
import { readSessionEvents } from './lib/session-events.js'
import { Button, useDismissable } from './ui.js'
import { loadPromptKit } from './promptkit-loader.js'
import { ensureResearchProviders } from '../dsh/prompt-studio-glue.js'
import { publishEvidenceVault } from './lib/evidence-vault-sync.js'
import { depositAssistantMessage, readLatestResearchAnswer } from './knowledge-deposition.js'

export function reviewableAssistantMessage(sessions, sessionId, messageId, chatNodes) {
  const projected = chatNodes?.values?.().find(node => node?.kind === 'turn-tail' && String(node?.data?.closing?.finalNode?.messageId) === String(messageId))
  const closing = projected?.data?.closing
  if (closing) {
    const text = closing.blocks?.filter(block => block?.kind === 'text' && typeof block.text === 'string').map(block => block.text).join('') || ''
    if (text.trim()) return {
      text, seq: Number(closing.finalNode.seq), turn: Number(closing.turn) || null,
      at: Number(closing.finalNode.time) || 0, interrupted: closing.status === 'interrupted', extraction: extractKnowledge(text),
    }
  }
  const entries = readSessionEvents(sessions, sessionId, Infinity)
  const event = entries.findLast(item => item?.type === 'assistant/message' && String(item?.data?.message?.id) === String(messageId))
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return null
  const text = content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n')
  if (!text.trim()) return null
  const extraction = extractKnowledge(text)
  return { text, seq: Number(event.seq), turn: Number(event.data?.turn) || null, at: Number(event.time) || 0, interrupted: Boolean(event.data?.interrupted), extraction }
}

function depositPopoverPosition(anchor, viewport, width = 360) {
  if (!anchor || !viewport) return null
  const left = Math.max(12, Math.min(anchor.left, viewport.width - Math.min(width, viewport.width - 24) - 12))
  return anchor.bottom > viewport.height * 0.6
    ? { position: 'fixed', left, bottom: viewport.height - anchor.top + 8 }
    : { position: 'fixed', left, top: anchor.bottom + 8 }
}

function answerClaimText(text) {
  return String(text || '').normalize('NFKC').replace(/[\s\p{P}]+/gu, '').toLowerCase()
}

async function readAnswerClaimCandidates(text, citations, project, signal) {
  const answer = answerClaimText(text)
  const refs = new Set(citations.map(citation => String(citation.identifier || citation.url || '').toLowerCase()))
  const scope = project || 'default'
  const matched = []
  let offset = 0
  let evidenceById = new Map()
  do {
    const query = new URLSearchParams({ project: scope, offset: String(offset) })
    const response = await fetch(`/dsh-research-kit/claim-review?${query}`, { signal })
    const result = await response.json()
    if (!response.ok || !result.ok || !Array.isArray(result.claims)) throw new Error('无法读取课题的论断。')
    if (offset === 0) evidenceById = new Map((result.evidence || []).map(entry => [entry.id, entry]))
    for (const claim of result.claims) {
      const statement = answerClaimText(claim.statement)
      const citation = String(claim.source_ref?.citation || '').toLowerCase()
      if (!claim.id || (claim.project || 'default') !== scope || statement.length < 8
          || !answer.includes(statement) || (citation && !refs.has(citation))) continue
      matched.push(projectClaimProjection(claim, scope))
    }
    if (result.next_offset == null) break
    if (!Number.isInteger(result.next_offset) || result.next_offset <= offset) throw new Error('论断分页响应无效。')
    offset = result.next_offset
  } while (true)
  return { matched, evidenceById }
}

export function researchAnswerCandidateSummary(sessions, sessionId, messageId, autoSession) {
  if (!autoSession || !sessionId || !messageId) return null
  const entries = readSessionEvents(sessions, sessionId)
  const answer = entries.findLast(event => event.type === 'assistant/message'
    && String(event.data?.message?.id) === String(messageId))
  if (!answer || !Number.isFinite(Number(answer.seq)) || Number(answer.seq) <= autoSession.afterSeq || answer.data?.interrupted) return null
  const text = answer.data.message.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') || ''
  if (!text.trim()) return null
  const prompt = readSessionEvents(sessions, sessionId, 256).findLast(event => {
    const source = (event.data?.message ?? event.data)?.source
    return event.type === 'user/message' && (!source || source.kind === 'user') && Number(event.seq) < Number(answer.seq)
  })
  const adopted = (prompt?.data?.message ?? prompt?.data)?.content?.some(block => block.type === 'text' && block.text?.includes(RESEARCH_STEPS_HEADING))
  const extracted = extractAnswerEvidence(text)
  const sources = extracted.citations.filter(item => ['doi', 'pmid', 'pmcid', 'arxiv'].includes(item.identifierKind)).length
  const findings = extracted.nodes.filter(node => node.kind === 'finding').length
  if (!adopted && !(sources && (findings || /论文|文献|研究|实验|study|studies|paper|research/i.test(text)))) return null
  return findings || sources ? { findings, sources } : null
}

const localAssetProvider = {
  list: async () => ensureResearchProviders(await loadPromptKit()).researchAssetProvider.list(),
  save: async item => ensureResearchProviders(await loadPromptKit()).researchAssetProvider.save(item),
}

export function ResearchMessageDepositAction({ messageId, sessionId, sessions, assetProvider, useChat, triggerLabel, triggerContent, triggerStyle, triggerClassName, triggerDataInstant, onSaved }) {
  const chatNodes = typeof useChat === 'function' ? useChat(snapshot => snapshot.nodes) : null
  const anchorRef = React.useRef(null)
  const autoSession = React.useSyncExternalStore(subscribeResearchAutoSessions, () => readResearchAutoSession(sessionId), () => null)
  React.useEffect(() => inheritResearchAutoSession(sessions, sessionId), [sessions, sessionId, messageId])
  const autoCandidate = React.useMemo(() => researchAnswerCandidateSummary(sessions, sessionId, messageId, autoSession),
    [sessions, sessionId, messageId, autoSession, chatNodes])
  const [savedFromAnswer, setSavedFromAnswer] = React.useState(false)
  React.useEffect(() => setSavedFromAnswer(false), [sessionId, messageId])
  const [position, setPosition] = React.useState(null)
  const [preview, setPreview] = React.useState(null)
  const [claimChoices, setClaimChoices] = React.useState(null)
  const [confirmedClaims, setConfirmedClaims] = React.useState([])
  const [claimNotice, setClaimNotice] = React.useState('')
  const associationKey = preview && `dsh-research-kit.answer-claims.v1.${JSON.stringify([preview.sessionId, messageId || preview.seq, preview.project])}`
  const [draftOptions, setDraftOptions] = React.useState(null)
  const [pickedDrafts, setPickedDrafts] = React.useState([])
  const saveLock = React.useRef(false)
  const readAnswer = () => messageId
    ? reviewableAssistantMessage(sessions, sessionId, messageId, chatNodes)
    : readLatestResearchAnswer(sessionId)
  React.useEffect(() => {
    if (!preview) return undefined
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 10000)
    try {
      const ids = JSON.parse(window.localStorage.getItem(associationKey) || '[]')
      if (Array.isArray(ids)) setConfirmedClaims(ids)
    } catch { /* 已保存关联无法读取时仍可查看引用。 */ }
    readAnswerClaimCandidates(preview.text, preview.extraction.citations, preview.project, controller.signal)
      .then(result => { if (!controller.signal.aborted) setClaimChoices(result) })
      .catch(() => { if (!controller.signal.aborted || controller.signal.reason?.name === 'AbortError') setClaimNotice('暂时无法读取已有论断。') })
      .finally(() => window.clearTimeout(timer))
    return () => { window.clearTimeout(timer); controller.abort(new Error('回答面板已关闭')) }
  }, [preview, associationKey])
  const [selectedNodes, setSelectedNodes] = React.useState([])
  const [selectedCitations, setSelectedCitations] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  const panelRef = React.useRef(null)
  useDismissable(Boolean(preview), () => setPreview(null), panelRef, { disabled: busy })
  const place = () => {
    if (typeof window === 'undefined') return
    setPosition(depositPopoverPosition(anchorRef.current?.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }))
  }
  React.useEffect(() => {
    if (!preview && !notice) return undefined
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [preview, notice])
  React.useEffect(() => {
    if (!notice || preview) return undefined
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice, preview])
  React.useEffect(() => {
    if (!preview) return undefined
    const controller = new AbortController()
    if (!preview.extraction.citations.length) {
      setDraftOptions([])
      return undefined
    }
    requestResearchClaims(preview.project || 'default', { action: 'extract', text: preview.text.slice(0, 12000) }, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]))
      .then(response => { if (!controller.signal.aborted) setDraftOptions(response.drafts || []) })
      .catch(() => { if (!controller.signal.aborted) setDraftOptions(false) })
    return () => controller.abort()
  }, [preview])
  const open = () => {
    if (saveLock.current) return
    if (preview) { setPreview(null); return }
    place()
    const found = readAnswer()
    if (!found) { setNotice('当前会话窗口中找不到这条回答。'); return }
    setClaimChoices(null)
    setClaimNotice('')
    setConfirmedClaims([])
    const project = currentResearchContext().project
    const extraction = extractAnswerEvidence(found.text, project)
    setDraftOptions(null)
    setPickedDrafts([])
    setPreview({ ...found, extraction, project, sessionId: found.sessionId || sessionId })
    setSelectedNodes([])
    setSelectedCitations(extraction.citations.map((_, index) => index))
    setNotice('')
  }
  const toggleClaimAssociation = id => {
    const latest = readAnswer()
    if (!latest || (latest.sessionId || sessionId) !== preview.sessionId || latest.seq !== preview.seq || latest.text !== preview.text || currentResearchContext().project !== preview.project) {
      setClaimNotice('回答或课题已变化，请重新打开。')
      return
    }
    const ids = confirmedClaims.includes(id) ? confirmedClaims.filter(item => item !== id) : [...confirmedClaims, id]
    try {
      window.localStorage.setItem(associationKey, JSON.stringify(ids))
      setConfirmedClaims(ids)
      setClaimNotice('')
    } catch { setClaimNotice('当前客户端无法保存回答关联。') }
  }
  const toggle = (values, setValues, key) => setValues(values.includes(key) ? values.filter(item => item !== key) : [...values, key])
  const confirm = async () => {
    if (!preview || saveLock.current) return
    if (!selectedNodes.length && !selectedCitations.length && !pickedDrafts.length) { setNotice('请至少选择一项。'); return }
    const latest = readAnswer()
    if (!latest || (latest.sessionId || sessionId) !== preview.sessionId || latest.seq !== preview.seq || latest.text !== preview.text || currentResearchContext().project !== preview.project) {
      setNotice('回答或课题已变化，请重新打开预览。')
      setPreview(null)
      return
    }
    saveLock.current = true
    setBusy(true)
    try {
      const summary = selectedNodes.length || selectedCitations.length ? await depositAssistantMessage({
        text: preview.text, sessionId: String(preview.sessionId || ''), seq: preview.seq, turn: preview.turn, at: preview.at,
        selection: { nodeKeys: selectedNodes, citationIndexes: selectedCitations }, traceAnswerSources: true,
        activeProject: preview.project, assetProvider: assetProvider?.() || localAssetProvider,
      }) : { extracted: false, addedNodes: 0, savedEvidence: 0, savedAssets: 0 }
      let savedClaims = 0
      if (pickedDrafts.length) {
        try {
          const result = await requestResearchClaims(preview.project || 'default', {
            action: 'save_drafts', text: preview.text.slice(0, 12000), selected_indices: pickedDrafts,
          })
          savedClaims = result.saved?.length || 0
          publishEvidenceVault()
          onSaved?.()
        } catch (error) {
          setSelectedNodes([])
          setSelectedCitations([])
          setNotice(`所选来源和灵感已处理，论断登记失败：${error.message}。可重试论断。`)
          return
        }
      }
      if (summary.extracted || savedClaims) setSavedFromAnswer(true)
      setNotice(`已保存到资料库：知识 ${summary.addedNodes}、证据 ${summary.savedEvidence}、灵感 ${summary.savedAssets}、论断 ${savedClaims}。新增记录待核验。`)
      setPreview(null)
    } catch (error) { setNotice(`沉淀失败：${error?.message || error}`) }
    finally { saveLock.current = false; setBusy(false) }
  }
  const citations = preview?.extraction.citations || []
  const nodes = preview?.extraction.nodes || []
  const evidenceRows = preview?.extraction.rows || []
  const inlineCitations = new Set(evidenceRows.flatMap(row => row.references.map(ref => ref.index)))
  const otherCitations = citations.filter((_, index) => !inlineCitations.has(index))
  const candidateLabel = autoCandidate && !savedFromAnswer
    ? `可保存 ${[autoCandidate.findings && `${autoCandidate.findings} 条结论`, autoCandidate.sources && `${autoCandidate.sources} 条来源`].filter(Boolean).join('、')}`
    : ''
  const matched = claimChoices?.matched || []
  const orderedClaims = [
    ...matched.filter(claim => confirmedClaims.includes(claim.id)),
    ...matched.filter(claim => !confirmedClaims.includes(claim.id)),
  ]
  const sectionStyle = { display: 'grid', gap: 6, paddingBlock: 8, borderTop: `1px solid ${C.line}` }
  const panel = preview ? React.createElement('div', {
    key: 'preview', ref: panelRef, role: 'group', 'aria-label': '研究回答沉淀预览', className: 'rk-pop',
    style: { ...position, zIndex: 2147483000, boxSizing: 'border-box', padding: '10px 12px', width: 'min(360px, calc(100vw - 24px))', maxHeight: 'min(300px, calc(100vh - 72px))',
      overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: 10, color: C.ink, background: C.surface, boxShadow: C.shadowLg, font: `12px/1.45 ${C.font}` },
  }, [
    React.createElement('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingBottom: 8 } }, [
      React.createElement('strong', { key: 'title', style: { fontSize: 14 } }, '回答依据'),
      React.createElement(Button, { key: 'close', size: 'sm', variant: 'ghost', 'aria-label': '取消', disabled: busy, onClick: () => setPreview(null) }, '关闭'),
    ]),
    preview.interrupted ? React.createElement('p', { key: 'interrupted', style: { color: C.amber } }, '这条回答曾被中断，内容可能不完整。') : null,
    evidenceRows.length ? React.createElement('section', { key: 'evidence-rows', 'aria-label': '逐条核对结论', style: sectionStyle }, [
      React.createElement('strong', { key: 'title' }, '逐条核对结论'),
      ...evidenceRows.map(row => React.createElement('div', {
        key: row.nodeKey, style: { display: 'grid', gap: 4, paddingBlock: 4, overflowWrap: 'anywhere' },
      }, [
        row.statement ? React.createElement('span', { key: 'finding' }, row.statement) : null,
        ...row.references.map(ref => {
          const citation = citations[ref.index]
          const href = researchCitationHref(citation)
          return React.createElement('div', { key: `${ref.index}:${ref.paper}:${ref.locator}` }, [
            React.createElement(href ? 'a' : 'span', {
              key: 'paper', ...(href ? { href, target: '_blank', rel: 'noopener noreferrer', title: citation.identifier || href } : {}),
              style: { color: href ? C.teal : C.muted },
            }, ref.paper),
            React.createElement('span', { key: 'locator', style: { color: C.muted } }, ` · ${ref.locator}`),
          ])
        }),
        ...row.unlinked.map(ref => React.createElement('span', { key: `${ref.paper}:${ref.locator}`, style: { color: C.muted } },
          `${ref.paper} · ${ref.locator}（标识符缺失或无法识别）`)),
        ...row.gaps.map(gap => React.createElement('span', { key: gap, style: { color: C.amber } }, `证据缺口 · ${gap}`)),
        !row.references.length && !row.unlinked.length && !row.gaps.length
          ? React.createElement('span', { key: 'missing', style: { color: C.muted } }, '回答未提供可定位的来源。') : null,
      ])),
      React.createElement('small', { key: 'state', style: { color: C.muted } }, '出处由回答给出，支持关系待核验。'),
    ]) : null,
    otherCitations.length ? React.createElement('section', { key: 'citations', 'aria-label': '回答引用', style: sectionStyle }, [
      React.createElement('strong', { key: 'title' }, inlineCitations.size ? '其他回答引用' : '回答引用'),
      ...otherCitations.map((citation, index) => {
        const label = citation.identifier || citation.url || citation.title || '来源待核验'
        const href = researchCitationHref(citation)
        return React.createElement(href ? 'a' : 'span', {
          key: index, ...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {}),
          style: { overflowWrap: 'anywhere', color: href ? C.teal : C.muted },
        }, label)
      }),
      React.createElement('small', { key: 'state', style: { color: C.muted } }, '引用来自回答，原文与支持关系待核验。'),
    ]) : null,
    orderedClaims.length ? React.createElement('section', { key: 'claims', 'aria-label': '相关论断', style: sectionStyle }, [
      React.createElement('strong', { key: 'title' }, '相关论断'),
      ...orderedClaims.map(claim => React.createElement('div', {
        key: claim.id, style: { display: 'grid', gap: 5 },
      }, [
        React.createElement('span', { key: 'statement', style: { overflowWrap: 'anywhere' } }, claim.statement),
        React.createElement(Button, {
          key: 'link', size: 'sm', variant: 'ghost', onClick: () => toggleClaimAssociation(claim.id), style: { justifySelf: 'start' },
        }, confirmedClaims.includes(claim.id) ? '取消关联' : '关联到此回答'),
        confirmedClaims.includes(claim.id) ? React.createElement(ClaimEvidenceRelations, {
          key: 'sources', claim, evidenceById: claimChoices.evidenceById,
        }) : null,
      ])),
    ]) : null,
    claimNotice ? React.createElement('p', { key: 'claim-notice', role: 'status' }, claimNotice) : null,
    !citations.length && !orderedClaims.length && !evidenceRows.length ? React.createElement('p', { key: 'empty', style: { color: C.muted } }, '这条回答暂无可展示的引用或关联论断。') : null,
    citations.length || nodes.length || draftOptions?.length ? React.createElement('section', { key: 'deposit', style: sectionStyle }, [
      React.createElement('strong', { key: 'summary' }, `保存到课题 · ${preview.project || '默认课题'}`),
      React.createElement('div', { key: 'choices', style: { display: 'grid', gap: 7, marginTop: 8 } }, [
        ...citations.map((citation, index) => React.createElement('label', { key: `citation-${index}`, style: { overflowWrap: 'anywhere' } }, [
          React.createElement('input', { key: 'check', type: 'checkbox', checked: selectedCitations.includes(index), onChange: () => toggle(selectedCitations, setSelectedCitations, index) }),
          `引用：${citation.identifier || citation.url || citation.title || '来源待核验'}`,
        ])),
        nodes.length ? React.createElement('small', { key: 'candidate-help', style: { color: C.muted } }, '可选的自动抽取候选，请检查后再保存。') : null,
        ...nodes.map(node => React.createElement('label', { key: node.key, style: { overflowWrap: 'anywhere' } }, [
          React.createElement('input', { key: 'check', type: 'checkbox', checked: selectedNodes.includes(node.key), onChange: () => toggle(selectedNodes, setSelectedNodes, node.key) }),
          `${KNOWLEDGE_KIND_LABELS[node.kind] || '知识'}：${node.label}`,
        ])),
        Array.isArray(draftOptions) ? draftOptions.map((item, index) => React.createElement('label', { key: `draft-${index}` }, [
          React.createElement('input', { key: 'check', type: 'checkbox', checked: pickedDrafts.includes(index), onChange: () => toggle(pickedDrafts, setPickedDrafts, index) }),
          `待核验论断：${item.statement}`,
        ])) : null,
        draftOptions === false ? React.createElement('small', { key: 'draft-error' }, '暂时无法提取论断，可以保存其他所选内容。') : null,
        draftOptions === null ? React.createElement('small', { key: 'draft-loading', role: 'status' }, '正在提取可登记的论断……') : null,
        React.createElement(Button, { key: 'confirm', size: 'sm', variant: 'primary', style: { justifySelf: 'start' }, disabled: busy || (!selectedNodes.length && !selectedCitations.length && !pickedDrafts.length), onClick: confirm }, busy ? '正在保存…' : '保存所选'),
        notice ? React.createElement('p', { key: 'deposit-notice', role: 'status' }, notice) : null,
      ]),
    ]) : null,
  ]) : notice ? React.createElement('span', { key: 'notice', role: 'status', className: 'rk-reveal', style: { ...position, zIndex: 2147483000, display: 'block', boxSizing: 'border-box', padding: '6px 9px', width: 'min(320px, calc(100vw - 24px))', color: C.ink, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, boxShadow: C.shadowLg, fontSize: 12 } }, notice) : null
  return React.createElement(React.Fragment, null, [
    React.createElement('button', {
      key: 'open', ref: anchorRef, type: 'button', onClick: open,
      'aria-label': triggerLabel || candidateLabel || '保存到资料库',
      'aria-expanded': Boolean(preview),
      'data-instant': triggerDataInstant ? 'true' : undefined,
      ...(triggerStyle ? { className: triggerClassName || 'rk-fab-btn', style: triggerStyle } : { className: 'rk-btn' }),
    }, triggerContent || triggerLabel || candidateLabel || '保存到资料库'),
    panel && typeof document !== 'undefined' ? createPortal(panel, document.body) : null,
  ])
}
