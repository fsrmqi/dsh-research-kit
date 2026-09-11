// 研究证据图谱纯逻辑：只保留稳定标识符、公开来源链接和资产关系，
// 不保存检索词、原始文件、Prompt 正文或完整查询结果。
export function buildEvidenceGraph({ resources = [], workflows = [], queries = [], assets = [], savedEvidence = [], plans = [] } = {}) {
  const nodes = new Map()
  const edges = []
  const add = node => { if (node?.id && !nodes.has(node.id)) nodes.set(node.id, node) }
  const link = (from, to, kind) => { if (from && to && from !== to) edges.push({ from, to, kind }) }

  for (const resource of resources) add({ id: `resource:${resource.id}`, kind: resource.type === 'database' ? 'database' : 'skill', label: resource.name, detail: resource.description })
  for (const workflow of workflows) {
    add({ id: `workflow:${workflow.id}`, kind: 'workflow', label: workflow.name || workflow.id, detail: workflow.at ? new Date(workflow.at).toLocaleString('zh-CN') : '' })
    for (const resourceId of workflow.resourceIds || []) link(`workflow:${workflow.id}`, `resource:${resourceId}`, 'uses')
  }
  for (const plan of plans) {
    const planId = `plan:${plan.id}`
    add({ id: planId, kind: 'plan', label: `${plan.name || plan.id} 计划`, detail: `${(plan.stages || []).filter(stage => stage.done).length}/${(plan.stages || []).length} 阶段已确认` })
    link(planId, `workflow:${plan.id}`, 'plans')
    for (const [index, stage] of (plan.stages || []).entries()) {
      const stageId = `${planId}:stage:${index}`
      add({ id: stageId, kind: 'stage', label: stage.label, detail: stage.done ? '用户已确认完成' : '待人工确认' })
      link(stageId, planId, stage.done ? 'confirmed-stage' : 'planned-stage')
    }
  }
  for (const query of queries) {
    const queryId = `query:${query.id}`
    add({ id: queryId, kind: query.mode === 'agent' ? 'agent-query' : 'query', label: query.databaseName || query.databaseId, detail: query.at ? new Date(query.at).toLocaleString('zh-CN') : '' })
    link(queryId, `resource:${query.databaseId}`, 'queries')
    for (const source of query.sources || []) {
      const sourceId = `source:${source.id || source.url}`
      add({ id: sourceId, kind: 'source', label: source.title || source.url || '候选来源', detail: source.meta || source.url || '' })
      link(queryId, sourceId, 'returns')
    }
  }
  for (const asset of assets) {
    const assetId = `asset:${asset.id}`
    add({ id: assetId, kind: 'asset', label: asset.title || '未命名研究资产', detail: asset.epistemicStatus || asset.verification?.status || '' })
    if (asset.parentId) link(assetId, `asset:${asset.parentId}`, 'derives')
    for (const related of asset.relatedIds || []) link(assetId, String(related).startsWith('evidence:') ? String(related) : `asset:${related}`, 'relates')
  }
  for (const entry of savedEvidence) {
    const evidenceId = `evidence:${entry.id}`
    add({ id: evidenceId, kind: 'evidence', label: entry.title || '未命名证据', detail: `${entry.sourceDatabase || '来源未提供'} · ${entry.identifier || '无稳定标识符'} · ${entry.status || 'unverified'}` })
    const database = resources.find(resource => resource.type === 'database' && resource.name === entry.sourceDatabase)
    if (database) link(evidenceId, `resource:${database.id}`, 'saved-from')
    for (const query of queries) for (const source of query.sources || []) {
      const sameUrl = entry.url && source.url && entry.url === source.url
      const sameIdentifier = entry.identifier && source.id && String(entry.identifier) === String(source.id)
      if (sameUrl || sameIdentifier) link(evidenceId, `source:${source.id || source.url}`, 'saved-copy')
    }
  }
  return { nodes: [...nodes.values()], edges: edges.filter(edge => nodes.has(edge.from) && nodes.has(edge.to)) }
}

export const EVIDENCE_NODE_COLORS = {
  database: '#0f766e', skill: '#7c3aed', workflow: '#2563eb', query: '#b45309', 'agent-query': '#b45309', source: '#15803d', asset: '#52606d', evidence: '#be123c', plan: '#0e7490', stage: '#64748b'
}

