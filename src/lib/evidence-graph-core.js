// 研究证据图谱纯逻辑：只保留稳定标识符、公开来源链接和资产关系，
// 不保存检索词、原始文件、Prompt 正文或完整查询结果。
export function buildEvidenceGraph({ resources = [], workflows = [], queries = [], assets = [], savedEvidence = [] } = {}) {
  const nodes = new Map()
  const edges = []
  const add = node => { if (node?.id && !nodes.has(node.id)) nodes.set(node.id, node) }
  const link = (from, to, kind) => { if (from && to && from !== to) edges.push({ from, to, kind }) }

  for (const resource of resources) add({ id: `resource:${resource.id}`, kind: resource.type === 'database' ? 'database' : 'skill', label: resource.name, detail: resource.description })
  for (const workflow of workflows) {
    add({ id: `workflow:${workflow.id}`, kind: 'workflow', label: workflow.name || workflow.id, detail: workflow.at ? new Date(workflow.at).toLocaleString('zh-CN') : '' })
    for (const resourceId of workflow.resourceIds || []) link(`workflow:${workflow.id}`, `resource:${resourceId}`, 'uses')
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
  database: '#0f766e', skill: '#7c3aed', workflow: '#2563eb', query: '#b45309', 'agent-query': '#b45309', source: '#15803d', asset: '#52606d', evidence: '#be123c'
}
