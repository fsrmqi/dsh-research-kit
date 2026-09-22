
import { saveEvidenceBatch } from './evidence-store.js'
import { wrap, err } from './wrapper.js'
import { fetchJsonWithRetry } from './http-client.js'

const SELECT_FIELDS = 'id,doi,title,display_name,publication_year,authorships,abstract_inverted_index,type,primary_location,cited_by_count,referenced_works'

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return ''
  const maxPos = Math.max(...Object.values(invertedIndex).flat())
  const words = new Array(maxPos + 1)
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words[pos] = word
  }
  return words.filter(Boolean).join(' ')
}

function normalizeWork(work, { includeReferences = false } = {}) {
  const references = work.referenced_works || []
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
    referenced_works_count: references.length,
    ...(includeReferences ? { referenced_works: references } : {}),
    url: work.doi || '',
  }
}

async function fetchOpenAlexWork(doi, { includeReferences = false } = {}) {
  const cleanDoi = String(doi || '').trim().replace(/^https?:\/\/doi\.org\//i, '')
  const data = await fetchJsonWithRetry(`https://api.openalex.org/works/doi:${encodeURIComponent(cleanDoi)}?select=${SELECT_FIELDS}`)
  return normalizeWork(data, { includeReferences })
}

async function searchOpenAlex(query, limit = 10, { includeReferences = false } = {}) {
  const data = await fetchJsonWithRetry(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${Math.min(limit, 50)}&select=${SELECT_FIELDS}`)
  return (data.results || []).map(work => normalizeWork(work, { includeReferences }))
}

async function mapWithConcurrency(items, limit, run) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await run(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function fetchMetadata({ dois, query, limit, project, save_to_evidence, include_references }) {
  let mode
  let results
  let errors = []
  if (query) {
    mode = 'search'
    results = await searchOpenAlex(query, limit || 10, { includeReferences: include_references })
  } else if (!Array.isArray(dois) || !dois.length) {
    throw new Error('必须提供 dois 数组或 query 搜索词。')
  } else {
    mode = 'fetch'
    const selectedDois = dois.slice(0, 20)
    const outcomes = await mapWithConcurrency(selectedDois, 4, async doi => {
      try {
        return { ok: true, value: await fetchOpenAlexWork(doi, { includeReferences: include_references }) }
      } catch (e) {
        return { ok: false, doi, error: e.message }
      }
    })
    results = outcomes.filter(item => item.ok).map(item => item.value)
    errors = outcomes.filter(item => !item.ok).map(({ doi, error }) => ({ doi, error }))
  }
  if (save_to_evidence) {
    const saved = await saveEvidenceBatch(results.filter(work => work.title).map(work => ({
      identifier_type: work.doi ? 'doi' : 'none', identifier: work.doi, title: work.title,
      url: work.url, note: work.abstract ? work.abstract.slice(0, 2000) : '', grade_hint: 'empirical',
    })), { project: project || 'default' })
    return { mode, ...(query ? { query } : {}), results, errors, total: results.length, saved_to_evidence: saved }
  }
  return { mode, ...(query ? { query } : {}), results, errors, total: results.length }
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
