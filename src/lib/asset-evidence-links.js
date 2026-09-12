// 资产-证据互链（ROADMAP §11 动线整合第一切片 / P5）：纯逻辑层。
//
// link 是「用户显式确认」的支撑关系（灵感资产 ↔ 证据条目），与自动沉淀的机器链
// （knowledge-store 节点上的 assetId / evidenceIds）语义分层：机器链是提取事实，
// 这里的 link 是用户所有的持久关联。数据落证据库侧的 IndexedDB link 表
// （见 evidence-vault-store），不扩展 vendored asset provider 契约。
//
// 硬纪律：候选只推导、不自动建边——所有建立动作都由用户勾选确认。

// 稳定 id：同一对端点天然去重（重复建立返回既有记录而不是第二行）。
export function assetEvidenceLinkId(assetId, evidenceId) {
  return `asset-evidence:${String(assetId || '')}::${String(evidenceId || '')}`
}

// 规范化 + 校验：端点缺失直接抛错（调用方不得入库悬空 link）。
// 有意不存标题：标题随两端数据源实时解析，避免改名后的陈旧副本。
export function normalizeAssetEvidenceLink({ assetId, evidenceId, project = '', createdAt = 0 } = {}) {
  const aid = String(assetId || '').trim()
  const eid = String(evidenceId || '').trim()
  if (!aid) throw new Error('assetId 不能为空')
  if (!eid) throw new Error('evidenceId 不能为空')
  return {
    id: assetEvidenceLinkId(aid, eid),
    assetId: aid,
    evidenceId: eid,
    project: String(project || ''),
    createdAt: Number(createdAt) || 0,
  }
}

// 图谱边：只输出形状合法的 link；端点不存在的边由 buildEvidenceGraph 末尾的
// 边过滤自然剔除（两处各自兜底，语义一致）。属性名随图谱核心约定为 kind。
export function assetEvidenceGraphEdges(links = []) {
  const rows = Array.isArray(links) ? links : []
  const edges = []
  for (const row of rows) {
    if (!row?.assetId || !row?.evidenceId) continue
    edges.push({ from: `asset:${row.assetId}`, to: `evidence:${row.evidenceId}`, kind: 'supports' })
  }
  return edges
}

// 候选推导（入口 A 的数据源）：三个信号源，分数排序、确定性输出、有界截断。
//   A. 知识链种子（分数 6）：自动沉淀把同一条知识同时关联了本资产与某证据——
//      同节点上的 (assetId, evidenceId) 配对是最强信号，权重压过同项目+标签的叠加
//      （2+2+共享数），跨项目也成立（研究跨项目）；
//   B. 同项目（分数 2）：证据与资产同属当前项目；
//   C. 标签重合（分数 2 + 每个共同标签 +1）：仅同项目内参与。
// 已建立关联的端点、无 id 的条目一律排除。
export function deriveAssetEvidenceCandidates({ asset, evidenceEntries = [], knowledgeNodes = [], existingLinks = [], limit = 8 } = {}) {
  const aid = String(asset?.id || '').trim()
  if (!aid) return []
  const assetTags = new Set((Array.isArray(asset?.tags) ? asset.tags : []).map(tag => String(tag)))
  const linkedEvidenceIds = new Set(
    (Array.isArray(existingLinks) ? existingLinks : [])
      .filter(row => row?.assetId === aid)
      .map(row => String(row.evidenceId)),
  )
  // 知识链种子：node.assetId 指向本资产的节点上，全部 evidenceIds。
  const seededEvidenceIds = new Set()
  for (const node of Array.isArray(knowledgeNodes) ? knowledgeNodes : []) {
    if (String(node?.assetId || '') !== aid) continue
    for (const evidenceId of Array.isArray(node?.evidenceIds) ? node.evidenceIds : []) {
      if (evidenceId) seededEvidenceIds.add(String(evidenceId))
    }
  }
  const candidates = new Map()
  const push = (entry, score, reason) => {
    const id = String(entry?.id || '')
    if (!id || linkedEvidenceIds.has(id)) return
    const current = candidates.get(id) || { evidenceId: id, title: entry.title || '未命名证据', status: entry.status || 'unverified', project: entry.project || '', score: 0, reasons: [] }
    current.score += score
    if (reason) current.reasons.push(reason)
    candidates.set(id, current)
  }
  for (const entry of Array.isArray(evidenceEntries) ? evidenceEntries : []) {
    const id = String(entry?.id || '')
    if (!id) continue
    const sameProject = asset?.project && String(entry.project || '') === String(asset.project)
    if (seededEvidenceIds.has(id)) push(entry, 6, '知识链同源（自动沉淀已同时关联）')
    if (sameProject) push(entry, 2, '同项目')
    if (sameProject && assetTags.size) {
      const shared = (Array.isArray(entry.tags) ? entry.tags : []).map(String).filter(tag => assetTags.has(tag))
      if (shared.length) push(entry, 2 + shared.length, `共同标签：${shared.join('、')}`)
    }
  }
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'))
    .slice(0, Math.max(1, Number(limit) || 8))
    .map(row => ({ ...row, reasons: [...new Set(row.reasons)] }))
}
