import React from 'react'
import { h, C } from './theme.js'
import { Button, Card, IconButton, Notice, Spinner, Input, Icon } from './ui.js'
import { currentResearchContext, activeResearchRun, listResearchRuns, resumeResearchRun, setResearchContext, setResearchProject, subscribeResearchContext } from './research-context-store.js'
import { supportsSafeInsert } from './lib/input-actions.js'
import { itemById } from './catalog.js'
import { evidenceVaultStore, subscribeEvidenceVault, syncEvidenceVaultWithFiles } from './lib/evidence-vault-sync.js'
import { synchronizeResearchClaims } from './lib/claim-review-client.js'
import { listDreamReports, pendingDreamInbox, subscribeDreamStore } from './dream-store.js'
import { ResearchDreamPanel } from './research-dream-panel.js'
import { pushToast } from './lib/toast.js'

const HOME_RUN_LABELS = { draft: '提示词草稿', active: '已发送到会话', waiting_review: '待人工审核', completed: '已完成', failed: '失败' }

export function ResearchProjectHome({ sessionId = '', onNavigate, insertMaterialReference, inputActions, onPendingStart, pendingExpanded, onPendingExpand, pendingReturn, dreamFocus }) {
  const [context, setContext] = React.useState(currentResearchContext)
  const [allPending, setAllPending] = React.useState(null)
  const [pendingPageSize, setPendingPageSize] = React.useState(20)
  const [pendingError, setPendingError] = React.useState('')
  const [openingPending, setOpeningPending] = React.useState(false)
  const pendingTitleRef = React.useRef(null)
  const appliedPendingReturn = React.useRef(null)
  const [loaded, setData] = React.useState(null)
  const [error, setError] = React.useState('')
  const [draftFeedback, setDraftFeedback] = React.useState('')
  const [projectEditor, setProjectEditor] = React.useState(null)
  const [externalRunId, setExternalRunId] = React.useState('')
  const [runAction, setRunAction] = React.useState(false)
  const [runFeedback, setRunFeedback] = React.useState('')
  const [dreamRevision, setDreamRevision] = React.useState(0)
  React.useEffect(() => subscribeDreamStore(() => setDreamRevision(value => value + 1)), [])
  const [refreshSpin, setRefreshSpin] = React.useState(0)
  const run = activeResearchRun()
  const scopedRun = run?.project === context.project ? run : null
  const activeRunId = scopedRun?.id || (run ? '' : context.activeRunId)
  const version = React.useRef(0)
  React.useEffect(() => subscribeResearchContext(setContext), [])
  const refresh = React.useCallback(async () => {
    const request = ++version.current
    const store = evidenceVaultStore()
    let syncError = ''
    try {
      await syncEvidenceVaultWithFiles(context.project || undefined).catch(failure => { syncError = `文件同步失败：${failure.message}` })
      const [counts, ledger, claims, pendingEvidence, workspaces] = await Promise.all([
        store.evidenceSummary({ project: context.project }),
        store.listResearchLedger({ project: context.project }),
        synchronizeResearchClaims(store, context.project).then(result => result.claims)
          .catch(failure => { syncError += ` Claim 台账暂不可达：${failure.message}`; return store.listResearchClaims({ project: context.project }) }),
        store.listPage({ project: context.project, filter: 'unverified', limit: 1 }).then(page => page.rows || []),
        store.listWorkspaces ? store.listWorkspaces({ includeArchived: false }).catch(() => []) : Promise.resolve([]),
      ])
      const runClaims = activeRunId ? claims.filter(claim => claim.run_id === activeRunId) : claims
      const missing = new Set()
      if (runClaims.some(claim => claim.links?.length)) {
        const ids = new Set((await store.list({ project: context.project })).map(entry => entry.id))
        for (const claim of runClaims) {
          for (const link of claim.links || []) if (!ids.has(link.evidenceId)) missing.add(link.evidenceId)
        }
      }
      let activity = null
      if (activeRunId) {
        const params = new URLSearchParams({ run_id: activeRunId, limit: '30' })
        try {
          const response = await fetch(`/dsh-research-kit/agent-activity?${params}`, { signal: AbortSignal.timeout(5000) })
          activity = await response.json()
          if (!response.ok || !activity.ok) throw new Error(activity.error || `HTTP ${response.status}`)
        } catch (failure) { syncError += ` 运行状态暂不可达：${failure.message}`; activity = null }
      }
      if (request !== version.current) return
      setData({ counts, ledger, claims, pendingEvidence, workspaces: workspaces || [], activity, missing, project: context.project, runId: activeRunId }); setError(syncError)
    } catch (failure) { if (request === version.current) setError(`读取失败，保留上次数据：${failure.message}`) }
  }, [context.project, activeRunId])
  React.useEffect(() => { refresh(); const dispose = subscribeEvidenceVault(refresh); return () => { version.current++; dispose() } }, [refresh])
  const data = loaded?.project === context.project && loaded?.runId === activeRunId ? loaded : null
  const projectRuns = listResearchRuns({ project: context.project }).sort((a, b) => b.createdAt - a.createdAt)
  const recentRun = projectRuns.find(item => ['draft', 'active', 'waiting_review'].includes(item.status))
  const dreamItems = React.useMemo(() => pendingDreamInbox(listDreamReports(context.project)), [context.project, dreamRevision])
  const claimItems = React.useMemo(() => (data?.claims || [])
    .filter(claim => !['verified', 'rejected'].includes(claim.state))
    .map(row => ({ key: `claim:${row.id}`, kind: 'claim', id: row.id, action: '审阅论断', text: row.statement })), [data?.claims])
  const dreamTasks = React.useMemo(() => dreamItems.map(row => ({
    key: `dream:${row.id}`, kind: 'dream', id: row.id, action: '查看梦境提案', text: row.title,
  })), [dreamItems])
  const evidenceTasks = rows => rows.map(row => ({
    key: `evidence:${row.id}`, kind: 'evidence', id: row.id, action: '核对证据', text: row.title,
  }))
  const recommended = claimItems[0] || evidenceTasks(data?.pendingEvidence || [])[0] || dreamTasks[0]
  const pendingCount = claimItems.length + (data?.counts.unverified || 0) + dreamTasks.length
  const loadPendingEvidence = async () => {
    if ((data?.counts.unverified || 0) <= 1) return evidenceTasks(data?.pendingEvidence || [])
    const records = await evidenceVaultStore().list({ project: context.project })
    return evidenceTasks(records.filter(row => row.status === 'unverified'))
  }
  React.useEffect(() => {
    if (!pendingExpanded || !data) return undefined
    let active = true
    loadPendingEvidence().then(rows => {
      if (active) setAllPending({ project: context.project, rows })
    }).catch(() => {
      if (active) setPendingError('暂时无法展开待核验证据。')
    })
    return () => { active = false }
  }, [pendingExpanded, data, context.project])
  React.useEffect(() => {
    if (dreamFocus) document.getElementById(`rk-dream-${dreamFocus}`)?.focus()
  }, [dreamFocus, dreamRevision])
  const pendingList = pendingExpanded
    ? [...claimItems, ...(allPending?.project === context.project ? allPending.rows : evidenceTasks(data?.pendingEvidence || [])), ...dreamTasks]
    : recommended ? [recommended] : []
  const returnIndex = pendingReturn ? pendingList.findIndex(item => item.key === pendingReturn.key) : -1
  const visiblePending = pendingList.slice(0, Math.max(pendingPageSize, returnIndex + 1))
  React.useEffect(() => {
    if (!pendingReturn || !data || appliedPendingReturn.current === pendingReturn) return
    if (pendingExpanded && !allPending && (data.counts.unverified || 0) > 1 && !pendingError) return
    const title = pendingTitleRef.current
    const items = title?.closest('section')?.querySelectorAll('[data-pending-key]') || []
    const previous = [...items].find(item => item.dataset.pendingKey === pendingReturn.key)
    const target = previous || title
    if (target) {
      target.focus()
      appliedPendingReturn.current = pendingReturn
    }
  }, [pendingReturn, data, pendingExpanded, allPending, pendingError])
  const openPending = async item => {
    if (openingPending) return
    setOpeningPending(true); setPendingError('')
    try {
      const rows = await loadPendingEvidence()
      if (currentResearchContext().project !== context.project) return
      const queue = [...claimItems, ...rows, ...dreamTasks]
      if (onPendingStart) onPendingStart(context.project, queue, item)
      else if (item.kind === 'dream') document.getElementById(`rk-dream-${item.id}`)?.focus()
      else if (item.kind === 'claim') onNavigate('vault', { tab: 'claims', claimId: item.id })
      else onNavigate('vault', { tab: 'evidence', evidenceId: item.id })
    } catch {
      setPendingError('暂时无法读取待处理记录，请重试。')
    } finally { setOpeningPending(false) }
  }
  const scopedClaims = activeRunId ? (data?.claims || []).filter(claim => claim.run_id === activeRunId) : data?.claims || []
  const pending = scopedClaims.filter(claim => !['verified', 'rejected'].includes(claim.state)).length
  const question = scopedClaims.find(claim => claim.question)?.question || data?.claims.find(claim => claim.question)?.question
  const overview = data?.activity?.run_overview
  const checkpoints = data?.activity?.checkpoints || []
  const pendingStages = overview?.passport_found && overview.project !== (context.project || 'default')
    ? []
    : overview?.checkpoint_state?.pending || checkpoints.filter(cp => cp.run_id === activeRunId)
      .flatMap(cp => Object.entries(cp.checkpoints || {}).filter(([, checkpoint]) => !checkpoint.approved).map(([stage]) => stage))
  const outputs = (data?.ledger || []).filter(event => event.kind === 'artifact' && (!activeRunId || event.runId === activeRunId)).slice(0, 3)
  const activityOutputs = data?.activity?.artifacts || []
  const openProjectEditor = () => {
    setProjectEditor(previous => previous === null ? context.project : null)
    setExternalRunId('')
    setRunFeedback('')
  }
  const bindRun = async event => {
    event.preventDefault()
    const id = externalRunId.trim()
    if (!id || runAction) return
    setRunAction(true)
    setRunFeedback('')
    try {
      const params = new URLSearchParams({ run_id: id, limit: '1' })
      const response = await fetch(`/dsh-research-kit/agent-activity?${params}`, { signal: AbortSignal.timeout(5000) })
      const activity = await response.json()
      if (!response.ok || !activity.ok) throw new Error('无法读取运行，请检查运行 ID 后重试。')
      const found = activity.run_overview
      if (!found?.passport_found || found.run_id !== id || found.project !== (context.project || 'default')) throw new Error('当前课题中找不到该运行，请核对课题和运行 ID。')
      if (currentResearchContext().project !== context.project) return
      setResearchContext({ activeRunId: id })
      setProjectEditor(null)
      setExternalRunId('')
    } catch (failure) { setRunFeedback(failure.message) }
    finally { setRunAction(false) }
  }
  const approveStage = async stage => {
    if (!activeRunId || runAction) return
    setRunAction(true)
    setRunFeedback('')
    try {
      const response = await fetch('/dsh-research-kit/agent-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'research_run_checkpoint_approve', run_id: activeRunId, stage }),
        signal: AbortSignal.timeout(5000),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`)
      if (currentResearchContext().activeRunId === activeRunId) await refresh()
    } catch (failure) { setRunFeedback(`阶段确认失败：${failure.message}`) }
    finally { setRunAction(false) }
  }
  const restore = id => {
    setDraftFeedback('')
    if (!resumeResearchRun(id, context.project)) setError('研究运行已变更，请刷新项目状态。')
  }
  const prepareContinuation = (id = activeRunId, pendingRun = scopedRun) => {
    if (!id) return
    if (!supportsSafeInsert(inputActions)) { setDraftFeedback('已恢复研究进度。打开会话输入框后可继续。'); return }
    const prompt = [
      `继续科研运行 ${id}，研究项目：${context.project || 'default'}。`,
      '先用 research_run_status 查看进度，再用 research_context_pack 读取现有论断、证据和回执。后续记录沿用这个 run_id。',
      pendingRun?.workflowId
        ? `若没有状态护照，核对材料后用 research_run_start，以工作流 ${pendingRun.workflowId} 和原 run_id 初始化。`
        : '请保留待人工核验项和检查点。',
    ].join('\n')
    try {
      const ok = inputActions.insertText(prompt, inputActions.captureInsertion()) === true
      const msg = ok ? '已填入输入框，可编辑后发送。' : '草稿暂不可写入，请切回会话后重试。'
      setDraftFeedback(msg)
      pushToast({ message: msg, tone: ok ? 'info' : 'warn' })
    } catch (error) { setDraftFeedback(error.message); pushToast({ message: error.message, tone: 'warn' }) }
  }
  const hasActivity = Boolean(
    activeRunId || scopedRun || question || pending > 0 || (data?.counts?.all || 0) > 0
    || outputs.length || activityOutputs.length || pendingStages.length || (data?.missing?.size || 0) > 0,
  )
  const launchItems = [
    { key: 'review', label: '做文献综述', desc: '按问题检索、筛选来源并生成综述草案', icon: 'layers', primary: false, onClick: () => onNavigate('catalog', { workflowId: 'literature-review' }) },
    { key: 'paper', label: '审阅论文', desc: '逐节核查方法、统计与论断证据链', icon: 'file', primary: false, onClick: () => onNavigate('catalog', { workflowId: 'review-paper' }) },
    { key: 'claims', label: '验证研究结论', desc: '从回答提取论断并关联已保存证据', icon: 'shield', primary: false, onClick: () => onNavigate('vault', { tab: 'claims' }) },
  ]
  return h('div', { className: 'rk-page rk-home-page' }, [
    h('header', { key: 'head', className: 'rk-home-header' }, [
      h('div', { key: 'left', style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } }, [
        h('h1', { key: 'title', style: { margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-.01em', color: C.ink } }, '本次研究'),
        h(Button, { key: 'project', size: 'sm', variant: 'soft', onClick: openProjectEditor, 'aria-expanded': projectEditor !== null }, context.project ? `课题 · ${context.project}` : '研究课题'),
      ]),
      h('div', { key: 'right', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
        h(IconButton, {
          key: 'refresh', iconKey: refreshSpin, name: 'refresh', size: 14, label: '刷新项目状态',
          className: refreshSpin ? 'rk-btn rk-spin-once' : 'rk-btn',
          onClick: () => { setRefreshSpin(v => v + 1); refresh() },
        }),
      ]),
    ]),
    projectEditor !== null ? h(Card, { key: 'project-panel', className: 'rk-reveal', style: { display: 'grid', gap: 8 } }, [
      (data?.workspaces || []).length ? h('div', { key: 'quick-projects', className: 'rk-compose-actions' }, [
        h('span', { key: 'l', style: { fontSize: 12, color: C.muted } }, '快速切换'),
        h(Button, {
          key: '__default__', size: 'sm', variant: !context.project ? 'soft' : 'ghost',
          onClick: () => { setResearchProject(''); setProjectEditor(null) },
        }, '默认课题'),
        ...(data.workspaces || []).filter(item => item.projectKey).slice(0, 8).map(item => h(Button, {
          key: item.projectKey, size: 'sm', variant: context.project === item.projectKey ? 'soft' : 'ghost',
          onClick: () => { setResearchProject(item.projectKey); setProjectEditor(null) },
        }, item.name || item.projectKey)),
      ]) : null,
      h('form', { key: 'project', className: 'rk-compose-actions', onSubmit: event => {
        event.preventDefault()
        setResearchProject(projectEditor)
        setProjectEditor(null)
      } }, [
        h(Input, { key: 'name', value: projectEditor, onChange: setProjectEditor, ariaLabel: '研究课题名称', placeholder: '输入新课题名，或留空回默认课题', maxLength: 100, style: { width: 'min(260px, 100%)' } }),
        h(Button, { key: 'save', type: 'submit', size: 'sm', variant: 'primary' }, '切换课题'),
      ]),
      h('small', { key: 'hint', style: { color: C.muted } }, '按课题隔离查看已保存的资料、证据与论断。'),
      h('details', { key: 'run' }, [
        h('summary', { key: 'label', style: { cursor: 'pointer', color: C.muted, fontSize: 12 } }, '载入已有研究运行'),
        projectRuns.length ? h('div', { key: 'recent-runs', className: 'rk-compose-actions', style: { marginTop: 8 } }, projectRuns.slice(0, 4).map(item => h(Button, {
          key: item.id, size: 'sm', variant: activeRunId === item.id ? 'soft' : 'ghost',
          onClick: () => { restore(item.id); setProjectEditor(null) },
        }, `${item.workflowName || item.workflowId || '研究运行'} · ${new Date(item.createdAt || 0).toLocaleDateString('zh-CN')}`))) : null,
        h('form', { key: 'form', className: 'rk-compose-actions', style: { marginTop: 8 }, onSubmit: bindRun }, [
          h(Input, { key: 'id', value: externalRunId, onChange: setExternalRunId, ariaLabel: '研究运行 ID', placeholder: '或粘贴外部运行 ID', maxLength: 120, style: { width: 'min(260px, 100%)' } }),
          h(Button, { key: 'bind', type: 'submit', size: 'sm', disabled: runAction || !externalRunId.trim() }, '载入运行'),
        ]),
      ]),
    ]) : null,
    runFeedback ? h(Notice, { key: 'run-feedback', tone: 'warn' }, runFeedback) : null,
    error ? h(Notice, { key: 'error', tone: 'warn' }, `${error}。当前显示本地记录，网络恢复后可刷新同步。`) : null,
    h('div', { key: 'next-action', className: 'rk-compose-actions' }, [
      h(Button, { key: 'primary', variant: 'primary', onClick: () => {
        if (activeRunId) return prepareContinuation()
        if (recentRun) {
          const resumed = resumeResearchRun(recentRun.id, context.project)
          if (resumed) prepareContinuation(resumed.id, resumed)
          else setError('研究运行已变更，请刷新项目状态。')
          return
        }
        onNavigate('catalog')
      } }, activeRunId || recentRun ? '继续上次研究' : '开始研究'),
      draftFeedback ? h('span', { key: 'draft-feedback', role: 'status', className: 'rk-fade', style: { color: C.teal } }, draftFeedback) : null,
    ]),
    h('details', { key: 'task-shortcuts' }, [
      h('summary', { key: 'label' }, '研究任务'),
      h('div', { key: 'tasks', className: 'rk-home-launch-grid' }, launchItems.map(item => h('button', {
      key: item.key,
      type: 'button',
      'aria-label': item.label,
      className: `rk-home-launch-card${item.primary ? ' rk-home-launch-card--primary' : ''}`,
      onClick: item.onClick,
    }, [
      h('div', { key: 'top', className: 'rk-home-launch-head' }, [
        h('span', { key: 'icon', className: 'rk-home-launch-icon' }, h(Icon, { name: item.icon, size: 15 })),
        h(Icon, { key: 'arrow', name: 'arrowRight', size: 13, style: { color: C.muted } }),
      ]),
      h('strong', { key: 'label', style: { fontSize: 14, color: C.ink } }, item.label),
      h('span', { key: 'desc', style: { fontSize: 12, color: C.muted, lineHeight: 1.45 } }, item.desc),
    ]))),
    ]),
    projectRuns.length > 1 ? h('details', { key: 'run-history' }, [
      h('summary', { key: 'label' }, '研究运行历史'),
      h('label', { key: 'run-picker', style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, [
        '恢复指定运行',
        h('select', { key: 'select', value: activeRunId, onChange: event => restore(event.target.value), 'aria-label': '恢复指定运行' }, [
          h('option', { key: 'none', value: '', disabled: true }, '选择运行'),
          ...projectRuns.map(item => h('option', { key: item.id, value: item.id },
            `${item.workflowName || item.workflowId || '研究运行'} · ${new Date(item.createdAt || 0).toLocaleString()} · ${item.id}`)),
        ]),
      ]),
    ]) : null,
    insertMaterialReference && hasActivity ? h(ResearchMaterialReferenceForm, { key: 'materials', insert: insertMaterialReference }) : null,
    (pendingCount || pendingStages.length) ? h(Card, { key: 'pending', as: 'section', 'aria-label': '待处理', className: 'rk-reveal', style: { display: 'grid', gap: 8 } }, [
      h('div', { key: 'pending-header', style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' } }, [
        h('strong', { key: 'title', ref: pendingTitleRef, tabIndex: -1, style: { scrollMarginTop: 'calc(var(--rk-console-nav-h, 0px) + 12px)' } }, `待处理 ${pendingCount + pendingStages.length} 项`),
        pendingCount > 1 ? h(Button, {
          key: 'more', size: 'sm', variant: 'quiet', 'aria-expanded': pendingExpanded,
          onClick: () => { setPendingError(''); onPendingExpand?.(!pendingExpanded) },
        }, pendingExpanded ? '收起待处理' : '查看全部') : null,
      ]),
      ...visiblePending.map(item => h(Button, { key: item.key, size: 'sm', variant: 'ghost', 'data-pending-key': item.key,
        disabled: openingPending, onClick: () => openPending(item),
        style: { justifyContent: 'start', textAlign: 'left', whiteSpace: 'normal' } }, `${item.action} · ${item.text}`)),
      pendingExpanded && pendingCount > pendingPageSize ? h(Button, {
        key: 'more-items', size: 'sm', variant: 'quiet', onClick: () => setPendingPageSize(size => size + 20),
      }, '显示更多待处理') : null,
      pendingError ? h(Notice, { key: 'pending-error', tone: 'warn' }, pendingError) : null,
      ...pendingStages.map(stage => h('div', { key: stage, className: 'rk-compose-actions' }, [
        h('span', { key: 'label', style: { fontSize: 12 } }, `待确认阶段 · ${stage}`),
        h(Button, { key: 'approve', size: 'sm', variant: 'primary', disabled: runAction, onClick: () => approveStage(stage), 'aria-label': `确认阶段 ${stage}` }, '确认'),
      ])),
    ]) : null,
    !data ? h(Spinner, { key: 'loading', text: '正在读取课题进度……' }) : !hasActivity ? h('div', { key: 'quiet-status', className: 'rk-home-quiet-bar rk-content-swap' }, [
      h('span', { key: 'summary' }, '新课题已就绪，选一个常用入口开始：'),
      h('div', { key: 'links', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
        h(Button, { key: 'review-quick', size: 'sm', variant: 'soft', onClick: () => onNavigate('catalog', { workflowId: 'literature-review' }) }, '文献综述'),
        h(Button, { key: 'paper-quick', size: 'sm', variant: 'soft', onClick: () => onNavigate('catalog', { workflowId: 'review-paper' }) }, '审阅论文'),
        h(Button, { key: 'db', size: 'sm', variant: 'quiet', onClick: () => onNavigate('catalog', { type: 'database' }) }, '查来源'),
        h(Button, { key: 'ev', size: 'sm', variant: 'quiet', onClick: () => onNavigate('vault', { tab: 'evidence' }) }, '证据库'),
      ]),
    ]) : h('div', { key: 'content', className: 'rk-research-home-grid rk-content-swap' }, [
      h(Card, { key: 'progress', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'question' }, question ? `研究问题：${question}` : '研究进度'),
        h('span', { key: 'run', style: { fontSize: 13 } }, scopedRun ? `当前工作流：${scopedRun.workflowName || scopedRun.workflowId} · ${HOME_RUN_LABELS[scopedRun.status] || scopedRun.status}` : activeRunId ? `当前运行：${activeRunId}` : '尚未启动工作流'),
        overview?.current_stage && overview.current_stage !== 'unknown'
          ? h('span', { key: 'stage', style: { fontSize: 12, color: C.muted } }, `当前阶段：${overview.current_stage}`) : null,
        scopedRun && itemById(scopedRun.workflowId)?.requiresFiles ? h(Notice, { key: 'materials', tone: 'warn' }, '此流程需要材料，记得在会话中用 @文件 附上相关文献或数据。') : null,
      ]),
      h(Card, { key: 'inbox', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'title' }, '核验进度'),
        h('span', { key: 'counts', style: { fontSize: 13 } }, `待核验论断 ${pending} · 待核验证据 ${data.counts.unverified || 0}`),
        data.missing.size ? h(Notice, { key: 'missing', tone: 'warn' }, `${data.missing.size} 条关联证据在当前课题中缺失。`) : null,
        scopedClaims.some(claim => !claim.links?.length) ? h('span', { key: 'unlinked', style: { fontSize: 12, color: C.muted } },
          `${scopedClaims.filter(claim => !claim.links?.length).length} 条论断尚未关联证据`) : null,
      ]),
      h(Card, { key: 'outputs', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'title' }, `最近产出 · 已保存证据 ${data.counts.all}`),
        ...activityOutputs.slice(0, 3).map(item => h('span', { key: `tool-${item.id}`, style: { fontSize: 13 } }, item.summary || item.kind)),
        ...(outputs.length ? outputs.map(output => h('span', { key: output.id, style: { fontSize: 13 } }, `${output.title} · ${output.state === 'verified-execution' ? '执行已核验' : '草稿／执行待核对'}`)) : activityOutputs.length ? [] : [h('span', { key: 'empty', style: { fontSize: 12, color: C.muted } }, '暂无已登记产出。可在证据库记录图表、报告与复现信息。')]),
      ]),
    ]),
    h(ResearchDreamPanel, {
      key: JSON.stringify(['dream', context.project, sessionId]),
      project: context.project,
      sessionId,
      claims: data?.claims || [],
      onNavigate,
      inputActions,
    }),
  ])
}

/** 会话面板只显示这个会话已关联的课题及待审核信息。 */
export function ResearchSessionOverview({ sessionId = '' }) {
  const [context, setContext] = React.useState(currentResearchContext)
  const [summary, setSummary] = React.useState(null)
  React.useEffect(() => subscribeResearchContext(setContext), [])
  const run = sessionId && listResearchRuns({ project: context.project, sessionId })[0]
  const runId = run?.id
  const project = run?.project
  React.useEffect(() => {
    if (!runId) return undefined
    let alive = true
    synchronizeResearchClaims(evidenceVaultStore(), project)
      .then(({ claims }) => {
        if (alive) setSummary({ runId, pending: claims.filter(claim =>
          claim.run_id === runId && !['verified', 'rejected'].includes(claim.state)).length })
      })
      .catch(() => { if (alive) setSummary({ runId, pending: null }) })
    return () => { alive = false }
  }, [project, runId])
  if (!runId) return null
  return h('div', { style: { display: 'grid', gap: 4 } }, [
    h('strong', { key: 'project' }, project || '未命名项目'),
    h('span', { key: 'run' }, run.workflowName || run.workflowId),
    summary?.runId === runId ? h('span', { key: 'pending' },
      summary.pending === null ? '审核状态暂不可达' : `待审核论断 ${summary.pending}`) : null,
  ])
}

function ResearchMaterialReferenceForm({ insert }) {
  const [path, setPath] = React.useState('')
  const [feedback, setFeedback] = React.useState('')
  return h('form', {
    style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    onSubmit: event => {
      event.preventDefault()
      try { insert(path); setPath(''); setFeedback('已添加到会话草稿。') }
      catch (error) { setFeedback(error.message) }
    },
  }, [
    h(Input, { key: 'path', value: path, ariaLabel: '工作区文件路径', placeholder: '添加工作区文件引用，例：文献/论文.pdf', style: { flex: '1 1 220px', maxWidth: 360 },
      onChange: value => { setPath(value); setFeedback('') } }),
    h(Button, { key: 'insert', type: 'submit', size: 'sm', variant: 'soft', disabled: !path.trim() }, '添加材料引用'),
    feedback ? h('span', { key: 'feedback', role: 'status', className: 'rk-fade', style: { fontSize: 12, color: C.teal } }, feedback) : null,
  ])
}
