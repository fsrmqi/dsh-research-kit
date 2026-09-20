
import { listEvidence } from './evidence-store.js'
import { wrap } from './wrapper.js'
import { fetchJsonWithRetry } from './http-client.js'

async function lookupOpenAlex(doi) {
  const data = await fetchJsonWithRetry(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=id,referenced_works,cited_by_count`)
  return { openalexId: data.id, references: data.referenced_works || [], citedByCount: data.cited_by_count || 0 }
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

async function linkLiterature({ project, max_lookups = 10 } = {}) {
  const { entries } = await listEvidence({ project, limit: 50 })
  const dois = entries.filter(e => e.identifier_type === 'doi' && e.identifier).slice(0, max_lookups)
  if (!dois.length) {
    return wrap({ edges: [], message: '项目中没有带 DOI 的证据条目可供互引分析。' }, { source: 'literature-linker', confidence: 'verified' })
  }

  const lookupResults = await mapWithConcurrency(dois, 3, async entry => {
    try {
      return { entry, info: await lookupOpenAlex(entry.identifier) }
    } catch (error) {
      return { entry, error: error.message }
    }
  })
  const workIdToEntry = new Map()
  for (const item of lookupResults) {
    if (item.info?.openalexId) workIdToEntry.set(String(item.info.openalexId), item.entry)
  }

  const edges = []
  const lookupErrors = []
  for (const item of lookupResults) {
    if (item.error) {
      lookupErrors.push({ doi: item.entry.identifier, error: item.error })
      continue
    }
    for (const refId of item.info.references || []) {
      const target = workIdToEntry.get(String(refId))
      if (target && target.id !== item.entry.id) {
        edges.push({ from: item.entry.id, to: target.id, relation: 'cites', via: 'openalex' })
      }
    }
  }

  return wrap({
    edges,
    looked_up: dois.length,
    errors: lookupErrors,
    message: edges.length ? `发现 ${edges.length} 对互引关系。` : '未发现已保存证据之间的直接互引关系。',
  }, { source: 'literature-linker', confidence: 'api', disclaimer: '互引关系来自 OpenAlex 引用图谱，可能不完整。' })
}

export { linkLiterature }