// ── 布局 ──────────────────────────────────────────────────────────────────────
// 分列语义：资源在最左（0），已保存证据在最右（4）。kind → 列号是固定映射，
// 不随图的形状变化，否则同一批节点会因新边出现而整体换列。
export const GRAPH_NODE_WIDTH = 136
export const GRAPH_NODE_HEIGHT = 54
const GRAPH_COLUMN_OF_KIND = { database: 0, skill: 0, workflow: 1, plan: 2, stage: 3, 'agent-query': 2, query: 2, source: 3, asset: 3, evidence: 4 }
const GRAPH_COLUMN_GAP = 220
const GRAPH_ROW_GAP = 82
const GRAPH_ORIGIN_X = 70
const GRAPH_ORIGIN_Y = 58
const GRAPH_MARGIN = 24

// 确定性分列布局。同一列内按 **id 字典序** 排列，而不是沿用输入数组顺序——
// 这是本函数与「按遍历顺序填行」的关键区别：新增一个节点只让同列中排在它后面的
// 节点顺延，不会让已有节点整体跳位（节点重排）；且同一份图重复布局必得完全相同
// 的结果（有回归测试钉住这两个性质）。
export function layoutEvidenceGraph(graph = {}, options = {}) {
  const columnGap = options.columnGap ?? GRAPH_COLUMN_GAP
  const rowGap = options.rowGap ?? GRAPH_ROW_GAP
  const byColumn = new Map()
  for (const node of graph.nodes || []) {
    const column = GRAPH_COLUMN_OF_KIND[node.kind] ?? 3
    if (!byColumn.has(column)) byColumn.set(column, [])
    byColumn.get(column).push(node)
  }
  const ordered = [...byColumn.keys()].sort((a, b) => a - b)
  const nodes = []
  let rows = 0
  let maxColumn = 0
  for (const column of ordered) {
    const items = byColumn.get(column).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    rows = Math.max(rows, items.length)
    maxColumn = Math.max(maxColumn, column)
    items.forEach((node, row) => {
      nodes.push({ ...node, column, row, x: GRAPH_ORIGIN_X + column * columnGap, y: GRAPH_ORIGIN_Y + row * rowGap })
    })
  }
  const columns = ordered.length ? maxColumn + 1 : 0
  return {
    nodes,
    columns,
    rows,
    width: columns ? GRAPH_ORIGIN_X + maxColumn * columnGap + GRAPH_NODE_WIDTH / 2 + GRAPH_MARGIN : GRAPH_ORIGIN_X * 2 + GRAPH_NODE_WIDTH,
    height: (rows ? GRAPH_ORIGIN_Y + (rows - 1) * rowGap + GRAPH_NODE_HEIGHT : GRAPH_ORIGIN_Y + GRAPH_NODE_HEIGHT) + GRAPH_MARGIN
  }
}

// ── 端口路由 ──────────────────────────────────────────────────────────────────
// 同一节点上的多条边平分节点高度取不同出口 y。若都从节点中点出发，同源边会先
// 重叠成一条再散开——表现为「边穿过节点」与「看不出谁连谁」。
function graphPortY(node, index, total) {
  const center = node.y + GRAPH_NODE_HEIGHT / 2
  if (total <= 1) return center
  const usable = GRAPH_NODE_HEIGHT - 20
  return node.y + 10 + (usable * index) / (total - 1)
}

const graphEdgeOrder = (a, b) => {
  const left = `${a.from}|${a.to}|${a.kind}`
  const right = `${b.from}|${b.to}|${b.kind}`
  return left < right ? -1 : left > right ? 1 : 0
}

// 把每条边解析成带端点坐标与三次贝塞尔路径的「路线」。端口分配依赖边的稳定排序，
// 所以同一份图重复调用必得相同路线（确定性同样是回归断言的对象）。
export function routeEvidenceEdges(graph = {}, layout = {}) {
  const byId = new Map((layout.nodes || []).map(node => [node.id, node]))
  const outgoing = new Map()
  const incoming = new Map()
  for (const edge of graph.edges || []) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, [])
    outgoing.get(edge.from).push(edge)
    if (!incoming.has(edge.to)) incoming.set(edge.to, [])
    incoming.get(edge.to).push(edge)
  }
  for (const list of outgoing.values()) list.sort(graphEdgeOrder)
  for (const list of incoming.values()) list.sort(graphEdgeOrder)
  const routes = []
  for (const edge of graph.edges || []) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const outList = outgoing.get(edge.from) || [edge]
    const inList = incoming.get(edge.to) || [edge]
    const forward = from.x <= to.x
    const x1 = forward ? from.x + GRAPH_NODE_WIDTH / 2 : from.x - GRAPH_NODE_WIDTH / 2
    const x2 = forward ? to.x - GRAPH_NODE_WIDTH / 2 : to.x + GRAPH_NODE_WIDTH / 2
    const y1 = graphPortY(from, outList.indexOf(edge), outList.length)
    const y2 = graphPortY(to, inList.indexOf(edge), inList.length)
    const bend = Math.max(36, Math.abs(x2 - x1) * 0.4)
    const c1 = forward ? x1 + bend : x1 - bend
    const c2 = forward ? x2 - bend : x2 + bend
    routes.push({
      key: `${edge.from}->${edge.to}:${edge.kind}`,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      forward,
      x1, y1, x2, y2,
      d: `M${x1},${y1} C${c1},${y1} ${c2},${y2} ${x2},${y2}`
    })
  }
  return routes
}

