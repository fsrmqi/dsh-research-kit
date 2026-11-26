import { fetchJsonWithRetry, fetchTextWithRetry } from './http-client.js'
import { currentExecutionSignal } from './execution-context.js'
import { createTtlCache } from './ttl-cache.js'
import { makeSourceRecord as makeSource, SHARED_SOURCE_ADAPTERS } from './source-adapters.js'

const CACHE_TTL_MS = 5 * 60_000
const CACHE_MAX = 200
const CACHE = createTtlCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX })
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

async function waitForSharedQuery(entry, signal) {
  entry.waiters += 1
  let onAbort
  try {
    if (!signal) return await entry.promise
    signal.throwIfAborted()
    return await Promise.race([
      entry.promise,
      new Promise((resolve, reject) => {
        onAbort = () => reject(signal.reason || new DOMException('请求已取消。', 'AbortError'))
        signal.addEventListener('abort', onAbort, { once: true })
      }),
    ])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
    entry.waiters -= 1
    if (entry.waiters === 0 && !entry.settled) entry.controller.abort(new DOMException('所有等待方均已取消。', 'AbortError'))
  }
}

// 按数据源计的滑动窗口（阈值由调用方按源传入）。桶数上限 100，超出直接整体清空。
//
// 注意：`dsh/database-query.js` 里也有一个 `rateLimitExceeded`，那是**另一套策略**
// （按客户端 IP 计数、有 pruneRateBuckets/evictOldestRateBucket 辅助、桶数上限 1000、
// 固定阈值 12/min），不是这份的重复实现。限流主体不同，不要为了「去重」把它们合成一个。
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
  crossref: SHARED_SOURCE_ADAPTERS.crossref,
  openalex: SHARED_SOURCE_ADAPTERS.openalex,
  'semantic-scholar': SHARED_SOURCE_ADAPTERS['semantic-scholar'],
  'europe-pmc': SHARED_SOURCE_ADAPTERS['europe-pmc'],
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
  clinicaltrials: SHARED_SOURCE_ADAPTERS.clinicaltrials,
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
  const cached = CACHE.get(key)
  if (cached) return { ...cached, cached: true }

  const callerSignal = currentExecutionSignal()
  if (inFlightQueries.has(key)) {
    const result = await waitForSharedQuery(inFlightQueries.get(key), callerSignal)
    return { ...result, shared_request: true }
  }

  const settings = sourceSettings(sourceId)
  if (rateLimitExceeded(sourceId, settings.rate_limit)) {
    const error = new Error(`数据源 "${sourceId}" 查询频率超出本地预算（每分钟 ${settings.rate_limit} 次）。请稍后重试或改用缓存结果。`)
    error.code = 'RATE_LIMITED'
    throw error
  }

  const entry = { controller: new AbortController(), promise: null, settled: false, waiters: 0 }
  entry.promise = (async () => {
    const url = authenticatedUrl(adapter.url(normalizedQuery, normalizedLimit), adapter, settings)
    const body = adapter.isXml
      ? await fetchTextWithRetry(url, { accept: 'application/xml', timeoutMs: settings.timeout_ms, headers: sourceHeaders(adapter, settings), signal: entry.controller.signal })
      : await fetchJsonWithRetry(url, { timeoutMs: settings.timeout_ms, headers: sourceHeaders(adapter, settings), signal: entry.controller.signal })
    const sources = adapter.parse(body)
    const result = {
      sources,
      total: sources.length,
      source_name: sourceId,
      availability: AVAILABILITY_MAP[sourceId] || 'unknown',
    }
    CACHE.set(key, result)
    return result
  })()

  inFlightQueries.set(key, entry)
  entry.promise.then(
    () => { entry.settled = true; if (inFlightQueries.get(key) === entry) inFlightQueries.delete(key) },
    () => { entry.settled = true; if (inFlightQueries.get(key) === entry) inFlightQueries.delete(key) },
  )
  return waitForSharedQuery(entry, callerSignal)
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
