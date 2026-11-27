import React from 'react'
import { readSessionEvents } from './lib/session-events.js'
import {
  catalog, catalogIndexMode, itemById, itemDetailReady, loadCatalogItemDetail,
  searchCatalog, searchCatalogRemote, composeWorkflow, recommendedWorkflowsForResources, loadBrowserCatalog, subscribeCatalog,
} from './catalog.js'
import { createCatalogStorage } from './catalog-storage.js'
import { createEvidenceStore } from './evidence-store.js'
import { createResearchSelectionStore } from './research-selection-store.js'
import { h, C, GlobalStyle } from './theme.js'
import { Icon } from './lib/icons.js'
import { POPOVER_GAP, POPOVER_MAX_HEIGHT, overlayMaxHeight, findScrollport } from './lib/overlay-anchor.js'
import {
  Button, IconButton, Chip, Badge, Field, Input, Textarea, Notice, Modal, Select, Spinner,
} from './ui.js'
import { RESEARCH_COMPOSER_EVENT, RESEARCH_ORGANIZE_EVENT, RESEARCH_RESOURCE_SELECTION_EVENT } from './composer-launcher.js'
import { canWriteDraft, supportsSafeInsert, writeDraftText } from './lib/input-actions.js'

const COMPOSER_TYPE_LABELS = { all: '全部', workflow: '工作流程', skill: '技能', database: '数据库' }
import { WORKBENCH_CATEGORY_COLORS, workbenchFallbackCategoryColor } from './catalog-category-filter.js'

function unique(ids) { return [...new Set(ids)] }

function SearchInput({ value, onChange, placeholder, ariaLabel }) {
  return h('div', { className: 'rk-picker-search' }, [
    h('span', {
      key: 'icon',
      'aria-hidden': 'true',
      style: { position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, display: 'flex' },
    }, h(Icon, { name: 'search', size: 14 })),
    h(Input, { key: 'input', value, onChange, placeholder, ariaLabel, style: { padding: '6px 8px 6px 30px', height: 32 } }),
  ])
}

