// 只读质量审计：提示人工复核，不自动合并、删除或宣称来源失效。
const sourceKey = item => {
  const kind = String(item?.identifierKind || '').toLowerCase()
  const identifier = String(item?.identifier || '').trim().toLowerCase()
  if (identifier && kind !== 'none') return `${kind}:${identifier}`
  const url = String(item?.url || '').trim().toLowerCase().replace(/\/$/, '')
  return url ? `url:${url}` : ''
}

export function auditResearchDataQuality({ evidence = [], links = [], assetIds = null } = {}) {
  const entries = Array.isArray(evidence) ? evidence : []
  const relationships = Array.isArray(links) ? links : []
  const evidenceIds = new Set(entries.map(item => item.id))
  const knownAssets = assetIds ? new Set(assetIds) : null
  const bySource = new Map()
  for (const item of entries) {
    const key = sourceKey(item)
    if (!key) continue
    if (!bySource.has(key)) bySource.set(key, [])
    bySource.get(key).push(item)
  }
  const duplicateGroups = [...bySource.values()].filter(rows => rows.length > 1)
    .map(rows => ({ key: sourceKey(rows[0]), ids: rows.map(item => item.id), projects: [...new Set(rows.map(item => item.project || '未归属'))] }))
  const orphanLinks = relationships.filter(link => !evidenceIds.has(link.evidenceId)
    || (knownAssets && !knownAssets.has(String(link.assetId))))
  return {
    total: entries.length,
    missingIdentifier: entries.filter(item => !item.identifier || item.identifierKind === 'none').length,
    unverified: entries.filter(item => item.status === 'unverified').length,
    staleOrMissing: entries.filter(item => item.status === 'stale' || item.sourceCheck?.status === 'not_found').length,
    duplicateGroups,
    orphanLinks,
    assetSideChecked: knownAssets !== null,
  }
}
