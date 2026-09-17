
const CACHE = new Map()
const CACHE_TTL_MS = 5 * 60_000
const CACHE_MAX = 200

function cacheKey(dbId, query, limit) { return `${dbId}::${query.trim()}::${limit}` }
function cacheGet(key) {
  const hit = CACHE.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) { CACHE.delete(key); return null }
  return hit.result
}
function cacheSet(key, result) {
  CACHE.set(key, { at: Date.now(), result })
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value)
}

function clean(value, limit = 280) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function makeSource(id, title, url, meta = '', summary = '') {
  return { id: String(id || url), title: clean(title, 220) || '未命名记录', url: String(url || ''), meta: clean(meta, 180), summary: clean(summary, 420) }
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`数据源返回 HTTP ${res.status}`)
  return res.json()
}

const ADAPTERS = {
  crossref: {
    url: (q, n) => `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${n}&select=DOI,title,author,published-print,published-online,container-title,URL,abstract`,
    parse: data => (data.message?.items || []).map(item => makeSource(
      item.DOI, item.title?.[0], item.URL || `https://doi.org/${item.DOI}`,
      [item.author?.[0]?.family, item['container-title']?.[0], item['published-print']?.['date-parts']?.[0]?.[0] || item['published-online']?.['date-parts']?.[0]?.[0]].filter(Boolean).join(' · '),
      typeof item.abstract === 'string' ? item.abstract.replace(/<[^>]+>/g, '').slice(0, 420) : ''
    )),
  },
  openalex: {
    url: (q, n) => `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${n}`,
    parse: data => (data.results || []).map(item => makeSource(
      item.id, item.title, item.doi || item.id,
      [item.publication_year, item.primary_location?.source?.display_name, item.cited_by_count ? `被引 ${item.cited_by_count}` : ''].filter(Boolean).join(' · ')
    )),
  },
  'semantic-scholar': {
    url: (q, n) => `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=${n}&fields=title,year,authors,venue,abstract,url,citationCount,externalIds`,
    parse: data => (data.data || []).map(item => makeSource(
      item.paperId || item.externalIds?.DOI, item.title,
      item.url || (item.externalIds?.DOI ? `https://doi.org/${item.externalIds.DOI}` : ''),
      [item.year, item.venue, item.citationCount ? `被引 ${item.citationCount}` : ''].filter(Boolean).join(' · '),
      item.abstract || ''
    )),
  },
  'europe-pmc': {
    url: (q, n) => `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=${n}&query=${encodeURIComponent(q)}`,
    parse: data => (data.resultList?.result || []).map(item => makeSource(
      item.pmid || item.id, item.title,
      item.pmid ? `https://europepmc.org/article/MED/${item.pmid}` : `https://europepmc.org/article/${item.source || 'MED'}/${item.id}`,
      [item.authorString, item.journalTitle, item.pubYear].filter(Boolean).join(' · '),
      item.abstractText || ''
    )),
  },
  arxiv: {
    url: (q, n) => `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=${n}`,
    parse: xml => {
      const entries = String(xml).split('<entry>').slice(1)
      return entries.map(entry => {
        const id = entry.match(/<id>([^<]+)<\/id>/)?.[1] || ''
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || ''
        const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() || ''
        const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map(m => m[1].trim())
        const published = entry.match(/<published>(\d{4})/)?.[1] || ''
        return makeSource(id, title, id, [authors[0], published].filter(Boolean).join(' · '), summary)
      })
    },
    isXml: true,
  },
  clinicaltrials: {
    url: (q, n) => `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(q)}&pageSize=${n}&format=json`,
    parse: data => (data.studies || []).map(item => {
      const p = item.protocolSection || {}
      const id = p.identificationModule?.nctId
      return makeSource(id, p.identificationModule?.briefTitle,
        id ? `https://clinicaltrials.gov/study/${id}` : '',
        [p.statusModule?.overallStatus, p.designModule?.studyType].filter(Boolean).join(' · '),
        p.descriptionModule?.briefSummary || '')
    }),
  },
}

const AVAILABILITY_MAP = {
  crossref: 'available', openalex: 'available', 'semantic-scholar': 'available',
  'europe-pmc': 'available', arxiv: 'available', clinicaltrials: 'available',
}

async function querySource(sourceId, query, limit = 5) {
  const adapter = ADAPTERS[sourceId]
  if (!adapter) {
    return {
      sources: [],
      total: 0,
      source_name: sourceId,
      availability: 'requires-host-mcp',
      fallback_guidance: `数据源 "${sourceId}" 不在本插件的直查适配器中。请通过宿主的 Web 或已连接 MCP 能力查询，并将结果通过 save_evidence 保存。`,
    }
  }

  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 5, 10))
  const key = cacheKey(sourceId, query, normalizedLimit)
  const cached = cacheGet(key)
  if (cached) return { ...cached, cached: true }

  const url = adapter.url(query, normalizedLimit)
  const raw = await fetch(url, { headers: { Accept: adapter.isXml ? 'application/xml' : 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!raw.ok) throw new Error(`数据源 "${sourceId}" 返回 HTTP ${raw.status}`)
  const body = adapter.isXml ? await raw.text() : await raw.json()
  const sources = adapter.parse(body)

  const result = {
    sources,
    total: sources.length,
    source_name: sourceId,
    availability: AVAILABILITY_MAP[sourceId] || 'unknown',
  }
  cacheSet(key, result)
  return result
}

function listAvailableSources() {
  return Object.keys(ADAPTERS).map(id => ({ id, availability: AVAILABILITY_MAP[id] || 'unknown' }))
}

export { querySource, listAvailableSources }