function WorkflowLaunchDialog({ workflow, resourceIds, inputActions, catalogStorage, sessionId, originalDraft, originalRevision, onClose }) {
  const [values, setValues] = React.useState({})
  const [editedPrompt, setEditedPrompt] = React.useState(null)
  const [missing, setMissing] = React.useState([])
  const [notice, setNotice] = React.useState('')
  const [detailVersion, setDetailVersion] = React.useState(0)
  const [detailError, setDetailError] = React.useState('')
  const [retryNonce, setRetryNonce] = React.useState(0)
  const requestRef = React.useRef(0)
  React.useEffect(() => subscribeCatalog(() => setDetailVersion(value => value + 1)), [])
  const activeWorkflow = React.useMemo(() => itemById(workflow.id) || workflow, [workflow, detailVersion])
  const detailReady = itemDetailReady(activeWorkflow)
  React.useEffect(() => {
    if (detailReady) { setDetailError(''); return undefined }
    const requestId = ++requestRef.current
    setDetailError('')
    loadCatalogItemDetail(workflow.id)
      .catch(error => { if (requestRef.current === requestId) setDetailError(error?.message || String(error)) })
    return undefined
  }, [workflow.id, detailReady, retryNonce])
  const resourceItems = resourceIds.map(itemById).filter(Boolean)
  const suggestedSkills = (activeWorkflow.suggestedSkillIds || []).map(itemById).filter(Boolean)
  const skillIds = unique([...resourceItems.filter(item => item.type === 'skill').map(item => item.id), ...suggestedSkills.filter(item => item.type === 'skill').map(item => item.id)])
  const databaseIds = resourceItems.filter(item => item.type === 'database').map(item => item.id)
  // 与工作台 recordUse 同一口径：使用/复制即同时记「使用历史」与「本会话工作流轨迹」，
  // 保证图谱「本会话」范围不因入口不同而漏记。历史只记录工作流身份和时间，
  // 绝不从最终 Prompt 中提取用户参数或材料摘要；计划记录不在这里代写——
  // 阶段勾选界面只在工作台存在，弹层不静默标记用户看不到的计划状态。
  const evidence = React.useMemo(() => createEvidenceStore(sessionId), [sessionId])
  const recordUse = () => {
    catalogStorage?.recordHistory?.({ id: workflow.id, name: workflow.name })
    evidence.recordWorkflow({ id: workflow.id, name: workflow.name, resourceIds: [...resourceIds, ...skillIds] })
  }
  const assembled = detailReady ? composeWorkflow(activeWorkflow, values, { enforceRequired: false, extraSkillIds: skillIds, extraDatabaseIds: databaseIds }).prompt : ''
  const finalPrompt = editedPrompt ?? assembled
  const hasDraftAction = canWriteDraft(inputActions)
  const missingSet = new Set(missing)
  const update = (key, value) => setValues(current => ({ ...current, [key]: value }))
  const useWorkflow = () => {
    if (!detailReady) return setNotice('工作流详情仍在加载中，请稍候。')
    if (!hasDraftAction) return setNotice('当前 DSH 会话尚未提供输入框操作，无法使用该工作流程。')
    if (!String(finalPrompt).trim()) return setNotice('提示词为空，无法使用。')
    try {
      composeWorkflow(activeWorkflow, values, { extraSkillIds: skillIds, extraDatabaseIds: databaseIds })
      if (supportsSafeInsert(inputActions)) {
        const span = inputActions.captureInsertion()
        const text = originalDraft ? `\n\n${finalPrompt}\n\n` : finalPrompt
        if (!span || (Number.isInteger(originalRevision) && span.draftRev !== originalRevision)
            || !inputActions.insertText(text, { ...span, start: span.end })) {
          return setNotice('草稿已变化。请重新打开流程，或复制提示词后手动粘贴。')
        }
      } else {
        if (originalDraft) return setNotice('当前客户端只能替换整份草稿，请复制提示词后手动粘贴。')
        const written = writeDraftText(inputActions, finalPrompt)
        if (!written.ok) return setNotice('草稿暂时无法写入，请复制后手动粘贴。')
      }
      recordUse()
      onClose()
    } catch (error) { setMissing([]); setNotice(error.message) }
  }
  const copyPrompt = async () => {
    if (!detailReady || !String(finalPrompt).trim()) return setNotice('提示词为空，无需复制。')
    try {
      await navigator.clipboard.writeText(finalPrompt)
      recordUse()
      setNotice('已复制提示词到剪贴板；可粘贴到任意会话使用。')
    } catch (error) { setNotice(`复制失败：${error?.message || error}；可手动全选预览框文本复制。`) }
  }
  // 点按即校验：必填缺失时在弹窗内给出字段级错误，不依赖静默 notice。
  const validateThenUse = () => {
    if (!detailReady) return setNotice('工作流详情仍在加载中，请稍候。')
    const missingFields = (activeWorkflow.placeholders || [])
      .filter(field => field.required && !String(values[field.key] || '').trim())
      .map(field => field.label)
    if (missingFields.length) {
      setMissing(missingFields)
      return setNotice(`请填写必填项：${missingFields.join('、')}`)
    }
    setMissing([])
    setNotice('')
    useWorkflow()
  }
  const attachedResources = [...skillIds, ...databaseIds].map(itemById).filter(Boolean)
  const color = WORKBENCH_CATEGORY_COLORS[activeWorkflow.category] || workbenchFallbackCategoryColor
  return h(Modal, {
    title: activeWorkflow.name,
    subtitle: activeWorkflow.description,
    onClose,
    footer: [
      h(Button, { key: 'copy', variant: 'quiet', icon: 'copy', disabled: !detailReady, onClick: copyPrompt, style: { marginRight: 'auto' } }, '复制 Prompt'),
      h(Button, { key: 'cancel', variant: 'ghost', onClick: onClose }, '取消'),
      h(Button, { key: 'use', variant: 'primary', icon: 'check', disabled: !hasDraftAction || !detailReady, onClick: validateThenUse }, '使用工作流程'),
    ],
  }, !detailReady ? [
    detailError
      ? h(Notice, { key: 'detail-error', tone: 'error', icon: 'shield' }, [
        `无法加载工作流详情：${detailError}`,
        h(Button, { key: 'retry', variant: 'quiet', size: 'sm', icon: 'refresh', onClick: () => setRetryNonce(value => value + 1), style: { marginLeft: 8 } }, '重试加载'),
      ])
      : h(Spinner, { key: 'detail-loading', text: '正在加载工作流详情……' }),
  ] : [
    h('div', { key: 'meta', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
      h(Chip, { key: 'cat', color }, activeWorkflow.category),
      h(Badge, { key: 'params', color: C.slate }, `${(activeWorkflow.placeholders || []).length} 个参数`),
      activeWorkflow.requiresFiles ? h(Badge, { key: 'file', color: C.amber }, '需要材料') : null,
    ]),
    activeWorkflow.requiresFiles ? h(Notice, {
      key: 'files', tone: 'warn', icon: 'file',
    }, activeWorkflow.limitations?.length
      ? `需要研究材料：使用后请在 DSH 输入框用原生回形针或 @文件 引用相关文件，再发送消息。本流程边界：${activeWorkflow.limitations.join(' ')}`
      : '需要研究材料：使用后请在 DSH 输入框用原生回形针或 @文件 引用相关文件，再发送消息。') : null,
    ...(activeWorkflow.placeholders || []).map(field => h(Field, {
      key: field.key,
      label: field.label,
      required: field.required,
      error: missingSet.has(field.label) ? '必填：此字段不能为空' : null,
      hint: field.hint || null,
    }, field.multiline
      ? h(Textarea, { value: values[field.key] || '', onChange: value => update(field.key, value), rows: 3, placeholder: field.hint || '', ariaLabel: field.label, style: missingSet.has(field.label) ? { borderColor: C.red } : undefined })
      : h(Input, { value: values[field.key] || '', onChange: value => update(field.key, value), placeholder: field.hint || '', ariaLabel: field.label, invalid: missingSet.has(field.label) }))),
    h(Field, { key: 'prompt', label: '提示词预览（可编辑）' },
      h(Textarea, { value: finalPrompt, onChange: setEditedPrompt, rows: 10, mono: true, ariaLabel: '提示词预览' })),
    attachedResources.length ? h('details', {
      key: 'resources',
      style: { padding: '9px 11px', border: `1px solid ${C.tealLine}`, borderRadius: 9, color: C.muted, fontSize: 13, lineHeight: 1.55 },
    }, [
      h('summary', { key: 's', style: { color: C.ink, cursor: 'pointer', fontWeight: 650 } }, `已附加资源（${attachedResources.length}）：${attachedResources.map(item => item.name).join('、')}`),
      h('ul', { key: 'l', style: { margin: '8px 0 0', paddingLeft: 18 } }, attachedResources.map(item => h('li', { key: item.id, style: { marginTop: 4 } },
        item.type === 'skill' ? `技能 · ${item.name}：作为提示词附加指导。` : `数据库 · ${item.name}：仅在当前会话具备访问能力时可查询。`))),
    ]) : null,
    notice ? h(Notice, { key: 'notice', tone: missing.length ? 'error' : 'warn' }, notice) : null,
  ])
}

