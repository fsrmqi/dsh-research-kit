function normalizeDoi(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s?#]+)$/i)
  return match ? { type: 'doi', value: match[1].replace(/[.;,]+$/, '').toLowerCase(), key: `doi:${match[1].replace(/[.;,]+$/, '').toLowerCase()}` } : null
}

function normalizePmid(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(?:https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)?(\d{5,8})\/?$/i)
  return match ? { type: 'pmid', value: match[1], key: `pmid:${match[1]}` } : null
}

function normalizeArxiv(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(?:https?:\/\/arxiv\.org\/abs\/)?(\d{4}\.\d{4,5}(?:v\d+)?)\/?$/i)
  return match ? { type: 'arxiv', value: match[1], key: `arxiv:${match[1].toLowerCase()}` } : null
}

function normalizeOpenAlex(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(?:https?:\/\/api\.openalex\.org\/works\/)?(W\d{2,})$/i)
  return match ? { type: 'openalex', value: match[1], key: `openalex:${match[1]}` } : null
}

function stableIdentifier(...values) {
  const normalizers = [normalizeDoi, normalizePmid, normalizeArxiv, normalizeOpenAlex]
  for (const normalize of normalizers) {
    for (const value of values) {
      const normalized = normalize(value)
      if (normalized) return normalized
    }
  }
  return null
}

export { stableIdentifier, normalizeDoi, normalizePmid, normalizeArxiv, normalizeOpenAlex }
