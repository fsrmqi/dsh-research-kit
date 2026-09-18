
import React from 'react'
import { h, C } from './theme.js'
import { Badge, Button, Notice } from './ui.js'

const POLL_INTERVAL_MS = 5_000
const AGENT_ACTIVITY_PATH = '/dsh-research-kit/agent-activity'

const TOOL_LABELS = {
  research_catalog_search: '搜索工作流',
  research_workflow_compose: '组装工作流',
  research_source_query: '查询数据源',
  research_citation_verify: '验证引用',
  research_evidence_save: '保存证据',
  research_evidence_list: '检索证据',
  research_evidence_grade: '证据分级',
  research_run_start: '启动研究运行',
  research_run_export: '导出护照',
  research_run_import: '导入护照',
  research_evidence_link: '关联证据',
  research_figure_generate: '生成图表',
  research_figure_list_styles: '图表风格列表',
  research_run_checkpoint_status: '检查点状态',
  research_run_checkpoint_approve: '审批检查点',
  research_review_output: '综合审阅输出',
  research_review_claims: '声明引用审计',
  research_literature_link: '文献互引分析',
  research_review_anomalies: '文本异常检测',
  research_review_writing: '写作质量检查',
  research_review_hedging: '限制语检查',
  research_disclosure_generate: '生成 AI 披露',
  research_disclosure_list_policies: '披露政策列表',
  research_metadata_openalex_fetch: '获取 OpenAlex 元数据',
}

const ARTIFACT_LABELS = { figure: '图表脚本', 'review-report': '综合审阅', 'claim-audit': '声明审计', 'anomaly-report': '异常报告', 'quality-report': '质量报告' }

function formatTime(iso) {
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  } catch { return '' }
}

function CallEntry({ call }) {
  const label = TOOL_LABELS[call.tool] || call.tool
  const isError = call.ok === false
  return h('div', {
    key: call.id,
    style: {
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '6px 0', borderBottom: `1px solid ${C.line}15`,
    },
  }, [
    h('span', { key: 'time', style: { color: C.muted, fontSize: 11, minWidth: 56, flexShrink: 0 } }, formatTime(call.at)),
    h('span', { key: 'tool', style: { fontSize: 12, fontWeight: 500, minWidth: 80, flexShrink: 0 } }, label),
    h('span', {
      key: 'detail',
      style: { fontSize: 11, color: isError ? '#E74C3C' : C.muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    }, isError ? call.error || '调用失败' : call.result_summary || ''),
    call.artifact_kind ? h(Badge, { key: 'artifact', color: C.teal }, ARTIFACT_LABELS[call.artifact_kind] || '运行产物') : null,
    h('span', {
      key: 'duration',
      style: { fontSize: 10, color: C.muted, flexShrink: 0, opacity: 0.7 },
    }, call.duration_ms != null ? `${call.duration_ms}ms` : ''),
  ])
}

function CheckpointBanner({ cp, onApprove, busy }) {
  const pendingStages = Object.entries(cp.checkpoints || {}).filter(([, v]) => !v.approved)
  if (!pendingStages.length) return null
  return h('div', {
    key: `cp-${cp.run_id}`,
    style: {
      padding: '8px 12px', margin: '6px 0',
      border: `1px solid ${C.amberLine}`,
      borderRadius: 8,
      background: C.amberTint,
    },
  }, [
    h('div', { key: 'header', style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } }, [
      h('span', { key: 'icon', style: { fontSize: 14 } }, '⏸'),
      h('span', { key: 'label', style: { fontSize: 12, fontWeight: 600 } }, `Checkpoint: ${cp.run_id}`),
    ]),
    ...pendingStages.map(([stage, info]) =>
      h('div', { key: stage, style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 } }, [
        h('span', { key: 'stage', style: { fontSize: 12, color: C.muted } }, stage),
          h(Button, {
          key: 'btn', variant: 'solid', size: 'sm', disabled: busy,
          onClick: () => onApprove(cp.run_id, stage),
          style: { fontSize: 11, padding: '3px 10px' },
        }, '继续'),
      ])
    ),
  ])
}

