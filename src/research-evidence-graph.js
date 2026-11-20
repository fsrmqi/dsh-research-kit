import React from 'react'
import { h, C } from './theme.js'
import {
  Page, PageHead, Toolbar, Button, Card, EmptyState, Modal, Notice, Segmented, Badge, Select, Textarea,
} from './ui.js'
import {
  buildEvidenceGraph, EVIDENCE_NODE_COLORS, splitEvidenceGraphByConnectivity, summarizeEvidenceProjects,
  layoutEvidenceGraph, routeEvidenceEdges, evidenceNeighborhood, findEvidencePath,
  encodeGraphView, decodeGraphView, clampGraphScale,
  GRAPH_NODE_WIDTH, GRAPH_NODE_HEIGHT, GRAPH_SCALE_RANGE
} from './lib/evidence-graph-core.js'
import { createResearchSelectionStore } from './research-selection-store.js'
import { createEvidenceStore } from './evidence-store.js'
import { catalog, itemById } from './catalog.js'
import {
  evidenceVaultStore, subscribeEvidenceVault, getActiveProject, listAssetEvidenceLinks, syncEvidenceVaultWithFiles, removeEvidenceEntryFromFile,
  clearEvidenceEntriesFromFile, publishEvidenceVault,
} from './lib/evidence-vault-sync.js'
import { selectTestProjects } from './lib/test-projects.js'
import { synchronizeClaimScopes } from './lib/claim-review-client.js'
import {
  knowledgeStore, subscribeKnowledge, publishKnowledge, KNOWLEDGE_NODE_ID_PREFIX,
  serializeKnowledgeBackup, parseKnowledgeBackup,
} from './knowledge-store.js'
import { isAutoDepositEnabled, setAutoDepositEnabled, onAutoDepositChange, lastDepositionSummary, depositLatestAssistantMessage } from './knowledge-deposition.js'
import {
  KNOWLEDGE_KIND_LABELS, KNOWLEDGE_ENTITY_LABELS, KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS,
  KNOWLEDGE_POLARITY_LABELS, CLAIM_RELATION_LABELS,
} from './lib/knowledge-extract.js'
import { downloadBlob, downloadText, downloadJsonFile } from './lib/download.js'

const GRAPH_VIEW_MODES = [
  { value: 'all', label: '全部' },
  { value: 'upstream', label: '上游' },
  { value: 'downstream', label: '下游' },
  { value: 'path', label: '两点路径' }
]

const GRAPH_KIND_LABELS = {
  database: '数据库', skill: '技能', workflow: '工作流', query: '查询', 'agent-query': 'Agent 查询',
  source: '候选来源', plan: '计划', stage: '阶段', asset: '灵感资产', evidence: '已保存证据',
  message: '来源消息', question: '研究问题', entity: '实体', finding: '研究发现', hypothesis: '假设', method: '方法',
}
const GRAPH_LEGEND_ORDER = ['message', 'question', 'entity', 'finding', 'hypothesis', 'method', 'database', 'skill', 'workflow', 'query', 'source', 'plan', 'stage', 'asset', 'evidence']
const IDENTIFIER_KIND_LABELS = { doi: 'DOI', pmid: 'PMID', pmcid: 'PMCID', arxiv: 'arXiv', nct: 'NCT', accession: '编号', none: '无标识符' }
const KNOWLEDGE_STATUS_OPTIONS = KNOWLEDGE_STATUSES.map(status => ({ value: status, label: KNOWLEDGE_STATUS_LABELS[status] }))
const GRAPH_SCOPE_MODES = [
  { value: 'all', label: '全部' },
  { value: 'session', label: '本会话' },
  { value: 'persistent', label: '持久沉淀' },
]

const GRAPH_EXPORT_SCOPE = '仅含图上已显示的节点标题、来源库、稳定标识符、核验状态与关系；不含笔记、全文、检索词、附件或输入框草稿。'
const GRAPH_FRAME_HEIGHT = 520
const GRAPH_RENDER_NODE_LIMIT = 300

function graphKindColor(kind) { return EVIDENCE_NODE_COLORS[kind] || C.lineStrong }

const GRADE_NODE_COLORS = { empirical: '#27AE60', inference: '#F39C12', missing: '#E74C3C' }
const GRADE_STROKE_DASH = { inference: '4,2', missing: '2,2' }

function nodeStrokeColor(node) {
  if (node.kind === 'evidence' && node.grade && GRADE_NODE_COLORS[node.grade]) return GRADE_NODE_COLORS[node.grade]
  return graphKindColor(node.kind)
}

function nodeStrokeDash(node) {
  if (node.kind === 'evidence' && node.grade && GRADE_STROKE_DASH[node.grade]) return GRADE_STROKE_DASH[node.grade]
  return null
}

function graphEscape(value) {
  return String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
}

function graphLabel(value, max = 18) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// 导出到独立文件后 CSS 变量不再有定义，必须先把当前主题解析成真实色值，
// 否则导出物里的 fill="var(--rk-surface)" 会退化成黑块。
function readGraphTheme() {
  const fallback = { surface: '#ffffff', ink: '#17212b', line: '#b6c6d1', canvas: '#f4f7f9' }
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const style = getComputedStyle(document.documentElement)
  const read = (name, backup) => (style.getPropertyValue(name) || '').trim() || backup
  return {
    surface: read('--rk-surface', fallback.surface),
    ink: read('--rk-ink', fallback.ink),
    line: read('--rk-line-strong', fallback.line),
    canvas: read('--rk-canvas', fallback.canvas)
  }
}

