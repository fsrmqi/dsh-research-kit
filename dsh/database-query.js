export const DATABASE_QUERY_PATH = '/dsh-research-kit/query'

const MAX_QUERY_LENGTH = 300
const MAX_LIMIT = 10

// 查询预算与限流（进程内、重启即清零）：
//   - 缓存：同一 (database, query, limit) 5 分钟内直接返回上次结果，减少对公开 API 的重复冲击；
//   - 速率：每 IP 每分钟最多 12 次查询，超出返回 429 并提示走 Agent 查询；
//   - 缓存只保存解析后的结构化来源（标题/链接/摘要），不含任何凭据或请求头。
const CACHE_TTL_MS = 5 * 60_000
const CACHE_MAX_ENTRIES = 200
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 12

const queryCache = new Map()
const rateBuckets = new Map()

function cacheKey(databaseId, query, limit) { return `${databaseId}::${query}::${limit}` }

function cacheGet(key) {
  const hit = queryCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) { queryCache.delete(key); return null }
  return hit.result
}

function cacheSet(key, result) {
  queryCache.set(key, { at: Date.now(), result })
  while (queryCache.size > CACHE_MAX_ENTRIES) {
    const oldest = queryCache.keys().next().value
    queryCache.delete(oldest)
  }
}

// 每 IP 滑动计数：窗口内达到上限时拒绝本次查询。
function rateLimitExceeded(clientKey) {
  const now = Date.now()
  const bucket = (rateBuckets.get(clientKey) || []).filter(at => now - at < RATE_LIMIT_WINDOW_MS)
  if (bucket.length >= RATE_LIMIT_MAX_REQUESTS) { rateBuckets.set(clientKey, bucket); return true }
  bucket.push(now)
  rateBuckets.set(clientKey, bucket)
  if (rateBuckets.size > 1000) {
    for (const [key, times] of rateBuckets) {
      if (!times.some(at => now - at < RATE_LIMIT_WINDOW_MS)) rateBuckets.delete(key)
    }
  }
  return false
}

function clientKeyFor(req) {
  return String(req?.socket?.remoteAddress || req?.headers?.['x-forwarded-for'] || 'local')
}

function textBody(result) {
  if (!result || result.statusCode < 200 || result.statusCode >= 300) throw new Error(`数据源返回 HTTP ${result?.statusCode ?? '未知状态'}`)
  return String(result.body?.content || '')
}
function jsonBody(result) {
  const raw = textBody(result)
  try { return JSON.parse(raw) } catch { throw new Error('数据源返回的内容不是可解析 JSON。') }
}
function clean(value, limit = 280) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit) }
function source(id, title, url, meta = '', summary = '') { return { id: String(id || url), title: clean(title, 220) || '未命名记录', url: String(url || ''), meta: clean(meta, 180), summary: clean(summary, 420) } }

