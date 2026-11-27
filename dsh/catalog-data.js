import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { catalogMatch, itemById, searchCatalog } from '../src/catalog.js'
import { staticArtifactRoute } from './static-artifact-route.js'

export const CATALOG_DATA_PATH = '/dsh-research-kit/catalog-data'
export const CATALOG_ITEM_PATH = '/dsh-research-kit/catalog-item'
export const CATALOG_SEARCH_PATH = '/dsh-research-kit/catalog-search'

const body = readFileSync(new URL('../ui/catalog-data.json', import.meta.url), 'utf8')
const ITEM_ID_PATTERN = /^[a-z0-9-]+$/
const VALID_SEARCH_TYPES = new Set(['all', 'workflow', 'skill', 'database'])
const itemResponseCache = new Map()

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  return res.end(JSON.stringify(payload))
}

function parseUrl(req) {
  return new URL(String(req?.url || '/'), 'http://localhost')
}

export function catalogDataRoute() {
  return staticArtifactRoute({ path: CATALOG_DATA_PATH, body, contentType: 'application/json; charset=utf-8' })
}

// 按需返回单条完整目录详情（含工作流 prompt / placeholders / limitations 与技能 guidance / checklist），
// 带强 ETag 支持 304 复用，避免首屏加载全量 847 KB 目录。
export function catalogItemRoute() {
  return {
    kind: 'exact',
    path: CATALOG_ITEM_PATH,
    handler(req, res) {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
      const id = String(parseUrl(req).searchParams.get('id') || '').trim()
      if (!id || !ITEM_ID_PATTERN.test(id)) return sendJson(res, 400, { ok: false, error: 'invalid_item_id' })
      let cached = itemResponseCache.get(id)
      if (!cached) {
        const item = itemById(id)
        if (!item) return sendJson(res, 404, { ok: false, error: 'not_found' })
        const serialized = JSON.stringify({ ok: true, item })
        const etag = `"${createHash('sha256').update(serialized).digest('base64url')}"`
        cached = { serialized, etag }
        itemResponseCache.set(id, cached)
      }
      const headers = {
        'cache-control': 'no-cache',
        'content-type': 'application/json; charset=utf-8',
        etag: cached.etag,
        'x-content-type-options': 'nosniff',
      }
      if (req.headers?.['if-none-match'] === cached.etag) {
        res.writeHead(304, headers)
        return res.end()
      }
      res.writeHead(200, headers)
      return res.end(cached.serialized)
    },
  }
}

// Node 侧完整目录全文检索：覆盖 Prompt 正文、技能 guidance/promptFragment 与数据源 queryExample，
// 浏览器轻量索引检索时可合并这里的正文命中，不丢失原有全文检索能力。
export function catalogSearchRoute() {
  return {
    kind: 'exact',
    path: CATALOG_SEARCH_PATH,
    handler(req, res) {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
      const params = parseUrl(req).searchParams
      const query = String(params.get('q') || '').trim().slice(0, 200)
      const rawType = String(params.get('type') || 'all').trim()
      const type = VALID_SEARCH_TYPES.has(rawType) ? rawType : 'all'
      if (!query) return sendJson(res, 200, { ok: true, query: '', type, results: [] }, { 'cache-control': 'no-store' })
      const results = searchCatalog({ query, type }).map(item => {
        const match = catalogMatch(item, query)
        return { id: item.id, score: match.score, reason: match.reason, term: match.term }
      })
      return sendJson(res, 200, { ok: true, query, type, results }, { 'cache-control': 'no-store' })
    },
  }
}