const researchAutoSessions = new Map()
const researchAutoListeners = new Set()
const pendingFirstPrompts = new Map()

export function readResearchAutoSession(sessionId) {
  return researchAutoSessions.get(sessionId) || null
}

export function subscribeResearchAutoSessions(listener) {
  researchAutoListeners.add(listener)
  return () => researchAutoListeners.delete(listener)
}

export function inheritResearchAutoSession(sessions, sessionId) {
  if (!sessionId || !pendingFirstPrompts.size) return
  const alreadyEnabled = researchAutoSessions.has(sessionId)
  if (alreadyEnabled && !pendingFirstPrompts.has(sessionId)) return
  const events = readSessionEvents(sessions, sessionId, 128)
  const firstTurn = events.find(event => event.type === 'turn/start')
  if (firstTurn?.data?.turn !== 1) return
  const prompt = events.find(event => event.type === 'user/message' && (event.data?.message ?? event.data)?.source?.kind === 'user')
  const draft = (prompt?.data?.message ?? prompt?.data)?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n').trim()
  const now = Date.now()
  const matches = []
  for (const [previousId, pending] of pendingFirstPrompts) {
    if (pending.expires < now) { pendingFirstPrompts.delete(previousId); continue }
    if (draft === pending.draft && (!firstTurn.time || firstTurn.time >= pending.sentAt - 3000)) matches.push(previousId)
  }
  if (alreadyEnabled) {
    if (matches.includes(sessionId)) pendingFirstPrompts.delete(sessionId)
    return
  }
  if (matches.length !== 1) return
  const [previousId] = matches
  const { ignored } = pendingFirstPrompts.get(previousId)
  pendingFirstPrompts.delete(previousId)
  researchAutoSessions.delete(previousId)
  researchAutoSessions.set(sessionId, { ignored, afterSeq: Number(firstTurn.seq) || 0 })
  for (const listener of researchAutoListeners) listener()
}

export const RESEARCH_STEPS_HEADING = '科研执行步骤'
const SHORT_RESEARCH_STEPS = {
  'compare-papers': '先回答差异。关键数值随文交代指标、地点、比较对象、尺度和条件；区分实测、模型估计和推测，勿把局部阈值推广为通用门槛。',
  'review-paper': '先给最重要的审阅发现。逐条指出问题所在、影响和可行改进，区分材料未报告和方法本身的不足。',
  'literature-review': '先给简明结论。交代检索范围和纳入条件，区分一致发现、分歧和证据空白。',
}

export function compactResearchInstructions(workflowId, inheritedQuestion, selectedResources = []) {
  const steps = SHORT_RESEARCH_STEPS[workflowId]
  if (!steps) return ''
  return [
    RESEARCH_STEPS_HEADING,
    inheritedQuestion ? `延续问题：${inheritedQuestion}` : '',
    steps,
    '关键结论各占一条，句末标【依据：论文｜DOI｜原文章节或图表】；多篇用分号分隔。仅有元数据或缺少正文、补充材料时，标【缺口：具体缺失】，不推断缺失内容。篇幅按原问题要求。',
    ...selectedResources.map(item => {
      if (item.type === 'skill' && item.promptFragment) return `技能 · ${item.name}：${item.promptFragment}`
      if (item.type === 'database') return `数据源 · ${item.name}：${item.accessNote || '根据当前会话权限查询'}。核实查询成功后再引用。`
      return ''
    }),
  ].filter(Boolean).join('\n')
}

