import React from 'react'
import { h, C } from './theme.js'
import { Button, Card, PageHead, Notice, Spinner } from './ui.js'
import { currentResearchContext, activeResearchRun, listResearchRuns, subscribeResearchContext } from './research-context-store.js'
import { itemById } from './catalog.js'
import { evidenceVaultStore, subscribeEvidenceVault, syncEvidenceVaultWithFiles } from './lib/evidence-vault-sync.js'
import { synchronizeResearchClaims } from './lib/claim-review-client.js'

const HOME_RUN_LABELS = { draft: '提示词草稿', active: '已发送到会话', waiting_review: '待人工审核', completed: '已完成', failed: '失败' }

export function ResearchProjectHome({ onNavigate, sessionId = '' }) {
  const [context, setContext] = React.useState(currentResearchContext)
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState('')
  const version = React.useRef(0)
  React.useEffect(() => subscribeResearchContext(setContext), [])
  const refresh = React.useCallback(async () => {
    const request = ++version.current
    const store = evidenceVaultStore()
    let syncError = ''
    try {
      await syncEvidenceVaultWithFiles(context.project || undefined).catch(failure => { syncError = `文件同步失败：${failure.message}` })
      const [counts, ledger, claims] = await Promise.all([
        store.evidenceSummary({ project: context.project || undefined }),
        store.listResearchLedger({ project: context.project || undefined }),
        synchronizeResearchClaims(store, context.project).then(result => result.claims)
          .catch(failure => { syncError += ` Claim 台账暂不可达：${failure.message}`; return store.listResearchClaims({ project: context.project }) }),
      ])
      let activity = null
      if (context.activeRunId) {
        const params = new URLSearchParams({ run_id: context.activeRunId, limit: '1' })
        try {
          const response = await fetch(`/dsh-research-kit/agent-activity?${params}`, { signal: AbortSignal.timeout(5000) })
          activity = await response.json()
          if (!response.ok || !activity.ok) throw new Error(activity.error || `HTTP ${response.status}`)
        } catch (failure) { syncError += ` 运行状态暂不可达：${failure.message}`; activity = null }
      }
      if (request !== version.current) return
      setData({ counts, ledger, claims, activity }); setError(syncError)
    } catch (failure) { if (request === version.current) setError(`读取失败，保留上次数据：${failure.message}`) }
  }, [context.project, context.activeRunId])
  React.useEffect(() => { refresh(); const dispose = subscribeEvidenceVault(refresh); return () => { version.current++; dispose() } }, [refresh])
  const run = activeResearchRun()
  const scopedRun = run?.project === context.project ? run : null
  const recentRun = listResearchRuns({ project: context.project, sessionId })[0]
  const pending = data?.claims.filter(claim => !['verified', 'rejected'].includes(claim.state)).length || 0
  const question = data?.claims.find(claim => claim.question)?.question
  const checkpoints = data?.activity?.checkpoints || []
  const pendingCheckpointCount = checkpoints.reduce((count, cp) => count + Object.values(cp.checkpoints || {}).filter(value => !value.approved).length, 0)
  const actions = data?.activity?.run_overview?.next_actions || []
  const outputs = data?.ledger.filter(event => event.kind === 'artifact').slice(0, 3) || []
  return h('div', { className: 'rk-page', style: { padding: '20px var(--rk-gutter) 48px' } }, [
    h(PageHead, { key: 'head', title: '项目首页', lead: `当前项目：${context.project || '未命名项目'}。从任务开始，随时查看材料、证据与待办。`, actions: [h(Button, { key: 'refresh', size: 'sm', variant: 'ghost', onClick: refresh }, '刷新项目状态')] }),
    error ? h(Notice, { key: 'error', tone: 'warn' }, `${error}。可刷新重试；离线数据不代表最新审核状态。`) : null,
    h(Card, { key: 'tasks', style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 } }, [
      h(Button, { key: 'review', variant: 'primary', onClick: () => onNavigate('catalog', { workflowId: 'literature-review' }) }, '做文献综述'),
      h(Button, { key: 'paper', onClick: () => onNavigate('catalog', { workflowId: 'review-paper' }) }, '审阅论文'),
      h(Button, { key: 'claims', onClick: () => onNavigate('vault', { tab: 'claims' }) }, '验证研究结论'),
      h(Button, { key: 'continue', disabled: !recentRun?.workflowId, onClick: () => onNavigate('catalog', { workflowId: recentRun?.workflowId }) }, '继续上次工作流'),
    ]),
    !data ? h(Spinner, { key: 'loading', text: '正在读取项目进度……' }) : h('div', { key: 'content', style: { display: 'grid', gap: 12 } }, [
      h(Card, { key: 'progress', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'question' }, question ? `研究问题：${question}` : '研究问题尚未登记'),
        h('span', { key: 'run' }, scopedRun ? `当前工作流：${scopedRun.workflowName || scopedRun.workflowId} · ${HOME_RUN_LABELS[scopedRun.status] || scopedRun.status}` : context.activeRunId ? `当前运行：${context.activeRunId}` : '还没有启动研究工作流'),
        scopedRun && itemById(scopedRun.workflowId)?.requiresFiles ? h(Notice, { key: 'materials', tone: 'warn' }, '此工作流需要材料：请核对当前会话的 @文件 引用。') : null,
        h('small', { key: 'boundary', style: { color: C.muted } }, '写入或发送提示词仅记录操作事实；实际执行与完成状态以运行记录和人工审批为准。'),
      ]),
      h(Card, { key: 'inbox', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'title' }, '待办收件箱'),
        h('span', { key: 'counts' }, `待核验 Claim ${pending} · 未核验证据 ${data.counts.unverified || 0} · 待确认阶段 ${pendingCheckpointCount}`),
        h('div', { key: 'buttons', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
          h(Button, { key: 'review', size: 'sm', onClick: () => onNavigate('vault', { tab: 'claims' }) }, '处理 Claim'),
          h(Button, { key: 'evidence', size: 'sm', onClick: () => onNavigate('vault', { tab: 'evidence' }) }, '打开证据与筛选队列'),
        ]),
        ...actions.slice(0, 5).map((action, index) => h('p', { key: index, style: { margin: 0, fontSize: 12, color: C.muted } }, typeof action === 'string' ? action : action.message || action.reason || action.action || '查看运行活动中的下一步')),
        pendingCheckpointCount ? h('small', { key: 'checkpoints' }, '展开页面底部的运行活动，逐阶段检查并确认。') : null,
      ]),
      h(Card, { key: 'outputs', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'title' }, `最近产出 · 已保存证据 ${data.counts.all}`),
        ...(outputs.length ? outputs.map(output => h('span', { key: output.id }, `${output.title} · ${output.state === 'verified-execution' ? '执行已核验' : '草稿／执行待核对'}`)) : [h('span', { key: 'empty', style: { color: C.muted } }, '暂无已登记产出。可在证据库记录图表、报告与复现信息。')]),
      ]),
    ]),
  ])
}