const DIRECT_ADAPTERS = {
  crossref: {
    url: (q, n) => `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${n}&select=DOI,title,author,published-print,published-online,container-title,URL`,
    parse: data => (data.message?.items || []).map(item => source(item.DOI, item.title?.[0], item.URL || `https://doi.org/${item.DOI}`, [item.author?.[0]?.family, item['container-title']?.[0], item['published-print']?.['date-parts']?.[0]?.[0] || item['published-online']?.['date-parts']?.[0]?.[0]].filter(Boolean).join(' · ')))
  },
  openalex: {
    url: (q, n) => `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${n}`,
    parse: data => (data.results || []).map(item => source(item.id, item.title, item.doi || item.id, [item.publication_year, item.primary_location?.source?.display_name, item.cited_by_count ? `被引 ${item.cited_by_count}` : ''].filter(Boolean).join(' · '), item.abstract_inverted_index ? 'OpenAlex 已返回摘要索引；请打开原文或来源核验细节。' : ''))
  },
  'semantic-scholar': {
    url: (q, n) => `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=${n}&fields=title,year,authors,venue,abstract,url,citationCount,externalIds`,
    parse: data => (data.data || []).map(item => source(item.paperId || item.externalIds?.DOI, item.title, item.url || (item.externalIds?.DOI ? `https://doi.org/${item.externalIds.DOI}` : ''), [item.year, item.venue, item.citationCount ? `被引 ${item.citationCount}` : ''].filter(Boolean).join(' · '), item.abstract))
  },
  'europe-pmc': {
    url: (q, n) => `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=${n}&query=${encodeURIComponent(q)}`,
    parse: data => (data.resultList?.result || []).map(item => source(item.pmid || item.id, item.title, item.pmid ? `https://europepmc.org/article/MED/${item.pmid}` : `https://europepmc.org/article/${item.source || 'MED'}/${item.id}`, [item.authorString, item.journalTitle, item.pubYear].filter(Boolean).join(' · '), item.abstractText))
  },
  clinicaltrials: {
    url: (q, n) => `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(q)}&pageSize=${n}&format=json`,
    parse: data => (data.studies || []).map(item => {
      const p = item.protocolSection || {}, id = p.identificationModule?.nctId
      return source(id, p.identificationModule?.briefTitle, id ? `https://clinicaltrials.gov/study/${id}` : '', [p.statusModule?.overallStatus, p.designModule?.studyType].filter(Boolean).join(' · '), p.descriptionModule?.briefSummary)
    })
  },
  openfda: {
    url: (q, n) => `https://api.fda.gov/drug/event.json?search=${encodeURIComponent(q)}&limit=${n}`,
    parse: data => (data.results || []).map((item, index) => source(`openfda-${index}`, item.patient?.drug?.[0]?.medicinalproduct || '药物不良事件记录', 'https://open.fda.gov/apis/drug/event/', [item.receiptdate, item.serious === '1' ? '严重事件' : ''].filter(Boolean).join(' · '), item.patient?.reaction?.map(row => row.reactionmeddrapt).filter(Boolean).join('；')))
  },
  uniprot: {
    url: (q, n) => `https://rest.uniprot.org/uniprotkb/search?format=json&size=${n}&query=${encodeURIComponent(q)}`,
    parse: data => (data.results || []).map(item => source(item.primaryAccession, item.proteinDescription?.recommendedName?.fullName?.value || item.primaryAccession, `https://www.uniprot.org/uniprotkb/${item.primaryAccession}`, [item.organism?.scientificName, item.entryType].filter(Boolean).join(' · '), item.comments?.[0]?.texts?.[0]?.value))
  },
  pubchem: {
    url: (q, n) => `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(q)}/property/IUPACName,MolecularFormula,MolecularWeight/JSON`,
    parse: data => (data.PropertyTable?.Properties || []).slice(0, n).map(item => source(item.CID, item.IUPACName || `PubChem CID ${item.CID}`, `https://pubchem.ncbi.nlm.nih.gov/compound/${item.CID}`, [item.MolecularFormula, item.MolecularWeight ? `${item.MolecularWeight} Da` : ''].filter(Boolean).join(' · ')))
  },
  gbif: {
    url: (q, n) => `https://api.gbif.org/v1/occurrence/search?q=${encodeURIComponent(q)}&limit=${n}`,
    parse: data => (data.results || []).map(item => source(item.key, item.scientificName || item.species || 'GBIF occurrence', `https://www.gbif.org/occurrence/${item.key}`, [item.country, item.eventDate, item.basisOfRecord].filter(Boolean).join(' · '), item.datasetName || item.recordedBy))
  },
  inaturalist: {
    url: (q, n) => `https://api.inaturalist.org/v1/observations?q=${encodeURIComponent(q)}&per_page=${n}`,
    parse: data => (data.results || []).map(item => source(item.id, item.taxon?.preferred_common_name || item.taxon?.name || 'iNaturalist observation', `https://www.inaturalist.org/observations/${item.id}`, [item.observed_on, item.place_guess, item.quality_grade].filter(Boolean).join(' · '), item.description))
  }
}

async function queryPubMed(web, query, limit, signal) {
  const search = jsonBody(await web.fetch({ url: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${limit}&term=${encodeURIComponent(query)}` }, signal))
  const ids = search.esearchresult?.idlist || []
  if (!ids.length) return []
  const summary = jsonBody(await web.fetch({ url: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(ids.join(','))}` }, signal))
  return ids.map(id => {
    const item = summary.result?.[id] || {}
    return source(id, item.title, `https://pubmed.ncbi.nlm.nih.gov/${id}/`, [item.pubdate, item.fulljournalname, item.authors?.[0]?.name].filter(Boolean).join(' · '), item.sortfirstauthor ? `第一作者：${item.sortfirstauthor}` : '')
  })
}

