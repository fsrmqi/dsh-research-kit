import { crossrefUrl, fetchJsonWithRetry, fetchTextWithRetry } from './http-client.js'

const CACHE = new Map()
const CACHE_TTL_MS = 5 * 60_000
const CACHE_MAX = 200
const RATE_LIMIT_WINDOW_MS = 60_000
const inFlightQueries = new Map()
const rateBuckets = new Map()

const SOURCE_ENV_KEYS = {
  crossref: 'CROSSREF',
  openalex: 'OPENALEX',
  'semantic-scholar': 'SEMANTIC_SCHOLAR',
  'europe-pmc': 'EUROPE_PMC',
  arxiv: 'ARXIV',
  clinicaltrials: 'CLINICALTRIALS',
}

function positiveInt(value, fallback, max = 120) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.min(Math.floor(number), max) : fallback
}

function sourceSettings(sourceId, env = process.env) {
  const envKey = SOURCE_ENV_KEYS[sourceId] || sourceId.replaceAll('-', '_').toUpperCase()
  const timeoutMs = positiveInt(
    env[`DSH_RESEARCH_KIT_SOURCE_${envKey}_TIMEOUT_MS`] || env.DSH_RESEARCH_KIT_SOURCE_TIMEOUT_MS,
    15_000,
    60_000,
  )
  const rateLimit = positiveInt(
    env[`DSH_RESEARCH_KIT_SOURCE_${envKey}_RATE_LIMIT`] || env.DSH_RESEARCH_KIT_SOURCE_RATE_LIMIT,
    12,
    120,
  )
  const apiKey = String(
    env[`DSH_RESEARCH_KIT_SOURCE_${envKey}_API_KEY`]
    || env[`${envKey}_API_KEY`]
    || (envKey === 'EUROPE_PMC' ? env.PUBMED_API_KEY : '')
    || ''
  ).trim()
  return { env_key: envKey, timeout_ms: timeoutMs, rate_limit: rateLimit, api_key: apiKey }
}

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

function rateLimitExceeded(sourceId, rateLimit) {
  const now = Date.now()
  const bucket = (rateBuckets.get(sourceId) || []).filter(at => now - at < RATE_LIMIT_WINDOW_MS)
  if (bucket.length >= rateLimit) {
    rateBuckets.set(sourceId, bucket)
    return true
  }
  bucket.push(now)
  rateBuckets.set(sourceId, bucket)
  while (rateBuckets.size > 100) rateBuckets.delete(rateBuckets.keys().next().value)
  return false
}

function authenticatedUrl(url, adapter, settings) {
  if (!settings.api_key || !adapter.auth_query) return url
  const parsed = new URL(url)
  parsed.searchParams.set(adapter.auth_query, settings.api_key)
  return parsed.toString()
}

function sourceHeaders(adapter, settings) {
  return settings.api_key && adapter.auth_header ? { [adapter.auth_header]: settings.api_key } : {}
}

const ADAPTERS = {
  crossref: {
    url: (q, n) => crossrefUrl(`https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${n}&select=DOI,title,author,published-print,published-online,container-title,URL,abstract`),
    parse: data => (data.message?.items || []).map(item => makeSource(
      item.DOI, item.title?.[0], item.URL || `https://doi.org/${item.DOI}`,
      [item.author?.[0]?.family, item['container-title']?.[0], item['published-print']?.['date-parts']?.[0]?.[0] || item['published-online']?.['date-parts']?.[0]?.[0]].filter(Boolean).join(' · '),
      typeof item.abstract === 'string' ? item.abstract.replace(/<[^>]+>/g, '').slice(0, 420) : ''
    )),
  },
  openalex: {
    auth_query: 'api_key',
    url: (q, n) => `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${n}`,
    parse: data => (data.results || []).map(item => makeSource(
      item.id, item.title, item.doi || item.id,
      [item.publication_year, item.primary_location?.source?.display_name, item.cited_by_count ? `被引 ${item.cited_by_count}` : ''].filter(Boolean).join(' · ')
    )),
  },
  'semantic-scholar': {
    auth_header: 'x-api-key',
    url: (q, n) => `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=${n}&fields=title,year,authors,venue,abstract,url,citationCount,externalIds`,
    parse: data => (data.data || []).map(item => makeSource(
      item.paperId || item.externalIds?.DOI, item.title,
      item.url || (item.externalIds?.DOI ? `https://doi.org/${item.externalIds.DOI}` : ''),
      [item.year, item.venue, item.citationCount ? `被引 ${item.citationCount}` : ''].filter(Boolean).join(' · '),
      item.abstract || ''
    )),
  },
  'europe-pmc': {
    auth_query: 'apiKey',
    url: (q, n) => `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=${n}&query=${encodeURIComponent(q)}`,
    parse: data => (data.resultList?.result || []).map(item => makeSource(
      item.pmid || item.id, item.title,
      item.pmid ? `https://europepmc.org/article/MED/${item.pmid}` : `https://europepmc.org/article/${item.source || 'MED'}/${item.id}`,
      [item.authorString, item.journalTitle, item.pubYear].filter(Boolean).join(' · '),
      item.abstractText || ''
    )),
  },
  arxiv: {
    url: (q, n) => `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=${n}`,
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
      fallback_guidance: `数据源 "${sourceId}" 不在本插件的直查适配器中。请通过宿主的 Web 或已连接 MCP 能力查询，并将结果通过 research_evidence_save 保存。`,
    }
  }

  const normalizedQuery = String(query || '').trim().slice(0, 300)
  if (!normalizedQuery) throw new Error('查询词不能为空。')
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 5, 10))
  const key = cacheKey(sourceId, normalizedQuery, normalizedLimit)
  const cached = cacheGet(key)
  if (cached) return { ...cached, cached: true }

  if (inFlightQueries.has(key)) {
    const result = await inFlightQueries.get(key)
    return { ...result, shared_request: true }
  }

  const settings = sourceSettings(sourceId)
  if (rateLimitExceeded(sourceId, settings.rate_limit)) {
    const error = new Error(`数据源 "${sourceId}" 查询频率超出本地预算（每分钟 ${settings.rate_limit} 次）。请稍后重试或改用缓存结果。`)
    error.code = 'RATE_LIMITED'
    throw error
  }

  const request = (async () => {
    const url = authenticatedUrl(adapter.url(normalizedQuery, normalizedLimit), adapter, settings)
    const body = adapter.isXml
      ? await fetchTextWithRetry(url, { accept: 'application/xml', timeoutMs: settings.timeout_ms, headers: sourceHeaders(adapter, settings) })
      : await fetchJsonWithRetry(url, { timeoutMs: settings.timeout_ms, headers: sourceHeaders(adapter, settings) })
    const sources = adapter.parse(body)
    const result = {
      sources,
      total: sources.length,
      source_name: sourceId,
      availability: AVAILABILITY_MAP[sourceId] || 'unknown',
    }
    cacheSet(key, result)
    return result
  })()

  inFlightQueries.set(key, request)
  try {
    return await request
  } finally {
    inFlightQueries.delete(key)
  }
}

function listAvailableSources() {
  return Object.keys(ADAPTERS).map(id => {
    const settings = sourceSettings(id)
    return {
      id,
      availability: AVAILABILITY_MAP[id] || 'unknown',
      timeout_ms: settings.timeout_ms,
      rate_limit_per_minute: settings.rate_limit,
      api_key_configured: Boolean(settings.api_key),
    }
  })
}

export { querySource, listAvailableSources, sourceSettings }