// ── 邻域与路径 ────────────────────────────────────────────────────────────────
// 上游 = 顺着箭头回溯（谁指向我）；下游 = 顺着箭头前进。返回含起点自身的 id 集合。
export function evidenceNeighborhood(graph = {}, nodeId, direction = 'downstream') {
  const adjacency = new Map()
  const push = (key, value) => {
    if (!adjacency.has(key)) adjacency.set(key, [])
    adjacency.get(key).push(value)
  }
  for (const edge of graph.edges || []) {
    if (direction === 'upstream') push(edge.to, edge.from)
    else if (direction === 'both') { push(edge.to, edge.from); push(edge.from, edge.to) }
    else push(edge.from, edge.to)
  }
  const seen = new Set([nodeId])
  const queue = [nodeId]
  while (queue.length) {
    const current = queue.shift()
    for (const next of adjacency.get(current) || []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

// 两点路径：**忽略箭头方向**做最短路径。用户问的是「这两个东西怎么连上的」，
// 逆着箭头回溯是合法答案；若只沿箭头走，多数两点之间会「无路径」。
export function findEvidencePath(graph = {}, fromId, toId) {
  if (!fromId || !toId) return []
  if (fromId === toId) return [fromId]
  const adjacency = new Map()
  for (const edge of graph.edges || []) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, [])
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, [])
    adjacency.get(edge.from).push(edge.to)
    adjacency.get(edge.to).push(edge.from)
  }
  const previous = new Map([[fromId, null]])
  const queue = [fromId]
  while (queue.length) {
    const current = queue.shift()
    if (current === toId) break
    for (const next of adjacency.get(current) || []) {
      if (previous.has(next)) continue
      previous.set(next, current)
      queue.push(next)
    }
  }
  if (!previous.has(toId)) return []
  const path = []
  for (let cursor = toId; cursor != null; cursor = previous.get(cursor)) path.unshift(cursor)
  return path
}

// ── URL 视图状态 ──────────────────────────────────────────────────────────────
// 只编码「看什么」：焦点、范围模式、路径两端、缩放。**绝不编码任何证据内容**——
// 链接会被分享，标题与标识符都不该进去。
export const GRAPH_SCALE_RANGE = { min: 0.4, max: 2.5 }
const GRAPH_MODES = ['all', 'upstream', 'downstream', 'path']

export function clampGraphScale(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.min(GRAPH_SCALE_RANGE.max, Math.max(GRAPH_SCALE_RANGE.min, number))
}

export function encodeGraphView(state = {}) {
  const params = new URLSearchParams()
  const focus = state.focus || ''
  const mode = GRAPH_MODES.includes(state.mode) ? state.mode : 'all'
  const scale = clampGraphScale(state.scale ?? 1)
  if (focus) params.set('focus', focus)
  if (mode !== 'all') params.set('mode', mode)
  if (mode === 'path') {
    if (state.from) params.set('from', state.from)
    if (state.to) params.set('to', state.to)
  }
  if (scale !== 1) params.set('scale', String(scale))
  const query = params.toString()
  return query ? `#research-evidence-graph&${query}` : '#research-evidence-graph'
}

export function decodeGraphView(hash = '') {
  const raw = String(hash).replace(/^#/, '')
  const separator = raw.indexOf('&')
  const params = new URLSearchParams(separator >= 0 ? raw.slice(separator + 1) : '')
  const mode = params.get('mode')
  return {
    focus: params.get('focus') || '',
    mode: GRAPH_MODES.includes(mode) ? mode : 'all',
    from: params.get('from') || '',
    to: params.get('to') || '',
    scale: clampGraphScale(params.get('scale') ?? 1)
  }
}
