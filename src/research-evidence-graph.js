import React from 'react'
import { h, C } from './theme.js'
import {
  Page, PageHead, Toolbar, Button, Card, EmptyState, Notice, Segmented, Badge, Select,
} from './ui.js'
import { EvidenceGraphDetailPanels } from './evidence-graph-panels.js'
import { EvidenceGraphCanvas } from './evidence-graph-canvas.js'
import {
  GRAPH_EXPORT_SCOPE, graphKindColor, nodeStrokeColor,
  exportEvidenceGraphFile, knowledgeBackupStamp, downloadKnowledgeJson,
} from './evidence-graph-export.js'
import {
  buildEvidenceGraph, splitEvidenceGraphByConnectivity, summarizeEvidenceProjects,
  layoutEvidenceGraph, routeEvidenceEdges, evidenceNeighborhood, findEvidencePath,
  encodeGraphView, decodeGraphView, clampGraphScale,
  GRAPH_SCALE_RANGE
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
import { lastDepositionSummary, depositLatestAssistantMessage } from './knowledge-deposition.js'
import {
  KNOWLEDGE_KIND_LABELS, KNOWLEDGE_ENTITY_LABELS, KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS,
  KNOWLEDGE_POLARITY_LABELS, CLAIM_RELATION_LABELS,
} from './lib/knowledge-extract.js'
import { downloadBlob, downloadText, downloadJsonFile } from './lib/download.js'
import { researchCitationHref } from './lib/answer-evidence.js'
import { researchAssetProvider } from '../dsh/prompt-studio-glue.js'

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
const GRAPH_SCOPE_MODES = [
  { value: 'all', label: '全部' },
  { value: 'session', label: '本会话' },
  { value: 'persistent', label: '持久沉淀' },
]

const GRAPH_RENDER_NODE_LIMIT = 300

export function ResearchEvidenceGraph({ sessionId, assetProvider, embedded = false, onNavigate, focusNodeId = '' }) {
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

  // 视图状态写回链接：只写焦点、范围模式、路径两端与缩放，不写任何证据内容。
  React.useEffect(() => {
    if (typeof window !== 'undefined') window.history.replaceState(null, '', encodeGraphView(view))
  }, [view])

  const applyView = React.useCallback(patch => setView(previous => ({ ...previous, ...patch })), [])
  const appliedNodeFocus = React.useRef('')
  React.useEffect(() => {
    if (!focusNodeId || appliedNodeFocus.current === focusNodeId) return
    appliedNodeFocus.current = focusNodeId
    if (String(focusNodeId).startsWith(KNOWLEDGE_NODE_ID_PREFIX)) setSelectedKnowledgeId(focusNodeId)
    else if (String(focusNodeId).startsWith('evidence:')) setSelectedEvidenceNodeId(String(focusNodeId).slice('evidence:'.length))
    applyView({ focus: focusNodeId })
  }, [focusNodeId, applyView])
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

  const onSelectNode = node => {
    activateNode(node.id)
    setSelectedKnowledgeId(node.id.startsWith(KNOWLEDGE_NODE_ID_PREFIX) ? node.id : '')
    if (node.kind === 'evidence') setSelectedEvidenceNodeId(node.id.replace('evidence:', ''))
    else setSelectedEvidenceNodeId('')
    setConfirmDeleteEvidence(false)
  }
  const onDoubleClickNode = node => {
    if (node.kind === 'evidence') setSelectedEvidenceNodeId(node.id.replace('evidence:', ''))
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

  const exportGraph = format => {
    // 导出与当前视图一致：默认不含未关联节点；若因渲染上限少画了节点，导出仍给出全部有关联部分。
    const exportSource = renderLimitedCount ? displayGraph : interactiveGraph
    const exportLayout = layoutEvidenceGraph(exportSource)
    const exportRoutes = routeEvidenceEdges(exportSource, exportLayout)
    exportEvidenceGraphFile(format, exportLayout, exportRoutes)
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
      lead: '展示当前课题的来源、论断与知识关联，点击节点可追溯原文。',
      actions: [
        h(Button, { key: 'motion', variant: 'soft', onClick: () => setFlowing(value => !value) }, flowing ? '暂停链路流动' : '播放链路流动'),
        h(Button, { key: 'export', variant: 'soft', onClick: () => setExportOpen(true) }, '导出快照'),
        h(Button, { key: 'link', variant: 'ghost', onClick: copyViewLink }, '复制视图链接'),
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
        lastDeposition && lastDeposition.sessionId === String(sessionId) ? h('span', {
          key: 'last-deposition',
          title: `会话 ${lastDeposition.sessionId || '本地'} 消息 #${lastDeposition.seq ?? '?'}`,
        }, `最近沉淀：+${lastDeposition.addedNodes} 节点 · +${lastDeposition.addedClaims} 关系 · 证据 ${lastDeposition.savedEvidence} · 资产 ${lastDeposition.savedAssets}（消息 #${lastDeposition.seq ?? '?'}）`) : null,
      ]) : null,
    notice ? h(Notice, { key: 'notice', tone: 'info', style: { margin: '0 var(--rk-gutter) 12px' } }, notice) : null,
    graph.nodes.length
      ? (hasCanvas
        ? h(Card, { key: 'canvas', style: { margin: '18px var(--rk-gutter) 14px', padding: 12, background: C.surfaceAlt } },
            h(EvidenceGraphCanvas, {
              layout, routes, view, pan, setPan, scale, clampPanFor, zoomBy,
              flowing, highlighted, onSelectNode, onDoubleClickNode,
            }))
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
          ? '调整上方的节点范围或课题筛选即可查看其他范围。'
          : '先查文献或保存证据与灵感，图谱会自动建立关联。',
        action: !(scope !== 'all' || projectFilter) && typeof onNavigate === 'function'
          ? h(Button, { variant: 'primary', size: 'sm', onClick: () => onNavigate('catalog', { type: 'database' }) }, '去查文献')
          : null,
      }),
    h(EvidenceGraphDetailPanels, {
      key: 'detail-panels',
      selectedEvidenceEntry, nodeStrokeColor, setSelectedEvidenceNodeId,
      confirmDeleteEvidence, setConfirmDeleteEvidence, vault, setNotice,
      selectedKnowledge, graphKindColor, updateKnowledgeStatus, setSelectedKnowledgeId,
      relatedClaims, knowledgeLabelOf, knowledgeConflictCount, visibleSavedEvidence, visibleAssets,
      knowledgeBackupOpen, setKnowledgeBackupOpen, knowledgeBackupText, setKnowledgeBackupText, importKnowledgeBackup,
      cleanupOpen, setCleanupOpen, cleaning, cleanupTestProjects, testProjects, testProjectEntryCount,
      exportOpen, setExportOpen, exportGraph, exportScopeNote: GRAPH_EXPORT_SCOPE,
      renderLimitedCount, displayGraph, interactiveGraph, graph, hiddenIsolatedCount,
    }),
  ]
  return embedded ? h('div', { className: 'rk-page', style: { padding: '20px var(--rk-gutter) 48px' } }, content) : h(Page, null, content)
}

export function ResearchEvidenceGraphHost({ sessionId, embedded = false, onNavigate, focusNodeId = '' }) {
  return h(ResearchEvidenceGraph, { sessionId, assetProvider: researchAssetProvider, embedded, onNavigate, focusNodeId })
}