export function AgentActivityPanel({ sessionId, runId = '' }) {
  const [expanded, setExpanded] = React.useState(false)
  const [calls, setCalls] = React.useState([])
  const [checkpoints, setCheckpoints] = React.useState([])
  const [artifacts, setArtifacts] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)
  const latestAt = React.useRef(null)

  const fetchActivity = React.useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (latestAt.current) params.set('since', latestAt.current)
      if (runId) params.set('run_id', runId)
      const res = await fetch(`${AGENT_ACTIVITY_PATH}?${params}`)
      if (!res.ok) { setError(`HTTP ${res.status}`); return }
      const data = await res.json()
      if (data.ok) {
        setError(null)
        if (data.calls.length) {
          latestAt.current = data.calls[0].at
          setCalls(prev => [...data.calls, ...prev].slice(0, 100))
        }
        setCheckpoints(data.checkpoints || [])
        setArtifacts(data.artifacts || [])
      }
    } catch { /* fetch error: keep last state */ }
  }, [runId])

  React.useEffect(() => {
    latestAt.current = null
    setCalls([])
    setCheckpoints([])
    setArtifacts([])
  }, [runId])

  React.useEffect(() => {
    if (!expanded || typeof document === 'undefined' || document.visibilityState === 'hidden') return undefined
    fetchActivity()
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') fetchActivity()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [expanded, fetchActivity])

  const approve = React.useCallback(async (runId, stage) => {
    setBusy(true)
    try {
      const res = await fetch(AGENT_ACTIVITY_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'research_run_checkpoint_approve', run_id: runId, stage }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await fetchActivity()
    } catch { /* approve failure: retry next poll */ }
    setBusy(false)
  }, [fetchActivity])

  const pendingCheckpoints = checkpoints.filter(cp =>
    Object.values(cp.checkpoints || {}).some(v => !v.approved)
  )

  return h('div', {
    style: {
      margin: '0 var(--rk-gutter) 8px',
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      background: C.surface,
      overflow: 'hidden',
    },
  }, [
    h('div', {
      key: 'header',
      onClick: () => setExpanded(e => !e),
      style: {
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', cursor: 'pointer', userSelect: 'none',
      },
    }, [
      h('span', { key: 'chevron', style: { fontSize: 11, color: C.muted, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' } }, '▸'),
      h('span', { key: 'title', style: { fontSize: 13, fontWeight: 600 } }, runId ? '当前研究运行活动' : 'Agent 活动'),
      pendingCheckpoints.length > 0 && h(Badge, { key: 'cp-badge', color: '#F39C12' }, `${pendingCheckpoints.length} 待确认`),
      calls.length > 0 && h('span', { key: 'count', style: { marginLeft: 'auto', fontSize: 11, color: C.muted } }, `${calls.length} 条记录`),
    ]),
    expanded && h('div', { key: 'body', style: { padding: '0 14px 10px' } }, [
      error && h(Notice, { key: 'err', tone: 'warn', icon: 'shield' }, `无法获取 Agent 活动数据：${error}`),
      ...pendingCheckpoints.map(cp => h(CheckpointBanner, { key: `cp-${cp.run_id}`, cp, onApprove: approve, busy })),
      artifacts.length ? h('div', { key: 'artifacts', style: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 8px' } }, artifacts.map(item =>
        h(Badge, { key: item.id, color: C.teal }, `${ARTIFACT_LABELS[item.kind] || '运行产物'} · ${item.summary || '已生成'}`)
      )) : null,
      calls.length === 0 && !error
        ? h('p', { key: 'empty', style: { margin: '6px 0', fontSize: 12, color: C.muted } }, runId ? '当前运行暂无带 run_id 的 MCP 调用记录。' : '暂无 Agent 调用记录。Agent 通过 MCP 调用工具后，调用轨迹会显示在这里。')
        : h('div', { key: 'calls', style: { maxHeight: 300, overflowY: 'auto' } },
            calls.map(call => h(CallEntry, { key: call.id, call }))
          ),
    ]),
  ])
}