function matchResearchDraft(draft, materialCount) {
  const text = draft.trim()
  if (!text || text.length > 2500 || /^[/@]/.test(text) && !materialCount
      || /^(什么是|啥是|如何理解|请解释|解释一下|为什么|what is|what are|explain)/i.test(text)
      || /^(?:请\s*)?(?:(?:不要|不用|不需要|别)\s*(?:帮我|给我)?\s*(?:做|写|整理|开展|完成|制定|审阅|评审|审查|比较|对比)|(?:do not|don't)\s+(?:conduct|write|prepare|review|compare)\b)/i.test(text)
      || text.includes(RESEARCH_STEPS_HEADING)) return null
  if (materialCount >= 2 && /(?:比较|对比).{0,20}(?:论文|文献|证据|研究)|compare.{0,40}(?:papers|studies|evidence)/i.test(text)) {
    return { id: 'compare-papers', values: {}, reason: '当前问题涉及对比多份材料的发现和证据强度。' }
  }
  if (materialCount && /(?:审阅|评审|审查).{0,20}(?:论文|稿件)|(?:peer.review|review).{0,40}(?:paper|manuscript)/i.test(text)) {
    return { id: 'review-paper', values: {}, reason: '当前问题适合按方法、统计和局限逐项审阅。' }
  }
  if (/(?:做|写|整理|开展|完成|制定).{0,30}(?:文献综述|证据综述)|(?:conduct|write|prepare).{0,35}(?:literature review|evidence review)/i.test(text)) {
    return { id: 'literature-review', values: { question: text }, reason: '当前问题适合先明确检索范围，再综合已有证据。' }
  }
  return null
}

export function matchResearchSuggestion(draft, materialCount, readPrevious = () => '') {
  const direct = matchResearchDraft(draft, materialCount)
  if (direct || !/^(请)?(继续|接着|按刚才的|continue\b)/i.test(draft.trim())) return direct
  const inherited = matchResearchDraft(readPrevious(), materialCount)
  return inherited && { ...inherited, reason: '当前提问在延续本会话最近一次明确的研究任务。' }
}

function recentResearchRequest(sessions, sessionId) {
  const recent = readSessionEvents(sessions, sessionId, 24).findLast(event =>
    event.type === 'user/message' && (!(event.data?.message ?? event.data)?.source || (event.data?.message ?? event.data).source.kind === 'user'))
  const message = recent?.data?.message ?? recent?.data
  return message?.content?.find(block => block.type === 'text')?.text?.split(RESEARCH_STEPS_HEADING, 1)[0].trim().slice(0, 600) || ''
}

/** 由 conversation.input.overlay 承载，锚定在输入卡片上方。 */
export function ResearchComposerOverlay({ sessionId, input, useInput, inputActions, catalogStorage, sessions, useSession }) {
  const storage = React.useMemo(() => catalogStorage || createCatalogStorage(), [catalogStorage])
  const selection = React.useMemo(() => createResearchSelectionStore(sessionId), [sessionId])
  const [mode, setMode] = React.useState(null)
  const [query, setQuery] = React.useState('')
  const deferredQuery = React.useDeferredValue(query)
  const [resourceType, setResourceType] = React.useState('all')
  const [workflowCategory, setWorkflowCategory] = React.useState('all')
  const [resourceIds, setResourceIds] = React.useState(() => selection.get())
  const [launchWorkflow, setLaunchWorkflow] = React.useState(null)
  const popoverRef = React.useRef(null)
  const [popoverHeight, setPopoverHeight] = React.useState(null)
  const [catalogVersion, setCatalogVersion] = React.useState(0)
  const hookedInput = useInput ? useInput(value => value) : undefined
  const draftState = hookedInput?.draftRev !== undefined ? hookedInput : input
  const draft = draftState?.draft
  const revision = draftState?.draftRev
  const fileReferences = draftState?.occurrences?.filter(item => !item.invalid && item.appearance === 'file').length || 0
  const materialCount = (draftState?.attachmentIds?.length || 0) + fileReferences
  const available = Boolean(sessionId) && typeof draft === 'string' && Number.isInteger(revision)
    && typeof draftState?.phase === 'string' && supportsSafeInsert(inputActions)
  const autoSession = React.useSyncExternalStore(subscribeResearchAutoSessions, () => readResearchAutoSession(sessionId), () => null)
  const blank = typeof useSession === 'function' ? useSession(snapshot => snapshot?.blank) : undefined
  const [suggestion, setSuggestion] = React.useState(null)
  const [preview, setPreview] = React.useState(false)
  const [composing, setComposing] = React.useState(false)
  const [assistNotice, setAssistNotice] = React.useState('')
  const assistRef = React.useRef(null)
  const enabled = available && Boolean(autoSession)
  React.useEffect(() => {
    const inherit = () => inheritResearchAutoSession(sessions, sessionId)
    inherit()
    return sessions?.binding?.(sessionId)?.eventSource?.subscribe?.(inherit)
  }, [sessions, sessionId])
  React.useEffect(() => {
    if (!enabled || draftState?.phase !== 'sending' || !draft?.trim() || blank === false
        || (blank === undefined && autoSession.afterSeq > 0)) return
    const sentAt = Date.now()
    pendingFirstPrompts.set(sessionId, { draft: draft.trim(), ignored: autoSession.ignored, sentAt, expires: sentAt + 5 * 60 * 1000 })
    if (pendingFirstPrompts.size > 12) pendingFirstPrompts.delete(pendingFirstPrompts.keys().next().value)
  }, [enabled, draftState?.phase, draft, blank, sessionId, autoSession])
  React.useEffect(() => {
    setMode(null)
    setLaunchWorkflow(null)
    setSuggestion(null)
    setPreview(false)
    setAssistNotice('')
    setComposing(false)
  }, [sessionId])
  React.useEffect(() => {
    if (!enabled) {
      setComposing(false)
      return undefined
    }
    const onComposition = event => {
      if (event.target?.closest?.('[data-composer-card]') === assistRef.current?.closest('[data-composer-card]')) {
        const starting = event.type === 'compositionstart'
        if (starting) setSuggestion(null)
        setComposing(starting)
      }
    }
    document.addEventListener('compositionstart', onComposition)
    document.addEventListener('compositionend', onComposition)
    return () => {
      document.removeEventListener('compositionstart', onComposition)
      document.removeEventListener('compositionend', onComposition)
    }
  }, [enabled])
  const eligible = enabled && !composing && draftState?.phase === 'plain'
  const ignored = enabled ? readResearchAutoSession(sessionId)?.ignored : undefined
  React.useEffect(() => {
    setPreview(false)
    setAssistNotice('')
    if (!eligible || !draft.trim() || ignored?.has(draft.trim())) return undefined
    const handle = setTimeout(() => {
      const match = matchResearchSuggestion(draft, materialCount, () => recentResearchRequest(sessions, sessionId))
      if (match) setSuggestion({ ...match, sessionId, revision, draft, materialCount })
    }, 650)
    return () => clearTimeout(handle)
  }, [eligible, sessionId, revision, draft, materialCount, sessions, ignored])
  const currentSuggestion = eligible && suggestion?.sessionId === sessionId && suggestion.revision === revision
    && suggestion.draft === draft && suggestion.materialCount === materialCount && !ignored?.has(draft.trim()) ? suggestion : null
  React.useEffect(() => {
    if (mode || currentSuggestion) loadBrowserCatalog().catch(() => {})
  }, [mode, currentSuggestion])
  const suggestionWorkflow = currentSuggestion && itemById(currentSuggestion.id)
  const toggleAuto = () => {
    if (enabled) {
      researchAutoSessions.delete(sessionId)
      pendingFirstPrompts.delete(sessionId)
    }
    else {
      const afterSeq = Number(readSessionEvents(sessions, sessionId).findLast(event => Number.isFinite(Number(event.seq)))?.seq) || 0
      researchAutoSessions.set(sessionId, { ignored: new Set(), afterSeq })
    }
    for (const listener of researchAutoListeners) listener()
    setSuggestion(null)
  }
  const inheritedQuestion = currentSuggestion?.values.question
  const suggestedText = suggestionWorkflow && compactResearchInstructions(
    suggestionWorkflow.id,
    inheritedQuestion && inheritedQuestion !== draft.trim() ? inheritedQuestion : '',
    resourceIds.map(itemById).filter(Boolean),
  )
  const dismissSuggestion = () => {
    if (ignored?.size >= 25) ignored.delete(ignored.values().next().value)
    ignored?.add(draft.trim())
    setSuggestion(null)
    setPreview(false)
    setAssistNotice('')
  }
  const adoptSuggestion = () => {
    if (!currentSuggestion || !suggestedText) return
    const span = inputActions.captureInsertion()
    if (span?.draftRev !== currentSuggestion.revision || !inputActions.insertText(`\n\n${suggestedText}\n\n`, { ...span, start: span.end })) {
      setAssistNotice('草稿暂时无法写入，请检查当前输入后重试。')
      return
    }
    storage.recordHistory?.({ id: suggestionWorkflow.id, name: suggestionWorkflow.name })
    createEvidenceStore(sessionId).recordWorkflow({
      id: suggestionWorkflow.id, name: suggestionWorkflow.name,
      resourceIds: unique(resourceIds),
    })
    dismissSuggestion()
  }
  // 目录可能由默认工作台先加载完成；浮层关闭时也要订阅版本变化，否则首次打开时
  // useMemo 仍会保留挂载阶段基于空目录算出的分类与计数。
  React.useEffect(() => subscribeCatalog(() => setCatalogVersion(value => value + 1)), [])
  // 浮层贴住输入卡片上沿，而不是钉在视口左下角：
  // 槽位锚点是卡片顶边的零高条，绝对定位即与触发按钮同宽同轴；
  // 可用高度按「卡片顶边 → 滚动区顶边」实测，随输入框行数、附件栏与窗口尺寸自适应。
  React.useLayoutEffect(() => {
    if (!mode) { setPopoverHeight(null); return }
    const node = popoverRef.current
    // 锚点缺失时放弃测量：绝不以浮层自身的矩形当锚点，否则高度会自反馈抖动。
    const anchor = node?.closest('[data-composer-card]')
    if (!anchor) return
    const measure = () => {
      const scrollport = findScrollport(anchor)
      setPopoverHeight(overlayMaxHeight(
        anchor.getBoundingClientRect().top,
        scrollport ? scrollport.getBoundingClientRect().top : 0,
      ))
      return scrollport
    }
    // 卡片与滚动区都要观察：输入框变高会移动卡片顶边，滚动区变矮会压缩可用空间，
    // 这两种布局变化都不触发 window resize，只靠 resize 事件会残留过期高度。
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(anchor)
    const scrollport = measure()
    if (scrollport) observer?.observe(scrollport)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [mode])
  React.useEffect(() => {
    const onOpen = event => {
      if (event.detail?.sessionId !== sessionId) return
      const nextMode = event.detail?.mode === 'resources' ? 'resources' : 'workflows'
      setMode(nextMode)
      setQuery('')
      if (nextMode === 'resources') setResourceType('all')
      else setWorkflowCategory('all')
    }
    window.addEventListener(RESEARCH_COMPOSER_EVENT, onOpen)
    return () => window.removeEventListener(RESEARCH_COMPOSER_EVENT, onOpen)
  }, [sessionId])
  React.useEffect(() => { setResourceIds(selection.get()); return selection.subscribe(setResourceIds) }, [selection])
  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent(RESEARCH_RESOURCE_SELECTION_EVENT, { detail: { sessionId, count: resourceIds.length, enabled } }))
  }, [sessionId, resourceIds, enabled])
  // Escape 关闭最上层的弹层：先关预览弹窗，再关选择器。
  React.useEffect(() => {
    if (!mode && !launchWorkflow && !preview) return
    const onKeyDown = event => {
      if (event.key !== 'Escape') return
      if (preview) setPreview(false)
      else if (launchWorkflow) setLaunchWorkflow(null)
      else setMode(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, launchWorkflow, preview])
  // 浮层不是 Modal，没有遮罩层；因此要在文档层判定“点击是否落在整张浮层卡片内”。
  // 不能绑在内容滚动区，否则标题、筛选栏或卡片边框都会被误判为外部点击。
  React.useEffect(() => {
    if (!mode || launchWorkflow) return undefined
    const onPointerDown = event => {
      if (popoverRef.current?.contains(event.target)) return
      setMode(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [mode, launchWorkflow])
  const selectedOnly = mode === 'resources' && resourceType === 'selected' ? resourceIds : null
  const listType = mode === 'workflows' ? 'workflow' : selectedOnly ? 'all' : resourceType
  const [remoteSearch, setRemoteSearch] = React.useState({ query: '', type: '', matches: null })
  React.useEffect(() => {
    const trimmed = deferredQuery.trim()
    if (!mode || !trimmed || !catalogIndexMode()) {
      setRemoteSearch({ query: '', type: '', matches: null })
      return undefined
    }
    const controller = new AbortController()
    searchCatalogRemote({ query: trimmed, type: listType }, { signal: controller.signal })
      .then(results => {
        if (controller.signal.aborted) return
        setRemoteSearch({ query: trimmed, type: listType, matches: new Map(results.map(row => [row.id, row])) })
      })
      .catch(() => { /* 远端正文检索失败时保留本地索引结果 */ })
    return () => controller.abort()
  }, [mode, deferredQuery, listType])
  const remoteMatches = remoteSearch.query === deferredQuery.trim() && remoteSearch.type === listType ? remoteSearch.matches : null
  const rows = React.useMemo(() => mode ? searchCatalog({ query: deferredQuery, type: listType, remoteMatches })
    .filter(item => mode !== 'resources' || item.type !== 'workflow')
    .filter(item => mode !== 'workflows' || workflowCategory === 'all' || item.category === workflowCategory)
    .filter(item => !selectedOnly || selectedOnly.includes(item.id)) : [],
  [deferredQuery, listType, mode, workflowCategory, catalogVersion, selectedOnly, remoteMatches])
  const close = () => setMode(null)
  const selectWorkflow = workflow => { setLaunchWorkflow({ workflow, draft, revision, sessionId }); setMode(null) }
  const recommendedWorkflows = React.useMemo(
    () => selectedOnly && !deferredQuery.trim() ? recommendedWorkflowsForResources(selectedOnly).slice(0, 4) : [],
    [selectedOnly, deferredQuery, catalogVersion],
  )
  const workflowCategories = React.useMemo(
    () => [...new Set(catalog.filter(item => item.type === 'workflow' && item.category).map(item => item.category))],
    [catalogVersion],
  )
  const resourceFilters = [
    { value: 'all', label: '全部资源' },
    { value: 'database', label: '数据库' },
    { value: 'skill', label: '技能' },
    ...(resourceIds.length || selectedOnly ? [{ value: 'selected', label: `已选 ${resourceIds.length} 项` }] : []),
  ]
  const pickerHeight = popoverHeight ?? POPOVER_MAX_HEIGHT
  const autoScopeId = React.useId()
  if (!mode && !launchWorkflow && !enabled) return null
  return h(React.Fragment, null, [
    h('div', { key: 'assist', ref: assistRef, className: 'rk-compose-suggestion' },
      !mode && !launchWorkflow && suggestionWorkflow ? h('section', { 'aria-label': '科研建议' }, [
        h('div', { key: 'text', role: 'status' }, [
          h('strong', { key: 'name' }, suggestionWorkflow.name),
          h('div', { key: 'why', className: 'rk-compose-reason' }, currentSuggestion.reason),
        ]),
        h('div', { key: 'actions', className: 'rk-compose-actions' }, [
          h(Button, { key: 'adopt', variant: 'primary', size: 'sm', onClick: adoptSuggestion, title: '在光标处插入科研步骤，保留原文与引用' }, '采用'),
          h(Button, { key: 'preview', variant: 'ghost', size: 'sm', onClick: () => setPreview(true) }, '预览改动'),
          h(Button, { key: 'skip', variant: 'ghost', size: 'sm', onClick: dismissSuggestion }, '略过'),
        ]),
        assistNotice ? h('div', { key: 'notice', role: 'status' }, assistNotice) : null,
      ]) : null),
    preview && !mode && suggestedText ? h(Modal, { key: 'preview', title: '预览科研建议', onClose: () => setPreview(false) }, [
      h('p', { key: 'description', style: { color: C.muted } }, '确认后会在光标处插入以下步骤，保留原提问、附件和引用。'),
      h(Textarea, { key: 'text', value: suggestedText, readOnly: true, ariaLabel: '将插入的科研步骤', rows: 9 }),
      h(Button, { key: 'apply', variant: 'primary', onClick: adoptSuggestion }, '采用并插入'),
      assistNotice ? h(Notice, { key: 'notice', tone: 'warn' }, assistNotice) : null,
    ]) : null,
    mode ? h('section', {
      key: 'popover',
      ref: popoverRef,
      role: 'dialog',
      'aria-label': mode === 'workflows' ? '选择科研工作流程' : '选择科研资源',
      className: 'rk-pop rk-composer-picker',
      'data-short': pickerHeight < 230 ? '' : undefined,
      style: {
        position: 'absolute', left: 0, width: 'min(460px, 100%)',
        bottom: `calc(100% + ${POPOVER_GAP}px)`,
        maxHeight: popoverHeight == null ? POPOVER_MAX_HEIGHT : popoverHeight,
      },
    }, [
      h(GlobalStyle, { key: 'style' }),
      h('header', { key: 'head', className: 'rk-picker-header' }, [
        h('div', { key: 'top', className: 'rk-picker-top' }, [
          h('div', { key: 'tabs', role: 'tablist', 'aria-label': '科研辅助功能', className: 'rk-picker-tabs' },
            [['workflows', '选流程'], ['resources', '加资源']].map(([value, label]) => h('button', {
              key: value, type: 'button', role: 'tab', 'aria-selected': mode === value,
              onClick: () => { setMode(value); setQuery(''); popoverRef.current?.scrollTo(0, 0) },
            }, label)),
          ),
          h('div', { key: 'actions', className: 'rk-picker-actions' }, [
            available ? h('label', {
              key: 'auto', className: 'rk-picker-switch',
              title: '仅当前会话：提问时推荐流程，回答后准备可保存候选。插入和保存均需确认。',
            }, [
              h('span', { key: 'label' }, '自动科研辅助'),
              h('input', { key: 'check', type: 'checkbox', role: 'switch', checked: enabled, onChange: toggleAuto, 'aria-describedby': autoScopeId }),
              h('span', { key: 'track', className: 'rk-picker-switch-track', 'aria-hidden': true }),
              h('span', { key: 'scope', id: autoScopeId, hidden: true }, '仅当前会话：提问时推荐流程，回答后准备可保存候选。插入和保存均需确认。'),
            ]) : null,
            h(IconButton, { key: 'close', name: 'close', size: 14, label: '关闭', onClick: close, style: { border: 0, background: 'transparent', borderRadius: 6 } }),
          ]),
        ]),
        h('div', { key: 'filters', className: 'rk-picker-filters' }, [
          h(SearchInput, {
            key: 'search', value: query, onChange: setQuery, ariaLabel: '搜索',
            placeholder: mode === 'workflows' ? '搜索工作流程' : '搜索技能或数据库',
          }),
          h(Select, {
            key: 'filter', className: 'rk-picker-filter',
            ariaLabel: mode === 'workflows' ? '工作流程分类' : '资源类型',
            value: mode === 'workflows' ? workflowCategory : resourceType,
            onChange: value => {
              if (mode === 'workflows') setWorkflowCategory(value)
              else setResourceType(value)
              popoverRef.current?.scrollTo(0, 0)
            },
            options: mode === 'workflows'
              ? [{ value: 'all', label: '全部分类' }, ...workflowCategories.map(value => ({ value, label: value }))]
              : resourceFilters,
            style: { height: 32, padding: '4px 20px 4px 8px', fontSize: 12 },
          }),
          mode === 'workflows' ? h('button', {
            key: 'organize', type: 'button', className: 'rk-picker-text-action rk-picker-organize',
            'aria-label': '整理当前提问', title: '整理当前提问',
            onClick: () => {
              close()
              window.dispatchEvent(new CustomEvent(RESEARCH_ORGANIZE_EVENT, { detail: { sessionId } }))
            },
          }, '整理提问') : resourceIds.length ? h('button', {
            key: 'add', type: 'button', className: 'rk-picker-text-action rk-picker-done', onClick: close,
          }, `完成 · ${resourceIds.length}`) : null,
        ]),
      ]),
      h('div', { key: 'rows', className: 'rk-picker-results', 'aria-label': '科研选择结果' }, [
        selectedOnly?.length ? h('div', { key: 'selected', className: 'rk-picker-selected' }, [
          h('span', { key: 'count' }, `已选 ${resourceIds.length} 项`),
          h('button', { key: 'clear', type: 'button', className: 'rk-picker-text-action', onClick: () => selection.clear() }, '清空'),
        ]) : null,
        rows.length ? rows.map(item => {
          const workflow = mode === 'workflows'
          const checked = !workflow && resourceIds.includes(item.id)
          return h(workflow ? 'button' : 'label', {
            key: item.id,
            className: 'rk-picker-row',
            'data-selected': checked ? '' : undefined,
            'data-material': workflow && item.requiresFiles ? '' : undefined,
            ...(workflow ? { type: 'button', onClick: () => selectWorkflow(item) } : {}),
          }, [
            workflow ? null : h('input', { key: 'select', type: 'checkbox', checked, onChange: () => selection.toggle(item.id) }),
            h('span', { key: 'text', className: 'rk-picker-row-text' }, [
              h('strong', { key: 'name' }, item.name),
              h('span', { key: 'desc', className: 'rk-picker-desc', title: item.description }, item.description),
            ]),
            h('span', { key: 'meta', className: 'rk-picker-meta' }, workflow
              ? (item.requiresFiles ? '需材料' : item.category)
              : COMPOSER_TYPE_LABELS[item.type]),
          ])
        }) : h('p', { key: 'empty', className: 'rk-picker-empty' }, selectedOnly && !selectedOnly.length
          ? '还没有选择资源。'
          : catalog.length ? '没有匹配结果，试试其他关键词或分类。' : '正在读取科研目录…'),
        recommendedWorkflows.length ? h('div', { key: 'recommended', className: 'rk-picker-selected' }, [
          h('span', { key: 'label' }, '推荐流程'),
          ...recommendedWorkflows.map(workflow => h('button', {
            key: workflow.id, type: 'button', className: 'rk-picker-text-action', onClick: () => selectWorkflow(workflow),
          }, workflow.name)),
        ]) : null,
      ]),
    ]) : null,
    launchWorkflow && launchWorkflow.sessionId === sessionId ? h(WorkflowLaunchDialog, { key: 'dialog', workflow: launchWorkflow.workflow, originalDraft: launchWorkflow.draft, originalRevision: launchWorkflow.revision, resourceIds, inputActions, catalogStorage: storage, sessionId, onClose: () => setLaunchWorkflow(null) }) : null,
  ])
}
