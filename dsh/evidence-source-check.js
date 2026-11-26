export const EVIDENCE_SOURCE_CHECK_PATH = '/dsh-research-kit/evidence-source-check'

import { jsonReply, readJsonBody, resolveAllowedCorsOrigin } from './lib/http-json.js'

// 本路由的 CORS 来源挂在 res.__sourceCheckOrigin（只允许回环、同源或白名单 Origin）。
const reply = (res, status, body) => jsonReply(res, status, body, { corsOrigin: res.__sourceCheckOrigin })

const readBody = req => readJsonBody(req, { maxChars: 16_384, destroyOnTooLarge: true, requireObject: true })

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
        const rawOrigin = String(req.headers?.origin || '').trim()
        const allowedOrigin = resolveAllowedCorsOrigin(req)
        if (req.method === 'OPTIONS') {
          if (!rawOrigin) return reply(res, 400, { ok: false, error: 'origin_required' })
          if (!allowedOrigin) return reply(res, 403, { ok: false, error: 'origin_not_allowed' })
          res.writeHead(204, { 'access-control-allow-origin': allowedOrigin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'Origin' })
          res.end()
          return
        }
        if (allowedOrigin) res.__sourceCheckOrigin = allowedOrigin
        if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'method_not_allowed' })
        const body = await readBody(req)
        const entries = Array.isArray(body?.entries) ? body.entries : []
        if (!entries.length || entries.length > 6) return reply(res, 400, { ok: false, error: 'entries_must_be_1_to_6' })
        const results = await Promise.all(entries.map(async entry => {
          try { return { id: entry?.id, check: await checkEvidenceSource(web, entry, AbortSignal.timeout(10_000)) } }
          catch (error) { return { id: entry?.id, error: String(error?.message || error).slice(0, 240) } }
        }))
        return reply(res, 200, { ok: true, results })
      } catch (error) {
        try { logger?.warn?.(`evidence-source-check: ${error?.message || error}`) } catch {}
        const status = error?.code === 'body_too_large' ? 413
          : error?.code === 'invalid_json' || error?.message === 'invalid_json' ? 400 : 500
        return reply(res, status, { ok: false, error: error?.message || 'internal_error' })
      }
    },
  }
}