function queryPrompt(database, query) {
  return `请基于「${database.name}」查询：${query}。优先使用当前会话已配置的 Web、MCP 或数据库工具。返回每条实际检索到记录的标题、稳定标识符、来源链接、年份/版本与一句相关性说明；未能访问时明确说明原因。不得编造文献、DOI、数据集编号或检索结果。`
}

function agentFallback(database, query, reason) {
  return {
    mode: 'agent-fallback', query, sources: [], reason,
    prompt: queryPrompt(database, query)
  }
}

function shouldFallbackToAgent(error) {
  const message = String(error?.message || error)
  return /HTTP (401|403|408|429|500|502|503|504)|WEB_PROVIDER_|查询超时/.test(message)
}

export async function runDatabaseQuery({ web, database, query, limit = 5, signal }) {
  const normalizedQuery = String(query || '').trim()
  if (!normalizedQuery) throw new Error('请输入检索词。')
  if (normalizedQuery.length > MAX_QUERY_LENGTH) throw new Error(`检索词不能超过 ${MAX_QUERY_LENGTH} 个字符。`)
  const size = Math.max(1, Math.min(Number(limit) || 5, MAX_LIMIT))
  try {
    if (database.id === 'pubmed') {
      return { mode: 'direct', sources: await queryPubMed(web, normalizedQuery, size, signal), query: normalizedQuery }
    }
    const adapter = DIRECT_ADAPTERS[database.id]
    if (adapter) {
      const data = jsonBody(await web.fetch({ url: adapter.url(normalizedQuery, size) }, signal))
      return { mode: 'direct', sources: adapter.parse(data).slice(0, size), query: normalizedQuery }
    }
  } catch (error) {
    if (shouldFallbackToAgent(error)) return agentFallback(database, normalizedQuery, `插件直查暂不可用（${String(error?.message || error)}）；可交给当前 Agent 使用 Web 或 MCP 继续查询。`)
    throw error
  }
  return agentFallback(database, normalizedQuery, database.accessNote || '该来源需要当前会话的 MCP、授权或专用适配器。')
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function databaseQueryRoute({ web, databases, logger }) {
  const byId = new Map(databases.map(item => [item.id, item]))
  return {
    kind: 'exact', path: DATABASE_QUERY_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') return reply(res, 405, { error: 'method_not_allowed' })
      const url = new URL(req.url || DATABASE_QUERY_PATH, 'http://localhost')
      const database = byId.get(String(url.searchParams.get('database_id') || ''))
      if (!database) return reply(res, 404, { error: 'unknown_database' })
      const query = String(url.searchParams.get('q') || '')
      const limit = String(url.searchParams.get('limit') || '5')
      const clientKey = clientKeyFor(req)
      // 先查缓存：命中则不计入速率窗口（缓存读取不冲击公开 API）。
      const key = cacheKey(database.id, query, limit)
      const cached = cacheGet(key)
      if (cached) return reply(res, 200, { ...cached, cached: true })
      if (rateLimitExceeded(clientKey)) {
        try { logger?.warn?.(`database query rate limited client=${clientKey} id=${database.id}`) } catch {}
        return reply(res, 429, { error: 'rate_limited', message: '查询过于频繁（每分钟 12 次上限）。请稍后再试，或改用「让 Agent 查询」由会话内 Agent 检索。' })
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)
      try {
        const result = await runDatabaseQuery({ web, database, query, limit, signal: controller.signal })
        const payload = { database: { id: database.id, name: database.name }, ...result }
        cacheSet(key, payload)
        reply(res, 200, payload)
      } catch (error) {
        const message = controller.signal.aborted ? '查询超时，请缩短检索词或稍后重试。' : String(error?.message || error)
        try { logger?.warn?.(`database query failed id=${database.id}: ${message}`) } catch {}
        reply(res, controller.signal.aborted ? 504 : 502, { error: 'database_query_failed', message })
      } finally { clearTimeout(timeout) }
    }
  }
}
