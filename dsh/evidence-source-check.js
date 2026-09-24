export const EVIDENCE_SOURCE_CHECK_PATH = '/dsh-research-kit/evidence-source-check'

function reply(res, status, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (res.__sourceCheckOrigin) { headers['access-control-allow-origin'] = res.__sourceCheckOrigin; headers.vary = 'Origin' }
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk; if (data.length > 16_384) { reject(new Error('body_too_large')); req.destroy() } })
    req.on('end', () => { try { resolve(JSON.parse(data)) } catch { reject(new Error('invalid_json')) } })
    req.on('error', reject)
  })
}

const titleKey = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

export function compareSourceTitle(saved, official) {
  const a = titleKey(saved), b = titleKey(official)
  if (!a || !b) return 'unknown'
  return a === b || (Math.min(a.length, b.length) >= 24 && (a.includes(b) || b.includes(a))) ? 'matched' : 'mismatch'
}

export async function checkEvidenceSource(web, entry, signal) {
  const id = String(entry?.identifier || '').trim()
  const kind = String(entry?.identifierKind || '').toLowerCase()
  let official
  if (kind === 'doi' && /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i.test(id)) {
    const response = await web.fetch({ url: `https://api.crossref.org/works/${encodeURIComponent(id)}` }, signal)
    if (response.statusCode === 404) return { status: 'not_found', provider: 'Crossref', identifier: id, checkedAt: Date.now(), contentVerified: false }
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Crossref 返回 HTTP ${response.statusCode}`)
    const item = JSON.parse(String(response.body?.content || '{}')).message || {}
    official = { title: String(item.title?.[0] || ''), journal: String(item['container-title']?.[0] || ''), year: Number(item.published?.['date-parts']?.[0]?.[0] || item.issued?.['date-parts']?.[0]?.[0]) || null, url: String(item.URL || `https://doi.org/${id}`) }
  } else if (kind === 'pmid' && /^\d{5,8}$/.test(id)) {
    const response = await web.fetch({ url: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(id)}` }, signal)
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`PubMed 返回 HTTP ${response.statusCode}`)
    const item = JSON.parse(String(response.body?.content || '{}')).result?.[id]
    if (!item) return { status: 'not_found', provider: 'PubMed', identifier: id, checkedAt: Date.now(), contentVerified: false }
    official = { title: String(item.title || ''), journal: String(item.fulljournalname || item.source || ''), year: Number(String(item.pubdate || '').match(/\d{4}/)?.[0]) || null, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/` }
  } else throw new Error('当前仅支持 DOI 或 PMID 的官方元数据核对；不推断其他编号。')
  return {
    status: compareSourceTitle(entry.title, official.title),
    provider: kind === 'doi' ? 'Crossref' : 'PubMed', identifier: id,
    official, checkedAt: Date.now(), contentVerified: false,
  }
}

export function evidenceSourceCheckRoute({ web, logger } = {}) {
  return {
    kind: 'exact', path: EVIDENCE_SOURCE_CHECK_PATH,
    async handler(req, res) {
      try {
        const origin = String(req.headers?.origin || '').trim()
        if (origin) res.__sourceCheckOrigin = origin
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'Origin' })
          res.end()
          return
        }
        if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'method_not_allowed' })
        const body = await readBody(req)
        const entries = Array.isArray(body?.entries) ? body.entries : []
        if (!entries.length || entries.length > 6) return reply(res, 400, { ok: false, error: 'entries_must_be_1_to_6' })
        const results = []
        for (const entry of entries) {
          try { results.push({ id: entry.id, check: await checkEvidenceSource(web, entry, AbortSignal.timeout(10_000)) }) }
          catch (error) { results.push({ id: entry.id, error: String(error?.message || error).slice(0, 240) }) }
        }
        return reply(res, 200, { ok: true, results })
      } catch (error) {
        try { logger?.warn?.(`evidence-source-check: ${error?.message || error}`) } catch {}
        return reply(res, error?.message === 'invalid_json' ? 400 : 500, { ok: false, error: error?.message || 'internal_error' })
      }
    },
  }
}
