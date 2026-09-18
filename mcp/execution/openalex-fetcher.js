
import { saveEvidence } from './evidence-store.js'
import { wrap, err } from './wrapper.js'

const SELECT_FIELDS = 'id,doi,title,display_name,publication_year,authorships,abstract_inverted_index,type,primary_location,cited_by_count,referenced_works'

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`OpenAlex API returned HTTP ${res.status}`)
  return res.json()
}

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return ''
  const maxPos = Math.max(...Object.values(invertedIndex).flat())
  const words = new Array(maxPos + 1)
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words[pos] = word
  }
  return words.filter(Boolean).join(' ')
}

function normalizeWork(work) {
  return {
    doi: work.doi?.replace('https://doi.org/', '') || '',
    title: work.title || work.display_name || '',
    year: work.publication_year || null,
    type: work.type || '',
    authors: (work.authorships || []).map(a => a.author?.display_name || '').filter(Boolean),
    journal: work.primary_location?.source?.display_name || '',
    abstract: reconstructAbstract(work.abstract_inverted_index),
    cited_by_count: work.cited_by_count || 0,
    openalex_id: work.id || '',
    referenced_works: work.referenced_works || [],
    url: work.doi || '',
  }
}

async function fetchOpenAlexWork(doi) {
  const cleanDoi = String(doi || '').trim().replace(/^https?:\/\/doi\.org\//i, '')
  const data = await fetchJson(`https://api.openalex.org/works/doi:${encodeURIComponent(cleanDoi)}?select=${SELECT_FIELDS}`)
  return normalizeWork(data)
}

async function searchOpenAlex(query, limit = 10) {
  const data = await fetchJson(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${Math.min(limit, 50)}&select=${SELECT_FIELDS}`)
  return (data.results || []).map(normalizeWork)
}

async function fetchMetadata({ dois, query, limit, project, save_to_evidence }) {
  if (query) {
    const results = await searchOpenAlex(query, limit || 10)
    return { mode: 'search', query, results, total: results.length }
  }
  if (!Array.isArray(dois) || !dois.length) {
    throw new Error('必须提供 dois 数组或 query 搜索词。')
  }
  const results = []
  const errors = []
  for (const doi of dois.slice(0, 20)) {
    try {
      results.push(await fetchOpenAlexWork(doi))
    } catch (e) {
      errors.push({ doi, error: e.message })
    }
  }
  if (save_to_evidence) {
    const saved = []
    for (const work of results) {
      if (!work.title) continue
      try {
        const result = await saveEvidence({
          identifier_type: work.doi ? 'doi' : 'none',
          identifier: work.doi,
          title: work.title,
          url: work.url,
          note: work.abstract ? work.abstract.slice(0, 2000) : '',
          project: project || 'default',
          grade_hint: 'empirical',
        })
        saved.push({ doi: work.doi, ...result })
      } catch {}
    }
    return { mode: 'fetch', results, errors, saved_to_evidence: saved }
  }
  return { mode: 'fetch', results, errors, total: results.length }
}

async function fetchOpenAlexMetadata(input) {
  try {
    const result = await fetchMetadata(input)
    return wrap(result, {
      source: 'openalex-fetcher',
      confidence: 'api',
      disclaimer: '元数据来自 OpenAlex API，摘要从 abstract_inverted_index 重建。结果需人工核验。',
    })
  } catch (e) {
    return err(`OpenAlex 元数据获取失败：${e.message}`)
  }
}

export { fetchOpenAlexMetadata, reconstructAbstract, normalizeWork }
