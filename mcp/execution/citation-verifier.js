import { crossrefUrl, fetchJsonWithRetry, fetchTextWithRetry } from './http-client.js'

const CACHE = new Map()
const CACHE_TTL_MS = 5 * 60_000
const CACHE_MAX = 200

function cacheKey(type, id) { return `${type}:${id.toLowerCase().trim()}` }
function cacheGet(key) {
  const hit = CACHE.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) { CACHE.delete(key); return null }
  return hit.data
}
function cacheSet(key, data) {
  CACHE.set(key, { at: Date.now(), data })
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value)
}

function detectIdentifierType(raw) {
  const value = String(raw || '').trim()
  if (/^10\.\d{4,9}\//i.test(value)) return 'doi'
  if (/^PMC\d{6,9}$/i.test(value)) return 'pmcid'
  if (/^\d{5,8}$/.test(value)) return 'pmid'
  if (/^\d{4}\.\d{4,5}(v\d+)?$/i.test(value)) return 'arxiv'
  if (/^NCT\d{8}$/i.test(value)) return 'nct'
  return null
}

function pubmedApiKey(env = process.env) {
  return String(env.DSH_RESEARCH_KIT_SOURCE_PUBMED_API_KEY || env.PUBMED_API_KEY || '').trim()
}

async function fetchCrossref(doi) {
  const data = await fetchJsonWithRetry(crossrefUrl(`https://api.crossref.org/works/${encodeURIComponent(doi)}`))
  const item = data.message
  return {
    identifier: item.DOI,
    identifier_type: 'doi',
    title: item.title?.[0] || '',
    authors: (item.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ')),
    journal: item['container-title']?.[0] || '',
    year: item['published-print']?.['date-parts']?.[0]?.[0] || item['published-online']?.['date-parts']?.[0]?.[0] || null,
    url: item.URL || `https://doi.org/${item.DOI}`,
    abstract: typeof item.abstract === 'string' ? item.abstract.replace(/<[^>]+>/g, '').trim().slice(0, 2000) : '',
    type: item.type || '',
  }
}

async function fetchPubmed(pmid) {
  const apiKey = pubmedApiKey()
  const data = await fetchJsonWithRetry(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json${apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : ''}`)
  const item = data.result?.[pmid]
  if (!item) throw new Error('PubMed 未返回该 PMID 的记录。')
  return {
    identifier: item.elocationid?.replace(/.*doi:\s*/i, '') || pmid,
    identifier_type: 'pmid',
    title: item.title || '',
    authors: (item.authors || []).map(a => a.name),
    journal: item.fulljournalname || item.source || '',
    year: item.pubdate ? parseInt(item.pubdate.match(/\d{4}/)?.[0]) : null,
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    abstract: '',
    type: item.pubtype?.join(', ') || '',
  }
}

async function fetchArxiv(arxivId) {
  const cleanId = arxivId.replace(/v\d+$/i, '')
  const xml = await fetchTextWithRetry(`https://export.arxiv.org/api/query?id_list=${cleanId}`, { accept: 'application/xml' })
  const titleMatch = xml.match(/<title>([^<]+)<\/title>/)
  const entries = xml.split('<entry>').slice(1)
  if (!entries.length) throw new Error('arXiv 未返回该 ID 的记录。')
  const entry = entries[0]
  const absMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/)
  const authorMatches = [...entry.matchAll(/<name>([^<]+)<\/name>/g)]
  const doiMatch = entry.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/i)
  return {
    identifier: doiMatch?.[1] || arxivId,
    identifier_type: doiMatch?.[1] ? 'doi' : 'arxiv',
    title: (titleMatch?.[1] || entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').trim(),
    authors: authorMatches.map(m => m[1].trim()),
    journal: 'arXiv preprint',
    year: entry.match(/<published>(\d{4})/)?.[1] ? parseInt(entry.match(/<published>(\d{4})/)[1]) : null,
    url: `https://arxiv.org/abs/${arxivId}`,
    abstract: absMatch ? absMatch[1].trim().slice(0, 2000) : '',
    type: 'preprint',
  }
}

function keywordOverlap(text, claim) {
  const stop = new Set(['the','a','an','is','are','was','were','in','on','of','to','for','with','by','that','this','and','or','not','it','as','at','from','be','has','have','had','can','could','may','might','will','would','do','does','did','but','if','then','than','so','such','no','nor','only','its','their','our','your','these','those','which','who','whom','what','when','where','how','why','been','being','also','between','into','through','during','before','after','above','below','up','down','out','off','over','under','again','further','once','here','there','all','any','both','each','few','more','most','other','some','own','same','too','very','just','because','until','while','about','against'])
  // 保留 CJK 字符和其他 Unicode 字母，只移除标点符号和特殊字符
  const tokenize = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w))
  const textWords = new Set(tokenize(text))
  const claimWords = tokenize(claim)
  if (!claimWords.length) return { matched: 0, total: 0, ratio: 0, matched_terms: [] }
  const matched = claimWords.filter(w => textWords.has(w))
  return { matched: matched.length, total: claimWords.length, ratio: matched.length / claimWords.length, matched_terms: matched }
}

function assessClaim(metadata, claim) {
  const searchText = `${metadata.title} ${metadata.abstract}`.trim()
  if (!searchText) return { supported: null, confidence: 0.3, reason: '无摘要可匹配，无法判断 claim 支持性。' }
  const overlap = keywordOverlap(searchText, claim)
  if (overlap.ratio >= 0.5) {
    return { supported: true, confidence: Math.min(0.6 + overlap.ratio * 0.3, 0.9), reason: `摘要匹配度 ${(overlap.ratio * 100).toFixed(0)}%（${overlap.matched}/${overlap.total} 关键词命中）。`, matched_terms: overlap.matched_terms }
  }
  if (overlap.ratio >= 0.25) {
    return { supported: null, confidence: 0.4 + overlap.ratio, reason: `摘要部分匹配（${overlap.matched}/${overlap.total}），需人工核验全文。`, matched_terms: overlap.matched_terms }
  }
  return { supported: false, confidence: Math.max(0.5, 0.8 - overlap.ratio), reason: `摘要匹配度低（${overlap.matched}/${overlap.total}），claim 可能不被原文支持。`, matched_terms: overlap.matched_terms }
}

async function verifyCitation(identifier, claim) {
  const type = detectIdentifierType(identifier)
  if (!type) return { exists: false, reason: `无法识别标识符类型："${identifier}"。支持 DOI、PMID、PMCID、arXiv ID、NCT。` }

  const key = cacheKey(type, identifier)
  let metadata = cacheGet(key)
  if (!metadata) {
    if (type === 'doi') metadata = await fetchCrossref(identifier)
    else if (type === 'pmid') metadata = await fetchPubmed(identifier)
    else if (type === 'arxiv') metadata = await fetchArxiv(identifier)
    else if (type === 'pmcid') throw new Error('PMCID 查询暂未实现，请使用 PMID 或 DOI。')
    else if (type === 'nct') throw new Error('NCT 查询暂未实现。')
    cacheSet(key, metadata)
  }

  const result = { exists: true, metadata }
  if (claim && typeof claim === 'string' && claim.trim()) {
    const assessment = assessClaim(metadata, claim.trim())
    result.claim_supported = assessment.supported
    result.claim_evidence = assessment.reason
    if (assessment.matched_terms) result.matched_terms = assessment.matched_terms
    result.confidence = assessment.confidence
  }
  return result
}

export { verifyCitation, detectIdentifierType }
