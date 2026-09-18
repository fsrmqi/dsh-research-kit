
import React from 'react'
import { h, C } from './theme.js'
import { Badge, Button, Notice } from './ui.js'
import { toolLabel, artifactKindLabel } from '../mcp/tool-registry.js'

const POLL_INTERVAL_MS = 5_000
const AGENT_ACTIVITY_PATH = '/dsh-research-kit/agent-activity'

function formatTime(iso) {
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  } catch { return '' }
}

function CallEntry({ call }) {
  const label = toolLabel(call.tool)
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
    call.artifact_kind ? h(Badge, { key: 'artifact', color: C.teal }, artifactKindLabel(call.artifact_kind)) : null,
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
  const [runOverview, setRunOverview] = React.useState(null)
  const [artifactFilter, setArtifactFilter] = React.useState('')
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
        setRunOverview(data.run_overview || null)
      }
    } catch { /* fetch error: keep last state */ }
  }, [runId])

  React.useEffect(() => {
    latestAt.current = null
    setCalls([])
    setCheckpoints([])
    setArtifacts([])
    setRunOverview(null)
    setArtifactFilter('')
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

  // 产物按 kind 筛选（ROADMAP P1-3）：kinds 来自实际产物投影，全部有效时显示「全部」。
  const artifactKinds = [...new Set(artifacts.map(item => item.kind))]
  const visibleArtifacts = artifactFilter ? artifacts.filter(item => item.kind === artifactFilter) : artifacts
  // 下一步建议直接来自 run_overview 聚合层推导，UI 不复刻业务规则。
  const stageProgress = runOverview?.stage_progress
  const overviewLine = runOverview
    ? `阶段 ${runOverview.current_stage} · ${runOverview.status === 'waiting_review' ? '待人工审批' : '进行中'}`
    : ''

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
      runOverview && h('div', { key: 'overview', style: { padding: '6px 0', borderBottom: `1px solid ${C.line}15` } }, [
        h('div', { key: 'line', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
          h('span', { key: 'stage', style: { fontSize: 12, fontWeight: 600 } }, overviewLine),
          stageProgress?.next_stage && h('span', { key: 'next', style: { fontSize: 11, color: C.muted } }, `下一阶段：${stageProgress.next_stage}`),
          runOverview.workflow_name && h('span', { key: 'wf', style: { fontSize: 11, color: C.muted } }, runOverview.workflow_name),
        ]),
        ...(stageProgress?.completed_stages?.length ? [h('div', { key: 'done', style: { fontSize: 11, color: C.muted, marginTop: 2 } }, `已放行阶段：${stageProgress.completed_stages.join('、')}`)] : []),
      ]),
      ...pendingCheckpoints.map(cp => h(CheckpointBanner, { key: `cp-${cp.run_id}`, cp, onApprove: approve, busy })),
      artifacts.length ? h('div', { key: 'artifacts', style: { margin: '4px 0 8px' } }, [
        artifactKinds.length > 1 && h('div', { key: 'filter', style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 } }, [
          h('button', {
            key: 'all', onClick: () => setArtifactFilter(''),
            style: { fontSize: 11, padding: '2px 8px', borderRadius: 10, border: `1px solid ${C.line}`, cursor: 'pointer', background: artifactFilter ? 'transparent' : C.amberTint, color: C.ink },
          }, '全部'),
          ...artifactKinds.map(kind => h('button', {
            key: kind, onClick: () => setArtifactFilter(kind),
            style: { fontSize: 11, padding: '2px 8px', borderRadius: 10, border: `1px solid ${C.line}`, cursor: 'pointer', background: artifactFilter === kind ? C.amberTint : 'transparent', color: C.ink },
          }, artifactKindLabel(kind))),
        ]),
        h('div', { key: 'list', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, visibleArtifacts.map(item =>
          h(Badge, { key: item.id, color: C.teal }, `${artifactKindLabel(item.kind)} · ${item.summary || '已生成'}`)
        )),
      ]) : null,
      calls.length === 0 && !error
        ? h('p', { key: 'empty', style: { margin: '6px 0', fontSize: 12, color: C.muted } }, runId ? '当前运行暂无带 run_id 的 MCP 调用记录。' : '暂无 Agent 调用记录。Agent 通过 MCP 调用工具后，调用轨迹会显示在这里。')
        : h('div', { key: 'calls', style: { maxHeight: 300, overflowY: 'auto' } },
            calls.map(call => h(CallEntry, { key: call.id, call }))
          ),
    ]),
  ])
}
