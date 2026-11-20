// 文件端同一课题内的来源标识，供文件写入和客户端同步共用。
export function fileEvidenceSourceIdentity(entry) {
  if (entry.identifier_type === 'doi') return `doi:${String(entry.identifier || '').toLowerCase()}`
  if (entry.identifier_type === 'pmid') return `pmid:${String(entry.identifier || '').toLowerCase()}`
  if (entry.identifier_type === 'pmcid') return `pmcid:${String(entry.identifier || '').toLowerCase()}`
  if (entry.identifier_type === 'arxiv') return `arxiv:${String(entry.identifier || '').toLowerCase()}`
  if (entry.identifier_type === 'nct') return `nct:${String(entry.identifier || '').toLowerCase()}`
  if (entry.url) return `url:${String(entry.url).replace(/\/$/, '').toLowerCase()}`
  if (entry.identifier_type === 'none' && entry.identifier) return `identifier:${String(entry.identifier).toLowerCase()}`
  return `title:${String(entry.title || '').slice(0, 80).toLowerCase()}`
}
