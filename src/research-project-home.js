import React from 'react'
import { h, C } from './theme.js'
import { Button, Card, IconButton, Notice, Spinner, Input, Icon } from './ui.js'
import { currentResearchContext, activeResearchRun, listResearchRuns, resumeResearchRun, setResearchContext, setResearchProject, subscribeResearchContext } from './research-context-store.js'
import { supportsSafeInsert } from './lib/input-actions.js'
import { itemById } from './catalog.js'
import { evidenceVaultStore, subscribeEvidenceVault, syncEvidenceVaultWithFiles } from './lib/evidence-vault-sync.js'
import { synchronizeResearchClaims } from './lib/claim-review-client.js'
import { ResearchDreamPanel } from './research-dream-panel.js'

const HOME_RUN_LABELS = { draft: '提示词草稿', active: '已发送到会话', waiting_review: '待人工审核', completed: '已完成', failed: '失败' }

export function ResearchProjectHome({ sessionId = '', onNavigate, insertMaterialReference, inputActions }) {
  const [context, setContext] = React.useState(currentResearchContext)
  const [loaded, setData] = React.useState(null)
  const [error, setError] = React.useState('')
  const [draftFeedback, setDraftFeedback] = React.useState('')
  const [projectEditor, setProjectEditor] = React.useState(null)
  const [externalRunId, setExternalRunId] = React.useState('')
  const [runAction, setRunAction] = React.useState(false)
  const [runFeedback, setRunFeedback] = React.useState('')
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
      const [counts, ledger, claims] = await Promise.all([
        store.evidenceSummary({ project: context.project }),
        store.listResearchLedger({ project: context.project }),
        synchronizeResearchClaims(store, context.project).then(result => result.claims)
          .catch(failure => { syncError += ` Claim 台账暂不可达：${failure.message}`; return store.listResearchClaims({ project: context.project }) }),
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
      setData({ counts, ledger, claims, activity, missing, project: context.project, runId: activeRunId }); setError(syncError)
    } catch (failure) { if (request === version.current) setError(`读取失败，保留上次数据：${failure.message}`) }
  }, [context.project, activeRunId])
  React.useEffect(() => { refresh(); const dispose = subscribeEvidenceVault(refresh); return () => { version.current++; dispose() } }, [refresh])
  const data = loaded?.project === context.project && loaded?.runId === activeRunId ? loaded : null
  const projectRuns = listResearchRuns({ project: context.project }).sort((a, b) => b.createdAt - a.createdAt)
  const recentRun = projectRuns[0]
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
  const prepareContinuation = () => {
    const prompt = [
      `继续科研运行 ${activeRunId}，研究项目：${context.project || 'default'}。`,
      '先用 research_run_status 查看进度，再用 research_context_pack 读取现有论断、证据和回执。后续记录沿用这个 run_id。',
      scopedRun?.workflowId
        ? `若没有状态护照，核对材料后用 research_run_start，以工作流 ${scopedRun.workflowId} 和原 run_id 初始化。`
        : '请保留待人工核验项和检查点。',
    ].join('\n')
    try {
      const ok = inputActions.insertText(prompt, inputActions.captureInsertion()) === true
      setDraftFeedback(ok ? '已插入继续研究草稿。' : '草稿暂不可写入，请切回会话后重试。')
    } catch (error) { setDraftFeedback(error.message) }
  }
  const hasActivity = Boolean(
    activeRunId || scopedRun || question || pending > 0 || (data?.counts?.all || 0) > 0
    || outputs.length || activityOutputs.length || pendingStages.length || (data?.missing?.size || 0) > 0,
  )
  const launchItems = [
    { key: 'review', label: '做文献综述', desc: '按问题检索、筛选来源并生成综述草案', icon: 'layers', primary: true, onClick: () => onNavigate('catalog', { workflowId: 'literature-review' }) },
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
        h(IconButton, { key: 'refresh', name: 'refresh', size: 14, label: '刷新项目状态', onClick: refresh }),
      ]),
    ]),
    projectEditor !== null ? h(Card, { key: 'project-panel', style: { display: 'grid', gap: 8 } }, [
      h('form', { key: 'project', className: 'rk-compose-actions', onSubmit: event => {
        event.preventDefault()
        setResearchProject(projectEditor)
        setProjectEditor(null)
      } }, [
        h(Input, { key: 'name', value: projectEditor, onChange: setProjectEditor, ariaLabel: '研究课题名称', placeholder: '留空使用默认课题', maxLength: 100, style: { width: 'min(260px, 100%)' } }),
        h(Button, { key: 'save', type: 'submit', size: 'sm', variant: 'primary' }, '切换课题'),
      ]),
      h('small', { key: 'hint', style: { color: C.muted } }, '按课题查看已保存的资料、证据与论断。'),
      h('details', { key: 'run' }, [
        h('summary', { key: 'label', style: { cursor: 'pointer', color: C.muted, fontSize: 12 } }, '载入已有研究运行'),
        h('form', { key: 'form', className: 'rk-compose-actions', style: { marginTop: 8 }, onSubmit: bindRun }, [
          h(Input, { key: 'id', value: externalRunId, onChange: setExternalRunId, ariaLabel: '研究运行 ID', placeholder: '填写运行 ID', maxLength: 120, style: { width: 'min(260px, 100%)' } }),
          h(Button, { key: 'bind', type: 'submit', size: 'sm', disabled: runAction || !externalRunId.trim() }, '载入运行'),
        ]),
      ]),
    ]) : null,
    runFeedback ? h(Notice, { key: 'run-feedback', tone: 'warn' }, runFeedback) : null,
    error ? h(Notice, { key: 'error', tone: 'warn' }, `${error}。可刷新重试；离线数据不代表最新审核状态。`) : null,
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
    (recentRun || (activeRunId && supportsSafeInsert(inputActions)) || draftFeedback) ? h('div', { key: 'resume-bar', className: 'rk-home-quiet-bar' }, [
      h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        recentRun ? h(Button, { key: 'continue', size: 'sm', variant: 'soft', icon: 'history', onClick: () => restore(recentRun.id) }, '继续上次工作流') : null,
        activeRunId && supportsSafeInsert(inputActions) ? h(Button, { key: 'continue-draft', size: 'sm', variant: 'ghost', onClick: prepareContinuation }, '写入继续研究草稿') : null,
        draftFeedback ? h('span', { key: 'draft-feedback', role: 'status', style: { color: C.teal } }, draftFeedback) : null,
      ]),
      projectRuns.length > 1 ? h('label', { key: 'run-picker', style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, [
        '恢复指定运行',
        h('select', { key: 'select', value: activeRunId, onChange: event => restore(event.target.value), 'aria-label': '恢复指定运行' }, [
          h('option', { key: 'none', value: '', disabled: true }, '选择运行'),
          ...projectRuns.map(item => h('option', { key: item.id, value: item.id },
            `${item.workflowName || item.workflowId || '研究运行'} · ${new Date(item.createdAt || 0).toLocaleString()} · ${item.id}`)),
        ]),
      ]) : null,
    ]) : null,
    insertMaterialReference ? h(ResearchMaterialReferenceForm, { key: 'materials', insert: insertMaterialReference }) : null,
    !data ? h(Spinner, { key: 'loading', text: '正在读取课题进度……' }) : !hasActivity ? h('div', { key: 'quiet-status', className: 'rk-home-quiet-bar' }, [
      h('span', { key: 'summary' }, '当前课题暂无进行中的任务 · 证据 0 · 论断 0'),
      h('div', { key: 'links', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
        h(Button, { key: 'db', size: 'sm', variant: 'quiet', onClick: () => onNavigate('catalog', { type: 'database' }) }, '查来源'),
        h(Button, { key: 'ev', size: 'sm', variant: 'quiet', onClick: () => onNavigate('vault', { tab: 'evidence' }) }, '打开证据与筛选队列'),
      ]),
    ]) : h('div', { key: 'content', className: 'rk-research-home-grid' }, [
      h(Card, { key: 'progress', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'question' }, question ? `研究问题：${question}` : '研究进度'),
        h('span', { key: 'run', style: { fontSize: 13 } }, scopedRun ? `当前工作流：${scopedRun.workflowName || scopedRun.workflowId} · ${HOME_RUN_LABELS[scopedRun.status] || scopedRun.status}` : activeRunId ? `当前运行：${activeRunId}` : '尚未启动工作流'),
        overview?.current_stage && overview.current_stage !== 'unknown'
          ? h('span', { key: 'stage', style: { fontSize: 12, color: C.muted } }, `当前阶段：${overview.current_stage}`) : null,
        scopedRun && itemById(scopedRun.workflowId)?.requiresFiles ? h(Notice, { key: 'materials', tone: 'warn' }, '此工作流需要材料：请核对当前会话的 @文件 引用。') : null,
        scopedRun ? h('small', { key: 'boundary', style: { color: C.muted } }, '执行情况见运行记录和人工审批。') : null,
      ]),
      h(Card, { key: 'inbox', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'title' }, '待办收件箱'),
        h('span', { key: 'counts', style: { fontSize: 13 } }, `待核验论断 ${pending} · 课题待核验证据 ${data.counts.unverified || 0}`),
        h('div', { key: 'buttons', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
          h(Button, { key: 'review', size: 'sm', variant: 'soft', onClick: () => onNavigate('vault', { tab: 'claims' }) }, '审阅论断'),
          h(Button, { key: 'evidence', size: 'sm', variant: 'ghost', onClick: () => onNavigate('vault', { tab: 'evidence' }) }, '打开证据与筛选队列'),
        ]),
        data.missing.size ? h(Notice, { key: 'missing', tone: 'warn' }, `${data.missing.size} 条已关联证据在当前项目中缺失。`) : null,
        scopedClaims.some(claim => !claim.links?.length) ? h('span', { key: 'unlinked', style: { fontSize: 12, color: C.muted } },
          `${scopedClaims.filter(claim => !claim.links?.length).length} 条论断尚未关联证据`) : null,
        ...pendingStages.map(stage => h('div', { key: stage, className: 'rk-compose-actions' }, [
          h('span', { key: 'label', style: { fontSize: 12 } }, `待确认阶段 · ${stage}`),
          h(Button, { key: 'approve', size: 'sm', variant: 'primary', disabled: runAction, onClick: () => approveStage(stage), 'aria-label': `确认阶段 ${stage}` }, '确认'),
        ])),
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
    style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
    onSubmit: event => {
      event.preventDefault()
      try { insert(path); setPath(''); setFeedback('已添加到会话草稿。') }
      catch (error) { setFeedback(error.message) }
    },
  }, [
    h('input', { key: 'path', value: path, 'aria-label': '工作区文件路径', placeholder: '工作区相对文件路径',
      onChange: event => { setPath(event.target.value); setFeedback('') } }),
    h('button', { key: 'insert', type: 'submit', disabled: !path.trim() }, '添加材料引用'),
    feedback ? h('span', { key: 'feedback', role: 'status' }, feedback) : null,
  ])
}