function buildGraphSvgMarkup(layout, routes, theme) {
  const edges = routes.map(route => `<path d="${route.d}" fill="none" stroke="${theme.line}" stroke-width="1.5" marker-end="url(#rk-arrow)"/>`).join('\n  ')
  const nodes = layout.nodes.map(node => {
    const color = nodeStrokeColor(node)
    const dash = nodeStrokeDash(node)
    const agentBadge = node.agentProduced ? `<circle cx="${GRAPH_NODE_WIDTH - 12}" cy="10" r="4" fill="#3498DB"/>` : ''
    return `<g transform="translate(${node.x - GRAPH_NODE_WIDTH / 2},${node.y})">`
      + `<rect width="${GRAPH_NODE_WIDTH}" height="${GRAPH_NODE_HEIGHT}" rx="9" fill="${theme.surface}" stroke="${color}" stroke-width="1.5"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
      + `<text x="10" y="22" font-size="12" fill="${theme.ink}">${graphEscape(graphLabel(node.label))}</text>`
      + `<text x="10" y="40" font-size="10" fill="${color}">${graphEscape(node.kind)}</text>`
      + agentBadge + `</g>`
  }).join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img" aria-label="研究证据图谱">`
    + `<title>研究证据图谱</title>`
    + `<defs><marker id="rk-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="${theme.line}"/></marker></defs>`
    + `<rect width="${layout.width}" height="${layout.height}" fill="${theme.canvas}"/>`
    + `\n  ${edges}\n  ${nodes}\n</svg>`
}

function downloadGraphFile(text, type, filename) {
  return downloadText(text, type, filename)
}
function knowledgeBackupStamp() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}

function downloadKnowledgeJson(text, filename) {
  downloadGraphFile(text, 'application/json', filename)
}

export function ResearchEvidenceGraph({ sessionId, assetProvider, embedded = false, onNavigate }) {
  const selection = React.useMemo(() => createResearchSelectionStore(sessionId), [sessionId])
  const evidence = React.useMemo(() => createEvidenceStore(sessionId), [sessionId])
  const [resourceIds, setResourceIds] = React.useState(() => selection.get())
  const [records, setRecords] = React.useState(() => evidence.get())
  const [assets, setAssets] = React.useState([])
  const vault = React.useMemo(() => evidenceVaultStore(), [])
  const [savedEvidence, setSavedEvidence] = React.useState([])
  const [researchClaims, setResearchClaims] = React.useState([])
  const [evidenceProjects, setEvidenceProjects] = React.useState([])
  const [knowledgeNodes, setKnowledgeNodes] = React.useState([])
  const [knowledgeClaims, setKnowledgeClaims] = React.useState([])
  const [autoDeposit, setAutoDeposit] = React.useState(() => isAutoDepositEnabled())
  const [selectedKnowledgeId, setSelectedKnowledgeId] = React.useState('')
  const [selectedEvidenceNodeId, setSelectedEvidenceNodeId] = React.useState('')
  const [confirmDeleteEvidence, setConfirmDeleteEvidence] = React.useState(false)
  const [confirmClear, setConfirmClear] = React.useState(false)
  const [projectFilter, setProjectFilter] = React.useState(() => { try { return getActiveProject() || '' } catch { return '' } })
  const [questionFilter, setQuestionFilter] = React.useState('')
  const [directionFilter, setDirectionFilter] = React.useState('all')
  const [scope, setScope] = React.useState('all')
  const [knowledgeDegraded, setKnowledgeDegraded] = React.useState(false)
  const [lastDeposition, setLastDeposition] = React.useState(() => lastDepositionSummary())
  const [assetEvidenceLinks, setAssetEvidenceLinks] = React.useState([])
  const [depositing, setDepositing] = React.useState(false)
  const [knowledgeBackupOpen, setKnowledgeBackupOpen] = React.useState(false)
  const [knowledgeBackupText, setKnowledgeBackupText] = React.useState('')
  const [flowing, setFlowing] = React.useState(true)
  const [showIsolated, setShowIsolated] = React.useState(false)
  const [cleanupOpen, setCleanupOpen] = React.useState(false)
  const [cleaning, setCleaning] = React.useState(false)
  const [view, setView] = React.useState(() => decodeGraphView(typeof window === 'undefined' ? '' : window.location.hash))
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  const [notice, setNotice] = React.useState('')
  const [exportOpen, setExportOpen] = React.useState(false)
  const frameRef = React.useRef(null)
  const dragRef = React.useRef(null)
  const evidenceRefreshVersion = React.useRef(0)
  const assetRefreshVersion = React.useRef(0)
  const knowledgeRefreshVersion = React.useRef(0)

  React.useEffect(() => { setResourceIds(selection.get()); return selection.subscribe(setResourceIds) }, [selection])
  React.useEffect(() => { setRecords(evidence.get()); return evidence.subscribe(setRecords) }, [evidence])
  const refreshAssets = React.useCallback(() => {
    if (!assetProvider?.list) return
    const version = ++assetRefreshVersion.current
    assetProvider.list().then(rows => {
      if (version === assetRefreshVersion.current) setAssets(rows || [])
    }).catch(() => {})
  }, [assetProvider])
  React.useEffect(() => { refreshAssets() }, [refreshAssets])
  React.useEffect(() => assetProvider?.onChange?.(refreshAssets) || undefined, [assetProvider, refreshAssets])
  const refreshSavedEvidence = React.useCallback(() => {
    const version = ++evidenceRefreshVersion.current
    const selectedProject = projectFilter || undefined
    Promise.resolve()
      .then(() => syncEvidenceVaultWithFiles(selectedProject))
      .catch(error => { if (version === evidenceRefreshVersion.current) setNotice(`文件同步失败，显示本地数据：${error.message}`) })
      .then(() => Promise.all([
        vault.list({ project: selectedProject }),
        vault.listProjects(),
        listAssetEvidenceLinks({ project: selectedProject }),
        synchronizeClaimScopes(vault, selectedProject).catch(error => {
          if (version === evidenceRefreshVersion.current) setNotice(`Claim 台账暂不可达，显示离线投影：${error.message}`)
          return vault.listResearchClaims({ project: selectedProject })
        }),
      ]))
      .then(([rows, projects, links, claims]) => {
        if (version !== evidenceRefreshVersion.current) return
        setSavedEvidence(rows || [])
        setEvidenceProjects(projects || [])
        setAssetEvidenceLinks(Array.isArray(links) ? links : [])
        setResearchClaims(Array.isArray(claims) ? claims : [])
      })
      .catch(error => {
        if (version !== evidenceRefreshVersion.current) return
        setNotice(`读取失败，已保留上次数据：${error.message}`)
      })
  }, [vault, projectFilter])
  React.useEffect(() => { refreshSavedEvidence(); return subscribeEvidenceVault(refreshSavedEvidence) }, [refreshSavedEvidence])
  const refreshKnowledge = React.useCallback(() => {
    const version = ++knowledgeRefreshVersion.current
    const store = knowledgeStore()
    setKnowledgeDegraded(store.isDegraded())
    setLastDeposition(lastDepositionSummary())
    Promise.all([store.listNodes(), store.listClaims()])
      .then(([nodes, claims]) => {
        if (version !== knowledgeRefreshVersion.current) return
        setKnowledgeNodes(nodes || []); setKnowledgeClaims(claims || [])
      })
      .catch(() => {
        if (version !== knowledgeRefreshVersion.current) return
        setNotice('知识库读取失败，已保留上次数据；可重新刷新。')
      })
  }, [])
  React.useEffect(() => { refreshKnowledge(); return subscribeKnowledge(refreshKnowledge) }, [refreshKnowledge])
  React.useEffect(() => onAutoDepositChange(value => setAutoDeposit(value)), [])

  // 视图状态写回链接：只写焦点、范围模式、路径两端与缩放，不写任何证据内容。
  React.useEffect(() => {
    if (typeof window !== 'undefined') window.history.replaceState(null, '', encodeGraphView(view))
  }, [view])

  const applyView = React.useCallback(patch => setView(previous => ({ ...previous, ...patch })), [])
  const resources = React.useMemo(() => resourceIds.map(itemById).filter(Boolean), [resourceIds])
  // 项目筛选只作用于持久数据（证据/资产/知识都带 project）；会话记录本就属于当前会话，不参与。
  const visibleSavedEvidence = React.useMemo(
    () => (projectFilter ? savedEvidence.filter(item => (item.project || '') === projectFilter) : savedEvidence),
    [savedEvidence, projectFilter],
  )
  const projectResearchClaims = React.useMemo(() => projectFilter
    ? researchClaims.filter(item => (item.project || '') === projectFilter) : researchClaims, [researchClaims, projectFilter])
  const questionOptions = React.useMemo(() => [...new Map(projectResearchClaims
    .filter(item => item.question).map(item => [item.question, item.question])).values()], [projectResearchClaims])
  const visibleResearchClaims = React.useMemo(() => projectResearchClaims
    .filter(item => !questionFilter || item.question === questionFilter)
    .map(item => directionFilter === 'all' ? item : { ...item, links: (item.links || []).filter(link => link.stance === directionFilter) })
    .filter(item => directionFilter === 'all' || item.links.length),
  [projectResearchClaims, questionFilter, directionFilter])
  const graphEvidence = React.useMemo(() => {
    if (!questionFilter && directionFilter === 'all') return visibleSavedEvidence
    const ids = new Set(visibleResearchClaims.flatMap(item => (item.links || []).map(link => link.evidenceId)))
    return visibleSavedEvidence.filter(item => ids.has(item.id))
  }, [visibleSavedEvidence, visibleResearchClaims, questionFilter, directionFilter])
  const visibleAssets = React.useMemo(
    () => (projectFilter ? assets.filter(item => (item.project || '') === projectFilter) : assets),
    [assets, projectFilter],
  )
  const visibleKnowledgeNodes = React.useMemo(
    () => (projectFilter ? knowledgeNodes.filter(item => (item.project || '') === projectFilter) : knowledgeNodes),
    [knowledgeNodes, projectFilter],
  )
  const visibleKnowledgeNodeIdSet = React.useMemo(() => new Set(visibleKnowledgeNodes.map(item => item.id)), [visibleKnowledgeNodes])
  // 关系只在两端都可见时保留（与 buildEvidenceGraph 末尾的边过滤同一规则，这里先收敛输入）。
  const visibleKnowledgeClaims = React.useMemo(() => (
    projectFilter
      ? knowledgeClaims.filter(item => visibleKnowledgeNodeIdSet.has(item.from) && visibleKnowledgeNodeIdSet.has(item.to))
      : knowledgeClaims
  ), [knowledgeClaims, visibleKnowledgeNodeIdSet, projectFilter])
  const testProjects = React.useMemo(() => selectTestProjects(savedEvidence), [savedEvidence])
  const testProjectEntryCount = testProjects.reduce((sum, item) => sum + item.count, 0)
  const projectOverview = React.useMemo(() => summarizeEvidenceProjects(graphEvidence), [graphEvidence])
  const projectOptions = React.useMemo(() => {
    const names = new Set(evidenceProjects)
    for (const item of savedEvidence) { if (item.project) names.add(item.project) }
    for (const item of assets) { if (item.project) names.add(item.project) }
    for (const item of knowledgeNodes) { if (item.project) names.add(item.project) }
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [evidenceProjects, savedEvidence, assets, knowledgeNodes])
  const includeSession = scope !== 'persistent'
  const includePersistent = scope !== 'session'
  const graphResources = React.useMemo(() => {
    if (!includeSession) return []
    const sourceNames = new Set(visibleSavedEvidence.map(entry => entry.sourceDatabase).filter(Boolean))
    const savedDatabases = catalog.filter(item => item.type === 'database' && sourceNames.has(item.name))
    return [...new Map([...resources, ...savedDatabases].map(item => [item.id, item])).values()]
  }, [includeSession, resources, visibleSavedEvidence])
  const knowledgeInput = React.useMemo(() => ({ nodes: visibleKnowledgeNodes, claims: visibleKnowledgeClaims }), [visibleKnowledgeNodes, visibleKnowledgeClaims])
  const graph = React.useMemo(() => buildEvidenceGraph({
    resources: graphResources,
    workflows: includeSession ? records.workflows : [],
    queries: includeSession ? records.queries : [],
    plans: includeSession ? records.plans : [],
    assets: includePersistent ? visibleAssets : [],
    savedEvidence: includePersistent ? graphEvidence : [],
    researchClaims: includePersistent ? visibleResearchClaims : [],
    knowledge: includePersistent ? knowledgeInput : { nodes: [], claims: [] },
    // 互链属于持久层事实：只在「持久沉淀」范围显示，随筛选收敛（两端不可见自然剔除）。
    assetEvidenceLinks: includePersistent ? assetEvidenceLinks : [],
  }), [graphResources, records, includeSession, includePersistent, visibleAssets, graphEvidence, knowledgeInput, assetEvidenceLinks, visibleResearchClaims])
  // 连通性拆分基于完整图：默认只把「出现在关系里」的节点交给布局，
  // 孤立节点（典型是只保存、尚未关联到查询来源/知识/论断的证据）单独汇总。
  const connectivity = React.useMemo(() => splitEvidenceGraphByConnectivity(graph), [graph])
  const displayGraph = React.useMemo(() => {
    if (showIsolated) return graph
    const keep = new Set(connectivity.connected.map(node => node.id))
    // 从链接/点击定位到的节点即使孤立也必须显示，否则「聚焦某个未关联证据」会空白。
    for (const id of [
      view.focus, view.from, view.to, selectedKnowledgeId,
      selectedEvidenceNodeId ? `evidence:${selectedEvidenceNodeId}` : '',
    ]) if (id) keep.add(id)
    return { nodes: graph.nodes.filter(node => keep.has(node.id)), edges: graph.edges }
  }, [graph, connectivity, showIsolated, view.focus, view.from, view.to, selectedKnowledgeId, selectedEvidenceNodeId])
  const isolatedKindSummary = React.useMemo(() => {
    const counts = new Map()
    for (const node of connectivity.isolated) {
      const label = GRAPH_KIND_LABELS[node.kind] || node.kind || '节点'
      counts.set(label, (counts.get(label) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => `${label} ${count}`).join('、')
  }, [connectivity])
  // 高亮计算仍基于完整图，保证邻域/路径语义不因画布性能裁剪而改变。
  const highlighted = React.useMemo(() => {
    if (view.mode === 'all') return null
    if (view.mode === 'path') return view.from && view.to ? new Set(findEvidencePath(graph, view.from, view.to)) : null
    if (!view.focus) return null
    return evidenceNeighborhood(graph, view.focus, view.mode)
  }, [view, graph])
  // 性能裁剪必须发生在布局和路由之前；否则虽然 DOM 只有 300 个节点，CPU 仍会计算全图。
  // 完整图保留在 graph 中，仅在用户导出时按需布局。
  const interactiveGraph = React.useMemo(() => {
    if (displayGraph.nodes.length <= GRAPH_RENDER_NODE_LIMIT) return displayGraph
    const priority = new Set([
      ...(highlighted || []), view.focus, view.from, view.to, selectedKnowledgeId,
      selectedEvidenceNodeId ? `evidence:${selectedEvidenceNodeId}` : '',
    ].filter(Boolean))
    const nodes = [
      ...displayGraph.nodes.filter(node => priority.has(node.id)),
      ...displayGraph.nodes.filter(node => !priority.has(node.id)),
    ].slice(0, GRAPH_RENDER_NODE_LIMIT)
    const ids = new Set(nodes.map(node => node.id))
    return { ...displayGraph, nodes, edges: displayGraph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) }
  }, [displayGraph, highlighted, view.focus, view.from, view.to, selectedKnowledgeId, selectedEvidenceNodeId])
  const layout = React.useMemo(() => layoutEvidenceGraph(interactiveGraph), [interactiveGraph])
  const routes = React.useMemo(() => routeEvidenceEdges(interactiveGraph, layout), [interactiveGraph, layout])
  // 两种「没画」不能共用一条文案：未关联节点是设计取舍（可开关），渲染上限是性能取舍。
  const hiddenIsolatedCount = graph.nodes.length - displayGraph.nodes.length
  const renderLimitedCount = displayGraph.nodes.length - interactiveGraph.nodes.length
  // 显式聚焦/路径端点即使孤立也要出画布：用户是在「定位到某个证据」，不是在浏览整图。
  const hasExplicitFocus = Boolean(view.focus || view.from || view.to)
  const hasCanvas = graph.nodes.length > 0 && displayGraph.nodes.length > 0 && (graph.edges.length > 0 || showIsolated || hasExplicitFocus)

  const scale = view.scale
  const viewWidth = layout.width / scale
  const viewHeight = layout.height / scale

  // 平移边界：不允许把图拖出视口后找不回来。缩放系数 ≤1 时 viewBox 大于画布，
  // 上限自然收敛为 0，图居中显示。
  const clampPanFor = (next, at) => {
    const width = layout.width / at
    const height = layout.height / at
    return {
      x: Math.min(Math.max(0, layout.width - width), Math.max(0, next.x)),
      y: Math.min(Math.max(0, layout.height - height), Math.max(0, next.y))
    }
  }

  const zoomBy = factor => {
    const next = clampGraphScale(scale * factor)
    if (next === scale) return
    const centerX = pan.x + viewWidth / 2
    const centerY = pan.y + viewHeight / 2
    const ratio = next / scale
    setPan(clampPanFor({ x: centerX - (centerX - pan.x) / ratio, y: centerY - (centerY - pan.y) / ratio }, next))
    applyView({ scale: next })
  }

  const resetView = () => { setPan({ x: 0, y: 0 }); applyView({ scale: 1 }) }

  const onPointerDown = event => {
    if (event.button !== 0) return
    dragRef.current = { x: event.clientX, y: event.clientY, pan: { ...pan }, pending: { ...pan }, frame: 0 }
    if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = event => {
    const drag = dragRef.current
    if (!drag) return
    const rect = frameRef.current && frameRef.current.getBoundingClientRect()
    if (!rect || !rect.width) return
    const unit = viewWidth / rect.width
    drag.pending = clampPanFor({ x: drag.pan.x - (event.clientX - drag.x) * unit, y: drag.pan.y - (event.clientY - drag.y) * unit }, scale)
    const paint = () => {
      drag.frame = 0
      const next = drag.pending
      frameRef.current?.setAttribute('viewBox', `${next.x} ${next.y} ${viewWidth} ${viewHeight}`)
    }
    if (!drag.frame) {
      if (typeof requestAnimationFrame === 'function') drag.frame = requestAnimationFrame(paint)
      else paint()
    }
  }
  const onPointerUp = event => {
    const drag = dragRef.current
    if (drag?.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(drag.frame)
    if (drag?.pending) setPan(drag.pending)
    dragRef.current = null
    if (event.currentTarget.releasePointerCapture && event.currentTarget.hasPointerCapture && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }
  const onWheel = event => {
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15)
  }
  const onMinimapClick = event => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = ((event.clientX - rect.left) / rect.width) * layout.width
    const y = ((event.clientY - rect.top) / rect.height) * layout.height
    setPan(clampPanFor({ x: x - viewWidth / 2, y: y - viewHeight / 2 }, scale))
  }

  const activateNode = nodeId => {
    if (view.mode === 'path') {
      if (!view.from || view.to) applyView({ from: nodeId, to: '', focus: nodeId })
      else applyView({ to: nodeId })
      return
    }
    applyView({ focus: nodeId })
  }

  const selectedKnowledge = React.useMemo(
    () => knowledgeNodes.find(node => node.id === selectedKnowledgeId) || null,
    [knowledgeNodes, selectedKnowledgeId],
  )

  const selectedEvidenceEntry = React.useMemo(
    () => (selectedEvidenceNodeId ? savedEvidence.find(entry => entry.id === selectedEvidenceNodeId) || null : null),
    [savedEvidence, selectedEvidenceNodeId],
  )
  const relatedClaims = React.useMemo(
    () => (selectedKnowledgeId ? knowledgeClaims.filter(claim => claim.from === selectedKnowledgeId || claim.to === selectedKnowledgeId) : []),
    [knowledgeClaims, selectedKnowledgeId],
  )
  const knowledgeLabelOf = React.useCallback(
    id => knowledgeNodes.find(node => node.id === id)?.label || id,
    [knowledgeNodes],
  )
  // 冲突结论并列提示：同一对端点存在极性不一致的多条关系（如「促进」与「抑制」并存）时，
  // 自动沉淀不裁决冲突——如实计数并提示人工核验（需求：冲突结论并列保留）。
  const knowledgeConflictCount = React.useMemo(() => {
    if (!selectedKnowledgeId) return 0
    const groups = new Map()
    for (const claim of relatedClaims) {
      const pair = claim.from < claim.to ? `${claim.from}|${claim.to}` : `${claim.to}|${claim.from}`
      groups.set(pair, [...(groups.get(pair) || []), claim.polarity])
    }
    return [...groups.values()].filter(polarities => new Set(polarities).size > 1).length
  }, [relatedClaims, selectedKnowledgeId])

  const updateKnowledgeStatus = status => {
    if (!selectedKnowledge) return
    knowledgeStore().setNodeStatus(selectedKnowledge.id, status)
      .then(() => publishKnowledge())
      .catch(error => setNotice(`更新核验状态失败：${error?.message || error}`))
  }

  const minimapWidth = 148
  const minimapHeight = Math.min(180, Math.max(70, Math.round((minimapWidth * layout.height) / Math.max(1, layout.width))))
  const frameHeight = Math.min(GRAPH_FRAME_HEIGHT, Math.max(320, layout.height))

  // 迷你地图密度模式：节点 > 50 时用聚合色块代替逐节点矩形，
  // 避免 193 个节点挤在一起变成无信息量的实心色墙。
  const nodeCount = layout.nodes.length
  const useDensityMode = nodeCount > 50
  const densityGridSize = 12
  const densityCells = useDensityMode ? (() => {
    const cellW = layout.width / densityGridSize
    const cellH = layout.height / Math.max(1, Math.ceil(densityGridSize * layout.height / layout.width))
    const grid = new Map()
    for (const node of layout.nodes) {
      const cx = Math.floor((node.x - GRAPH_NODE_WIDTH / 2) / cellW)
      const cy = Math.floor(node.y / cellH)
      const key = `${cx},${cy}`
      grid.set(key, (grid.get(key) || 0) + 1)
    }
    const maxCount = Math.max(...grid.values())
    return { cellW, cellH, grid, maxCount }
  })() : null

  const canvas = h('svg', {
    key: 'canvas',
    ref: frameRef,
    viewBox: `${pan.x} ${pan.y} ${viewWidth} ${viewHeight}`,
    width: '100%',
    height: frameHeight,
    role: 'img',
    'aria-label': '研究证据图谱',
    preserveAspectRatio: 'xMidYMid meet',
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onWheel,
    style: { display: 'block', touchAction: 'none', cursor: 'grab', background: C.surfaceAlt, borderRadius: 12 }
  }, [
    ...routes.map(route => h('path', {
      key: route.key,
      className: flowing ? 'rk-graph-edge rk-graph-edge-flow' : 'rk-graph-edge',
      d: route.d,
      fill: 'none',
      stroke: C.lineStrong,
      strokeWidth: 1.5,
      markerEnd: 'url(#rk-arrow)',
      opacity: highlighted && !(highlighted.has(route.from) && highlighted.has(route.to)) ? 0.18 : 1
    })),
    h('defs', { key: 'defs' }, h('marker', { id: 'rk-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto' }, h('path', { d: 'M0,0 L0,6 L7,3 z', fill: C.lineStrong }))),
    ...layout.nodes.map(node => {
      const marked = view.focus === node.id || node.id === view.from || node.id === view.to
      const dim = highlighted ? !highlighted.has(node.id) : false
      return h('a', {
        key: node.id,
        href: '#research-evidence-graph',
        className: `rk-graph-node${marked ? ' rk-graph-node-focus' : ''}`,
        opacity: dim ? 0.25 : 1,
        'aria-label': `聚焦 ${node.label}`,
        onPointerDown: event => event.stopPropagation(),
        onClick: event => {
          event.preventDefault()
          activateNode(node.id)
          setSelectedKnowledgeId(node.id.startsWith(KNOWLEDGE_NODE_ID_PREFIX) ? node.id : '')
          if (node.kind === 'evidence') setSelectedEvidenceNodeId(node.id.replace('evidence:', ''))
          else setSelectedEvidenceNodeId('')
          setConfirmDeleteEvidence(false)
        }
        , onDoubleClick: event => {
          event.preventDefault()
          if (node.kind === 'evidence') setSelectedEvidenceNodeId(node.id.replace('evidence:', ''))
        }
      }, h('g', { transform: `translate(${node.x - GRAPH_NODE_WIDTH / 2},${node.y})` }, [
        h('title', { key: 'accessible-title' }, `聚焦 ${node.label}`),
        h('rect', {
          key: 'box', width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT, rx: 9, fill: C.surface,
          stroke: nodeStrokeColor(node), strokeWidth: 1.5,
          ...(nodeStrokeDash(node) ? { strokeDasharray: nodeStrokeDash(node) } : {}),
        }),
        h('text', { key: 'title', x: 10, y: 22, fill: C.ink, fontSize: 12, fontWeight: 700 }, graphLabel(node.label)),
        h('text', { key: 'kind', x: 10, y: 40, fill: nodeStrokeColor(node), fontSize: 10 }, node.kind),
        ...(node.agentProduced ? [h('circle', { key: 'agent-badge', cx: GRAPH_NODE_WIDTH - 12, cy: 10, r: 4, fill: '#3498DB' })] : []),
      ]))
    })
  ])

  const minimap = h('div', {
    key: 'minimap',
    style: { position: 'absolute', right: 14, bottom: 14, padding: 6, border: `1px solid ${C.line}`, borderRadius: 10, background: C.surface, boxShadow: C.shadowCard }
  }, h('svg', {
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    width: minimapWidth,
    height: minimapHeight,
    role: 'img',
    'aria-label': '图谱迷你地图',
    onClick: onMinimapClick,
    style: { display: 'block', cursor: 'crosshair' }
  }, [
    h('rect', { key: 'bg', width: layout.width, height: layout.height, fill: C.surfaceAlt, rx: 6 }),
    ...(useDensityMode && densityCells
      ? [...densityCells.grid.entries()].map(([key, count]) => {
          const [cx, cy] = key.split(',').map(Number)
          const intensity = count / densityCells.maxCount
          return h('rect', {
            key: `density-${key}`,
            x: cx * densityCells.cellW,
            y: cy * densityCells.cellH,
            width: densityCells.cellW,
            height: densityCells.cellH,
            rx: 2,
            fill: C.teal,
            opacity: 0.15 + intensity * 0.65,
          })
        })
      : layout.nodes.map(node => h('rect', {
      key: node.id,
      x: node.x - GRAPH_NODE_WIDTH / 2,
      y: node.y,
      width: GRAPH_NODE_WIDTH,
      height: GRAPH_NODE_HEIGHT,
      rx: 6,
      fill: graphKindColor(node.kind),
      opacity: highlighted && !highlighted.has(node.id) ? 0.25 : 0.75
      }))),
    h('rect', { key: 'viewport', x: pan.x, y: pan.y, width: viewWidth, height: viewHeight, fill: 'none', stroke: C.accent, strokeWidth: Math.max(3, layout.width / 140) })
  ]), useDensityMode ? h('div', {
    key: 'density-label',
    style: { position: 'absolute', bottom: 4, left: 8, fontSize: 9, color: C.muted, pointerEvents: 'none' },
  }, `${nodeCount} 节点 · 密度视图`) : null)

  const exportGraph = format => {
    const theme = readGraphTheme()
    // 导出与当前视图一致：默认不含未关联节点；若因渲染上限少画了节点，导出仍给出全部有关联部分。
    const exportSource = renderLimitedCount ? displayGraph : interactiveGraph
    const exportLayout = layoutEvidenceGraph(exportSource)
    const exportRoutes = routeEvidenceEdges(exportSource, exportLayout)
    const svg = buildGraphSvgMarkup(exportLayout, exportRoutes, theme)
    if (format === 'svg') downloadGraphFile(svg, 'image/svg+xml', 'research-evidence-chain.svg')
    else downloadGraphFile(`<!doctype html><meta charset="utf-8"><title>科研证据链路</title><style>body{margin:0;padding:28px;background:${theme.canvas};color:${theme.ink};font:14px system-ui}h1{font-size:17px;margin:0 0 6px}p{margin:0 0 18px;opacity:.7}</style><h1>科研证据链路</h1><p>${GRAPH_EXPORT_SCOPE}</p>${svg}`, 'text/html', 'research-evidence-chain.html')
    setExportOpen(false)
    setNotice(format === 'svg' ? '已导出 SVG 快照。' : '已导出 HTML 快照。')
  }

  const copyViewLink = () => {
    if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) return setNotice('当前环境不支持复制链接，可手动复制地址栏。')
    navigator.clipboard.writeText(window.location.href)
      .then(() => setNotice('已复制当前视图链接；链接只含焦点、范围与缩放，不含任何证据内容。'))
      .catch(() => setNotice('复制失败，可手动复制地址栏。'))
  }

  const depositLatest = async () => {
    if (depositing) return
    setDepositing(true)
    try {
      const result = await depositLatestAssistantMessage({ assetProvider })
      if (result?.error === 'no-sessions') { setNotice('当前环境未提供会话服务，无法读取会话回答。'); return }
      if (result?.error === 'no-session') { setNotice('没有可读取的当前会话；请先打开一个会话再回来。'); return }
      if (result?.error === 'empty') { setNotice('当前会话没有可沉淀的助手回答。'); return }
      const summary = result.summary
      setNotice(!summary?.extracted
        ? '已检查最近一条回答：未提取出研究内容（无研究问题、发现、假设、方法或引用来源），未入库。'
        : `已沉淀最近一条回答（消息 #${result.seq ?? '?'}）：+${summary.addedNodes} 节点 · +${summary.addedClaims} 关系 · 证据 ${summary.savedEvidence} · 资产 ${summary.savedAssets}`
          + `${result.interrupted ? '；注意该回答曾被中断，内容可能不完整' : ''}。全部以待核验状态入库。`)
    } catch (error) {
      setNotice(`沉淀失败：${error?.message || error}`)
    } finally {
      setDepositing(false)
    }
  }

  const exportKnowledgeBackup = () => {
    try {
      const text = serializeKnowledgeBackup({ nodes: knowledgeNodes, claims: knowledgeClaims })
      downloadKnowledgeJson(text, `dsh-research-kit-knowledge-${knowledgeBackupStamp()}.json`)
      setNotice(`已导出 ${knowledgeNodes.length} 个知识节点、${knowledgeClaims.length} 条关系（含核验状态与来源摘录，请妥善保管）。`)
    } catch (error) { setNotice(`⚠️ 导出失败：${error?.message || error}`) }
  }
  const importKnowledgeBackup = async () => {
    try {
      const parsed = parseKnowledgeBackup(knowledgeBackupText)
      const result = await knowledgeStore().importBackup(parsed)
      publishKnowledge()
      setNotice(`已恢复 ${result.addedNodes} 个节点、${result.addedClaims} 条关系`
        + `${result.skippedNodes ? `，跳过 ${result.skippedNodes} 个已存在节点` : ''}`
        + `${result.skippedClaims ? `，跳过 ${result.skippedClaims} 条已存在关系` : ''}`
        + `${result.invalidNodes + result.invalidClaims ? `，${result.invalidNodes + result.invalidClaims} 条无法追溯已忽略` : ''}。`)
      setKnowledgeBackupText('')
      setKnowledgeBackupOpen(false)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  // 只清理「文件名与数据两侧都在」的测试证据：先删文件再删本地 IndexedDB，
  // 两步都成功才算删掉一条；顺序不能反——先删本地会让下一次同步把文件里的旧条目
  // 当成「本地缺失、文件有」重新导回。
  const cleanupTestProjects = async () => {
    if (cleaning || !testProjects.length) return
    setCleaning(true)
    let removedEntries = 0
    const failures = []
    try {
      for (const item of testProjects) {
        try {
          await clearEvidenceEntriesFromFile(item.project)
          removedEntries += await vault.removeByProject(item.project)
        } catch (error) {
          failures.push(`${item.project}（${error?.message || error}）`)
        }
      }
      publishEvidenceVault()
      setCleanupOpen(false)
      const currentIsCleaned = testProjects.some(item => item.project === projectFilter)
      if (currentIsCleaned) setProjectFilter('')
      refreshSavedEvidence()
      setNotice(failures.length
        ? `已清理 ${removedEntries} 条测试证据；以下课题失败，未删除本地缓存：${failures.join('、')}。`
        : `已清理 ${testProjects.length} 个测试课题、${removedEntries} 条证据；真实课题未受影响。`)
    } finally {
      setCleaning(false)
    }
  }

  const content = [
    h(PageHead, {
      key: 'head',
      kicker: 'Research Kit',
      title: '研究证据图谱',
      lead: '连接本会话的资源、工作流和查询来源，并接入已保存证据与自动沉淀的研究知识；不显示检索词、原始文件、全文或笔记。箭头表示代码记录到的关系方向，不代表已核验的科学结论。默认只绘制存在关系的节点，未关联节点只在需要时展开。可缩放、拖拽与框选范围。',
      actions: [
        h(Button, { key: 'motion', variant: 'soft', onClick: () => setFlowing(value => !value) }, flowing ? '暂停链路流动' : '播放链路流动'),
        h(Button, { key: 'export', variant: 'soft', onClick: () => setExportOpen(true) }, '导出快照'),
        h(Button, { key: 'link', variant: 'ghost', onClick: copyViewLink }, '复制视图链接'),
        h(Button, {
          key: 'auto-deposit',
          variant: autoDeposit ? 'soft' : 'ghost',
          'aria-pressed': autoDeposit,
          title: '开启后自动从助手回答提取研究知识并入库（本地完成，全部以待核验状态保存）',
          onClick: () => {
            const next = !autoDeposit
            setAutoDepositEnabled(next)
            setAutoDeposit(next)
            setNotice(next
              ? '已开启自动沉淀：此后每条助手回答完成后，会在本地提取研究问题、发现、假设与引用来源，全部以「待核验」状态进入灵感资产、证据库与本图谱；相同内容自动合并，冲突结论并列保留。'
              : '已关闭自动沉淀：已保存的知识、证据与灵感资产全部保留，可继续手动操作。')
          },
        }, autoDeposit ? '自动沉淀 · 已开启' : '自动沉淀 · 已关闭'),
        h(Button, {
          key: 'deposit-latest', variant: 'ghost', size: 'sm', icon: 'sparkles', disabled: depositing,
          title: '不开自动开关时，可手动把当前会话最近一条助手回答提取入库（本地完成，待核验起步）',
          onClick: depositLatest,
        }, depositing ? '正在沉淀…' : '沉淀最近回答'),
        h(Button, {
          key: 'knowledge-export', variant: 'ghost', size: 'sm', icon: 'download',
          disabled: !knowledgeNodes.length,
          title: '把自动沉淀的知识节点与关系导出为 JSON 备份',
          onClick: exportKnowledgeBackup,
        }, '导出知识'),
        h(Button, {
          key: 'knowledge-import', variant: 'ghost', size: 'sm', icon: 'upload',
          title: '从 JSON 备份增量恢复知识节点与关系',
          onClick: () => setKnowledgeBackupOpen(value => !value),
        }, '恢复知识'),
        confirmClear
          ? h(Button, {
            key: 'clear-confirm', variant: 'danger', icon: 'trash',
            onClick: () => { evidence.clear(); setConfirmClear(false); setNotice('已清空本会话的查询、工作流与计划记录；已保存证据、灵感资产与自动沉淀知识不受影响。') },
          }, '确认清空临时记录')
          : h(Button, { key: 'clear', variant: 'ghost', onClick: () => setConfirmClear(true), title: '只清除本会话的查询、工作流与计划记录，不影响持久化数据' }, '清空本会话临时记录'),
      ]
    }),
    // 筛选生效时即使图为空也要保留工具栏，否则用户会被困在筛选状态里出不来。
    (graph.nodes.length || scope !== 'all' || projectFilter) ? h(Toolbar, { key: 'summary', sticky: true }, [
      h(Segmented, { key: 'modes', value: view.mode, options: GRAPH_VIEW_MODES, onChange: mode => applyView({ mode }), ariaLabel: '图谱范围模式' }),
      h(Segmented, { key: 'scope', value: scope, options: GRAPH_SCOPE_MODES, onChange: setScope, ariaLabel: '节点生命周期范围' }),
      projectOptions.length ? h(Select, {
        key: 'project',
        value: projectFilter,
        options: [{ value: '', label: '全部项目' }, ...projectOptions.map(name => ({ value: name, label: name }))],
        onChange: value => { setProjectFilter(value); setQuestionFilter('') },
        ariaLabel: '按项目筛选持久数据',
        style: { width: 'auto', minWidth: 108 },
      }) : null,
      questionOptions.length ? h(Select, { key: 'question', value: questionFilter, onChange: value => { setQuestionFilter(value); if (value) setScope('persistent') },
        options: [{ value: '', label: '全部研究问题' }, ...questionOptions.map(question => ({ value: question, label: question.slice(0, 60) }))],
        ariaLabel: '按研究问题筛选图谱', style: { width: 'auto', minWidth: 120 } }) : null,
      h(Select, { key: 'direction', value: directionFilter, onChange: value => { setDirectionFilter(value); if (value !== 'all') setScope('persistent') },
        options: [{ value: 'all', label: '全部证据方向' }, { value: 'supports', label: '支持' }, { value: 'refutes', label: '反驳' }, { value: 'insufficient', label: '证据不足' }, { value: 'unassessed', label: '待评估' }],
        ariaLabel: '按证据方向筛选图谱', style: { width: 'auto', minWidth: 110 } }),
      h('span', { key: 'nodes', style: { color: C.muted, fontSize: 13 } }, `${graph.nodes.length} 个节点`),
      h('span', { key: 'edges', style: { color: C.muted, fontSize: 13 } }, `${graph.edges.length} 条关系`),
      connectivity.isolated.length ? h(Button, {
        key: 'isolated', size: 'sm', variant: showIsolated ? 'soft' : 'ghost', 'aria-pressed': showIsolated,
        title: showIsolated
          ? '隐藏没有关系的节点，回到只显示关系的汇总视图'
          : '显示没有关系的节点；它们之间没有连线，只是按类型排列的卡片网格',
        onClick: () => setShowIsolated(value => !value),
      }, showIsolated ? `隐藏未关联节点（${connectivity.isolated.length}）` : `显示未关联节点（${connectivity.isolated.length}）`) : null,
      hasCanvas ? h('span', { key: 'scale', style: { color: C.muted, fontSize: 13 } }, `${Math.round(scale * 100)}%`) : null,
      hasCanvas ? h(Button, { key: 'out', size: 'sm', variant: 'soft', disabled: scale <= GRAPH_SCALE_RANGE.min, title: '缩小', onClick: () => zoomBy(1 / 1.2) }, '缩小') : null,
      hasCanvas ? h(Button, { key: 'in', size: 'sm', variant: 'soft', disabled: scale >= GRAPH_SCALE_RANGE.max, title: '放大', onClick: () => zoomBy(1.2) }, '放大') : null,
      hasCanvas ? h(Button, { key: 'reset', size: 'sm', variant: 'ghost', onClick: resetView }, '复位') : null,
      hasCanvas ? h('span', { key: 'hint', style: { marginLeft: 'auto', color: C.muted, fontSize: 12 } }, '按住 Ctrl / ⌘ 滚轮缩放；拖拽平移') : null
    ]) : null,
    knowledgeDegraded ? h(Notice, { key: 'knowledge-degraded', tone: 'warn', icon: 'shield', style: { margin: '10px var(--rk-gutter) 0' } },
      '当前环境未提供可用的 IndexedDB，自动沉淀知识只存在内存中，刷新页面后会丢失；建议先导出知识备份。') : null,
    renderLimitedCount ? h(Notice, { key: 'graph-render-limit', tone: 'warn', icon: 'filter', style: { margin: '10px var(--rk-gutter) 0' } },
      `当前有关联的节点共 ${displayGraph.nodes.length} 个；为保持交互流畅，画布只布局前 ${GRAPH_RENDER_NODE_LIMIT} 个（另有 ${renderLimitedCount} 个未绘制）。导出仍包含全部有关系节点，请使用项目或生命周期筛选缩小范围。`) : null,
    hiddenIsolatedCount && graph.edges.length
      ? h('div', { key: 'graph-isolated-hidden', style: { display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', margin: '10px var(--rk-gutter) 0' } }, [
          h(Notice, { key: 'n', tone: 'info', icon: 'filter', style: { margin: 0, flex: '1 1 320px' } },
            `默认只绘制有关系的节点；另有 ${hiddenIsolatedCount} 个未关联节点已隐藏${isolatedKindSummary ? `（${isolatedKindSummary}）` : ''}。`),
          h(Button, { key: 'show', size: 'sm', variant: 'ghost', onClick: () => setShowIsolated(true) }, `显示未关联节点（${hiddenIsolatedCount}）`),
        ]) : null,
    showIsolated && graph.edges.length === 0 && graph.nodes.length
      ? h(Notice, { key: 'graph-isolated-only', tone: 'warn', icon: 'filter', style: { margin: '10px var(--rk-gutter) 0' } },
        `正在显示 ${graph.nodes.length} 个未关联节点。它们之间没有记录到的关系，下面的卡片只是按类型排列的网格，不代表图谱结构。`) : null,
    graph.nodes.length ? h('div', { key: 'legend', style: { display: 'flex', flexWrap: 'wrap', gap: '4px 14px', margin: '10px var(--rk-gutter) 0', fontSize: 12, color: C.muted } },
      [
        ...GRAPH_LEGEND_ORDER.filter(kind => graph.nodes.some(node => node.kind === kind)).map(kind => h('span', { key: kind, style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, [
          h('span', { key: 'dot', 'aria-hidden': 'true', style: { width: 9, height: 9, borderRadius: 3, background: graphKindColor(kind), display: 'inline-block' } }),
          GRAPH_KIND_LABELS[kind] || kind,
        ])),
        autoDeposit && lastDeposition ? h('span', {
          key: 'last-deposition',
          title: `会话 ${lastDeposition.sessionId || '本地'} 消息 #${lastDeposition.seq ?? '?'}`,
        }, `最近沉淀：+${lastDeposition.addedNodes} 节点 · +${lastDeposition.addedClaims} 关系 · 证据 ${lastDeposition.savedEvidence} · 资产 ${lastDeposition.savedAssets}（消息 #${lastDeposition.seq ?? '?'}）`) : null,
      ]) : null,
    notice ? h(Notice, { key: 'notice', tone: 'info', style: { margin: '0 var(--rk-gutter) 12px' } }, notice) : null,
    graph.nodes.length
      ? (hasCanvas
        ? h(Card, { key: 'canvas', style: { margin: '18px var(--rk-gutter) 14px', padding: 12, background: C.surfaceAlt } },
            h('div', { style: { position: 'relative' } }, [canvas, minimap]))
        : h(Card, { key: 'no-relations', style: { margin: '18px var(--rk-gutter) 14px', padding: 18, display: 'grid', gap: 12 } }, [
            h(EmptyState, {
              key: 'summary',
              icon: 'search',
              text: `当前范围有 ${graph.nodes.length} 个节点，但没有记录到的关系。`,
              hint: `图谱只绘制存在关系的节点，不会把 ${graph.nodes.length} 张互不相连的卡片铺成网格。已保存证据不会仅因同属一个项目就互连：把它关联到研究论断、自动沉淀知识或本次会话的查询来源（并在保存时标注来源库）后才会出现连线。`
                + (isolatedKindSummary ? `当前未关联：${isolatedKindSummary}。` : '')
                + '可以先按上方项目筛选收窄范围；需要看全部卡片时可临时打开「显示未关联节点」。',
            }),
            projectOverview.length ? h('div', {
              key: 'projects',
              style: { display: 'grid', gap: 4, width: '100%', maxWidth: 760, margin: '0 auto', fontSize: 13 },
            }, [
              h('strong', { key: 'title', style: { fontSize: 12, color: C.muted, fontWeight: 650 } }, '按项目概览'),
              ...projectOverview.map(row => h('div', {
                key: row.project,
                style: { display: 'flex', gap: 12, alignItems: 'baseline', padding: '5px 0', borderBottom: `1px solid ${C.line}` },
              }, [
                h('span', { key: 'name', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.project),
                h('span', { key: 'count', style: { color: C.muted, whiteSpace: 'nowrap' } }, `${row.count} 条`),
                h('span', { key: 'ids', style: { color: C.muted, fontSize: 12, whiteSpace: 'nowrap' } },
                  row.identifiers.map(item => `${IDENTIFIER_KIND_LABELS[item.kind] || item.kind} ${item.count}`).join(' · ')),
              ])),
            ]) : null,
            h('div', { key: 'actions', style: { display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' } }, [
              h(Button, { key: 'show', size: 'sm', variant: 'soft', onClick: () => setShowIsolated(true) },
                `仍要显示未关联节点（${connectivity.isolated.length}）`),
              testProjects.length ? h(Button, {
                key: 'cleanup', size: 'sm', variant: 'ghost', onClick: () => setCleanupOpen(true),
                title: '删除明显的测试/演示课题在文件与本地缓存中的证据；真实课题不会出现在列表里',
              }, `清理测试课题（${testProjects.length} 个 / ${testProjectEntryCount} 条）`) : null,
              typeof onNavigate === 'function' ? h(Button, {
                key: 'vault', size: 'sm', variant: 'ghost', onClick: () => onNavigate('vault'),
              }, '去研究资产库查看完整证据') : null,
            ]),
          ]))
      : h(EmptyState, {
        key: 'empty',
        text: (scope !== 'all' || projectFilter) && (savedEvidence.length || assets.length || knowledgeNodes.length || records.queries.length)
          ? '当前筛选范围内没有可绘制的关系'
          : '尚无可绘制的证据关系',
        hint: (scope !== 'all' || projectFilter)
          ? '调整上方的节点范围或项目筛选；「本会话」只含刷新即消失的记录，「持久沉淀」含证据、灵感资产与自动沉淀知识。'
          : '先选择资源、启动工作流、执行数据库查询或保存研究灵感资产，图谱会自动形成；也可开启右上角「自动沉淀」让图谱随科研对话积累，或点「沉淀最近回答」手动提取当前会话最近一条回答。',
      }),
    selectedEvidenceEntry ? h(Card, {
      key: 'evidence-detail',
      style: {
        margin: '0 var(--rk-gutter) 14px', padding: 16,
        border: `1px solid ${nodeStrokeColor({ kind: 'evidence', grade: selectedEvidenceEntry.grade })}40`,
        display: 'grid', gap: 10,
      },
    }, [
      h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
        h('strong', { key: 'title', style: { fontSize: 14, flex: 1, minWidth: 0 } }, selectedEvidenceEntry.title),
        selectedEvidenceEntry.grade && selectedEvidenceEntry.grade !== 'ungraded'
          ? h(Badge, { key: 'grade', color: { empirical: '#27AE60', inference: '#F39C12', missing: '#E74C3C' }[selectedEvidenceEntry.grade] || C.muted },
              { empirical: '实证', inference: '推论', missing: '缺失' }[selectedEvidenceEntry.grade] || selectedEvidenceEntry.grade)
          : null,
        selectedEvidenceEntry.agentProduced && h(Badge, { key: 'agent', color: '#3498DB' }, 'Agent'),
        h('span', { key: 'spacer', style: { flex: 1 } }),
        h(Button, { key: 'close', size: 'sm', variant: 'ghost', onClick: () => setSelectedEvidenceNodeId('') }, '收起'),
      ]),
      h('div', { key: 'meta', style: { display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: C.muted } }, [
        selectedEvidenceEntry.identifier ? h('span', { key: 'id' },
          `${selectedEvidenceEntry.identifierKind || ''}: ${selectedEvidenceEntry.identifier}`) : null,
        selectedEvidenceEntry.sourceDatabase ? h('span', { key: 'src' }, selectedEvidenceEntry.sourceDatabase) : null,
        selectedEvidenceEntry.project ? h('span', { key: 'proj' }, selectedEvidenceEntry.project) : null,
        selectedEvidenceEntry.savedAt ? h('span', { key: 'date' }, new Date(selectedEvidenceEntry.savedAt).toLocaleDateString('zh-CN')) : null,
      ]),
      selectedEvidenceEntry.note ? h('p', {
        key: 'note',
        style: { margin: 0, fontSize: 12, lineHeight: 1.55, color: C.ink, whiteSpace: 'pre-wrap' },
      }, selectedEvidenceEntry.note) : null,
      h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
        selectedEvidenceEntry.url ? h(Button, {
          key: 'url', size: 'sm', variant: 'soft', icon: 'search',
          onClick: () => { if (typeof window !== 'undefined') window.open(selectedEvidenceEntry.url, '_blank', 'noopener') },
        }, '打开来源') : null,
        selectedEvidenceEntry.url ? h('span', {
          key: 'url-text',
          style: { fontSize: 11, color: C.muted, alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300, whiteSpace: 'nowrap' },
        }, selectedEvidenceEntry.url) : null,
        h('span', { key: 'delete-spacer', style: { flex: 1 } }),
        confirmDeleteEvidence
          ? h(Button, {
            key: 'delete-confirm', size: 'sm', variant: 'danger', icon: 'trash',
            onClick: async () => {
              setConfirmDeleteEvidence(false)
              try {
                await removeEvidenceEntryFromFile(selectedEvidenceEntry)
                await vault.remove(selectedEvidenceEntry.id)
                setSelectedEvidenceNodeId('')
                setNotice(`已删除「${selectedEvidenceEntry.title}」。`)
              } catch (error) { setNotice(`删除失败：${error?.message || error}`) }
            },
          }, '确认删除')
          : h(Button, {
            key: 'delete', size: 'sm', variant: 'ghost', icon: 'trash',
            onClick: () => setConfirmDeleteEvidence(true),
            title: '从证据库和文件存储中彻底删除此条目（不可恢复）',
          }, '删除'),
      ]),
    ]) : null,
    selectedKnowledge ? h(Card, { key: 'knowledge-detail', style: { margin: '0 var(--rk-gutter) 18px', padding: 16, display: 'grid', gap: 12 } }, [
      h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
        h('strong', { key: 't', style: { fontSize: 14 } }, selectedKnowledge.label),
        h(Badge, { key: 'k', color: graphKindColor(selectedKnowledge.kind) },
          `${KNOWLEDGE_KIND_LABELS[selectedKnowledge.kind] || selectedKnowledge.kind}${selectedKnowledge.entityKind ? ` · ${KNOWLEDGE_ENTITY_LABELS[selectedKnowledge.entityKind] || selectedKnowledge.entityKind}` : ''}`),
        h('span', { key: 'spacer', style: { flex: 1 } }),
        h(Select, {
          key: 'status', value: selectedKnowledge.status, options: KNOWLEDGE_STATUS_OPTIONS,
          onChange: updateKnowledgeStatus, ariaLabel: `设置「${selectedKnowledge.label}」的核验状态`,
          style: { width: 'auto', minWidth: 96 },
        }),
        h(Button, { key: 'close', size: 'sm', variant: 'ghost', onClick: () => setSelectedKnowledgeId('') }, '收起'),
      ]),
      relatedClaims.length ? h('div', { key: 'claims', style: { display: 'grid', gap: 6, fontSize: 13 } }, [
        h('strong', { key: 'lt', style: { fontSize: 12, color: C.muted } }, '知识关系'),
        ...relatedClaims.map(claim => {
          const label = CLAIM_RELATION_LABELS[claim.relation] || claim.relation
          const polarity = KNOWLEDGE_POLARITY_LABELS[claim.polarity] ? `（${KNOWLEDGE_POLARITY_LABELS[claim.polarity]}）` : ''
          const state = claim.status !== 'to_verify' ? `（${KNOWLEDGE_STATUS_LABELS[claim.status]}）` : ''
          return h('span', { key: claim.id }, `${knowledgeLabelOf(claim.from)} —${label}${polarity}→ ${knowledgeLabelOf(claim.to)}${state}`)
        }),
      ]) : null,
      knowledgeConflictCount ? h(Notice, { key: 'conflict', tone: 'warn', icon: 'shield' },
        `该结论存在 ${knowledgeConflictCount} 组方向或极性不一致的并列记录（例如「促进」与「抑制」并存）。自动沉淀不裁决冲突，均保留待人工核验。`) : null,
      (selectedKnowledge.evidenceIds || []).length ? h('div', { key: 'evidence', style: { display: 'grid', gap: 4, fontSize: 13 } }, [
        h('strong', { key: 'lt', style: { fontSize: 12, color: C.muted } }, '关联证据'),
        ...selectedKnowledge.evidenceIds.map(id => {
          const entry = visibleSavedEvidence.find(item => item.id === id)
          if (!entry) return h('span', { key: id, style: { color: C.muted } }, '（关联的证据条目不在当前视图，可能已被删除或属于其他项目）')
          return h('span', { key: id }, entry.title, entry.status ? `（${entry.status === 'verified' ? '已核验' : entry.status === 'unverified' ? '未核验' : entry.status}）` : '')
        }),
      ]) : null,
      selectedKnowledge.assetId ? h('div', { key: 'asset', style: { fontSize: 13 } }, [
        h('strong', { key: 'lt', style: { fontSize: 12, color: C.muted } }, '沉淀到灵感资产：'),
        visibleAssets.find(item => item.id === selectedKnowledge.assetId)?.title || selectedKnowledge.assetId,
      ]) : null,
      (selectedKnowledge.sources || []).length ? h('div', { key: 'sources', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'lt', style: { fontSize: 12, color: C.muted } }, '来源消息（自动保留的摘录）'),
        ...selectedKnowledge.sources.map((source, index) => h('div', { key: index, style: { display: 'grid', gap: 3 } }, [
          h('span', { key: 'm', style: { color: C.muted, fontSize: 12 } },
            `会话 ${source.sessionId ? source.sessionId.slice(0, 12) : '本地'} · 消息 #${source.seq ?? '?'}${source.at ? ` · ${new Date(source.at).toLocaleString('zh-CN')}` : ''}`),
          h('div', { key: 'x', style: { whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, padding: '8px 10px', border: `1px solid ${C.line}`, borderRadius: 8, background: C.surfaceAlt } }, source.excerpt || '（无摘录）'),
        ])),
      ]) : null,
      h('p', { key: 'hint', style: { margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.5 } },
        '以上内容由规则提取自动生成，全部以「待核验」起步；提取不等于正确，请以可访问的原文为准逐条核验后再引用。'),
    ]) : null,
    knowledgeBackupOpen ? h(Card, { key: 'knowledge-backup', style: { margin: '0 var(--rk-gutter) 18px', padding: 16, display: 'grid', gap: 10 } }, [
      h('strong', { key: 't', style: { fontSize: 13 } }, '粘贴此前导出的知识库 JSON 备份（增量合并：已存在的节点与关系跳过，不覆盖现有核验状态）'),
      h(Textarea, { key: 'i', value: knowledgeBackupText, onChange: setKnowledgeBackupText, rows: 5, mono: true, ariaLabel: '知识库 JSON 备份内容' }),
      h('div', { key: 'row', style: { display: 'flex', gap: 8 } }, [
        h(Button, { key: 'go', size: 'sm', variant: 'primary', disabled: !knowledgeBackupText.trim(), onClick: importKnowledgeBackup }, '恢复'),
        h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => { setKnowledgeBackupOpen(false); setKnowledgeBackupText('') } }, '取消'),
      ]),
    ]) : null,
    cleanupOpen ? h(Modal, {
      key: 'cleanup-test-projects',
      title: '清理测试课题',
      subtitle: '只删除下列明显像测试/演示/探针的课题；会同时删除本机证据文件与当前页面的本地缓存。',
      onClose: () => { if (!cleaning) setCleanupOpen(false) },
      footer: [
        h(Button, { key: 'cancel', variant: 'ghost', disabled: cleaning, onClick: () => setCleanupOpen(false) }, '取消'),
        h(Button, { key: 'go', variant: 'danger', disabled: cleaning, onClick: cleanupTestProjects }, cleaning ? '正在清理…' : '确认清理'),
      ],
    }, [
      h('p', { key: 'intro', style: { margin: 0, fontSize: 13, lineHeight: 1.6 } },
        `将删除 ${testProjects.length} 个课题、共 ${testProjectEntryCount} 条证据：`),
      h('div', { key: 'list', style: { display: 'grid', gap: 4, fontSize: 13 } },
        testProjects.map(item => h('span', { key: item.project }, `${item.project} · ${item.count} 条`))),
      h(Notice, { key: 'warning', tone: 'warn', icon: 'shield' },
        '不可撤销。真实课题（例如大麦候选基因课题）不会出现在列表里；如果某个课题其实是真实数据，请取消并改用证据库里逐条删除。'),
    ]) : null,
    exportOpen ? h(Modal, {
      key: 'export-modal',
      title: '导出证据链路快照',
      subtitle: '导出物离线可打开；确认元数据范围后再下载。',
      onClose: () => setExportOpen(false),
      footer: [
        h(Button, { key: 'cancel', variant: 'ghost', onClick: () => setExportOpen(false) }, '取消'),
        h(Button, { key: 'svg', variant: 'soft', onClick: () => exportGraph('svg') }, '导出 SVG'),
        h(Button, { key: 'html', variant: 'primary', onClick: () => exportGraph('html') }, '导出 HTML')
      ]
    }, [
      h('p', { key: 'scope', style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: C.muted } }, GRAPH_EXPORT_SCOPE),
      h('p', { key: 'count', style: { margin: '10px 0 0', fontSize: 13 } },
        `本次将导出 ${renderLimitedCount ? displayGraph.nodes.length : interactiveGraph.nodes.length} 个节点、${graph.edges.length} 条关系`
        + `${hiddenIsolatedCount ? `（另有 ${hiddenIsolatedCount} 个未关联节点未导出，可在图谱中临时显示后导出）` : ''}。`)
    ]) : null
  ]
  return embedded ? h('div', { className: 'rk-page', style: { padding: '20px var(--rk-gutter) 48px' } }, content) : h(Page, null, content)
}

export function ResearchEvidenceGraphHost({ sessionId, embedded = false, onNavigate }) {
  return h(ResearchEvidenceGraph, { sessionId, assetProvider: researchAssetProvider, embedded, onNavigate })
}
