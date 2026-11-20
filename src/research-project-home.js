import React from 'react'
import { h, C } from './theme.js'
import { Button, Card, PageHead, Notice, Spinner } from './ui.js'
import { currentResearchContext, activeResearchRun, listResearchRuns, resumeResearchRun, subscribeResearchContext } from './research-context-store.js'
import { supportsSafeInsert } from './lib/input-actions.js'
import { itemById } from './catalog.js'
import { evidenceVaultStore, subscribeEvidenceVault, syncEvidenceVaultWithFiles } from './lib/evidence-vault-sync.js'
import { synchronizeResearchClaims } from './lib/claim-review-client.js'

const HOME_RUN_LABELS = { draft: '提示词草稿', active: '已发送到会话', waiting_review: '待人工审核', completed: '已完成', failed: '失败' }

export function ResearchProjectHome({ onNavigate, insertMaterialReference, inputActions }) {
  const [context, setContext] = React.useState(currentResearchContext)
  const [loaded, setData] = React.useState(null)
  const [error, setError] = React.useState('')
  const [draftFeedback, setDraftFeedback] = React.useState('')
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
  const checkpoints = data?.activity?.checkpoints || []
  const pendingCheckpointCount = checkpoints.reduce((count, cp) => count + Object.values(cp.checkpoints || {}).filter(value => !value.approved).length, 0)
  const overview = data?.activity?.run_overview
  const outputs = (data?.ledger || []).filter(event => event.kind === 'artifact' && (!activeRunId || event.runId === activeRunId)).slice(0, 3)
  const activityOutputs = data?.activity?.artifacts || []
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
  return h('div', { className: 'rk-page', style: { padding: '20px var(--rk-gutter) 48px' } }, [
    h(PageHead, { key: 'head', title: '项目首页', lead: `当前项目：${context.project || '未命名项目'}。从任务开始，随时查看材料、证据与待办。`, actions: [h(Button, { key: 'refresh', size: 'sm', variant: 'ghost', onClick: refresh }, '刷新项目状态')] }),
    error ? h(Notice, { key: 'error', tone: 'warn' }, `${error}。可刷新重试；离线数据不代表最新审核状态。`) : null,
    h(Card, { key: 'tasks', style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 } }, [
      h(Button, { key: 'review', variant: 'primary', onClick: () => onNavigate('catalog', { workflowId: 'literature-review' }) }, '做文献综述'),
      h(Button, { key: 'paper', onClick: () => onNavigate('catalog', { workflowId: 'review-paper' }) }, '审阅论文'),
      h(Button, { key: 'claims', onClick: () => onNavigate('vault', { tab: 'claims' }) }, '验证研究结论'),
      h(Button, { key: 'continue', disabled: !recentRun, onClick: () => restore(recentRun.id) }, '继续上次工作流'),
      activeRunId && supportsSafeInsert(inputActions) ? h(Button, { key: 'continue-draft', onClick: prepareContinuation }, '写入继续研究草稿') : null,
      draftFeedback ? h('span', { key: 'draft-feedback', role: 'status' }, draftFeedback) : null,
    ]),
    insertMaterialReference ? h(ResearchMaterialReferenceForm, { key: 'materials', insert: insertMaterialReference }) : null,
    projectRuns.length > 1 ? h('label', { key: 'run-picker', style: { display: 'block', marginBottom: 12 } }, [
      '恢复指定运行 ',
      h('select', { key: 'select', value: activeRunId, onChange: event => restore(event.target.value), 'aria-label': '恢复指定运行' }, [
        h('option', { key: 'none', value: '', disabled: true }, '选择运行'),
        ...projectRuns.map(item => h('option', { key: item.id, value: item.id },
          `${item.workflowName || item.workflowId || '研究运行'} · ${new Date(item.createdAt || 0).toLocaleString()} · ${item.id}`)),
      ]),
    ]) : null,
    !data ? h(Spinner, { key: 'loading', text: '正在读取项目进度……' }) : h('div', { key: 'content', style: { display: 'grid', gap: 12 } }, [
      h(Card, { key: 'progress', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'question' }, question ? `研究问题：${question}` : '研究问题尚未登记'),
        h('span', { key: 'run' }, scopedRun ? `当前工作流：${scopedRun.workflowName || scopedRun.workflowId} · ${HOME_RUN_LABELS[scopedRun.status] || scopedRun.status}` : activeRunId ? `当前运行：${activeRunId}` : '还没有启动研究工作流'),
        overview?.current_stage && overview.current_stage !== 'unknown'
          ? h('span', { key: 'stage' }, `当前阶段：${overview.current_stage}`) : null,
        scopedRun && itemById(scopedRun.workflowId)?.requiresFiles ? h(Notice, { key: 'materials', tone: 'warn' }, '此工作流需要材料：请核对当前会话的 @文件 引用。') : null,
        h('small', { key: 'boundary', style: { color: C.muted } }, '写入或发送提示词仅记录操作事实；实际执行与完成状态以运行记录和人工审批为准。'),
      ]),
      h(Card, { key: 'inbox', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'title' }, '待办收件箱'),
        h('span', { key: 'counts' }, `待核验 Claim ${pending} · 项目未核验证据 ${data.counts.unverified || 0} · 待确认阶段 ${pendingCheckpointCount}`),
        h('div', { key: 'buttons', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
          h(Button, { key: 'review', size: 'sm', onClick: () => onNavigate('vault', { tab: 'claims' }) }, '处理 Claim'),
          h(Button, { key: 'evidence', size: 'sm', onClick: () => onNavigate('vault', { tab: 'evidence' }) }, '打开证据与筛选队列'),
        ]),
        data.missing.size ? h(Notice, { key: 'missing', tone: 'warn' }, `${data.missing.size} 条已关联证据在当前项目中缺失。`) : null,
        scopedClaims.some(claim => !claim.links?.length) ? h('span', { key: 'unlinked' },
          `${scopedClaims.filter(claim => !claim.links?.length).length} 条论断尚未关联证据`) : null,
        pendingCheckpointCount ? h('small', { key: 'checkpoints' }, '展开页面底部的运行活动，逐阶段检查并确认。') : null,
      ]),
      h(Card, { key: 'outputs', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'title' }, `最近产出 · 已保存证据 ${data.counts.all}`),
        ...activityOutputs.slice(0, 3).map(item => h('span', { key: `tool-${item.id}` }, item.summary || item.kind)),
        ...(outputs.length ? outputs.map(output => h('span', { key: output.id }, `${output.title} · ${output.state === 'verified-execution' ? '执行已核验' : '草稿／执行待核对'}`)) : activityOutputs.length ? [] : [h('span', { key: 'empty', style: { color: C.muted } }, '暂无已登记产出。可在证据库记录图表、报告与复现信息。')]),
      ]),
    ]),
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
