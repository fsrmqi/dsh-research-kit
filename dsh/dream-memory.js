import { readJsonBody, jsonReply as reply } from './lib/http-json.js'
import { dreamMemoryView, recordDreamMemoryCard, recordDreamMemoryTheme } from '../mcp/state/dream-memory.js'
import { DREAM_MEMORY_PATH, memoryCardFromProposal, themeFromCards } from '../src/lib/dream-memory.js'

export { DREAM_MEMORY_PATH }

const readBody = req => readJsonBody(req, {
  maxBytes: 64_000,
  tooLargeMessage: '梦境记忆过大。',
  invalidJsonMessage: '请求格式无效。',
})

export function dreamMemoryRoute({ logger } = {}) {
  return {
    kind: 'exact',
    path: DREAM_MEMORY_PATH,
    async handler(req, res) {
      try {
        const url = new URL(req.url || DREAM_MEMORY_PATH, 'http://localhost')
        const project = url.searchParams.get('project') || 'default'
        if (req.method === 'GET') {
          const view = await dreamMemoryView(project, { id: url.searchParams.get('id') || '' })
          return reply(res, 200, { ok: true, ...view })
        }
        if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'method_not_allowed' })
        const body = await readBody(req)
        const scope = body.project || project
        if (body.action === 'record_card') {
          const card = body.card || memoryCardFromProposal(body.proposal || {}, { project: scope })
          const memory = await recordDreamMemoryCard(scope, card)
          return reply(res, 200, { ok: true, memory })
        }
        if (body.action === 'record_theme') {
          const theme = body.theme || themeFromCards(body.cards || [], { gist: body.gist || '' })
          const memory = await recordDreamMemoryTheme(scope, theme)
          return reply(res, 200, { ok: true, memory })
        }
        return reply(res, 400, { ok: false, error: '未知的梦境记忆操作。' })
      } catch (error) {
        try { logger?.warn?.(`dream-memory error: ${error?.message || error}`) } catch { /* 日志失败不改变响应 */ }
        const status = error?.code === 'body_too_large' ? 413 : error?.code === 'INVALID_PROJECT' || error?.message === 'invalid_json' ? 400 : 500
        return reply(res, status, { ok: false, error: error?.message || 'internal_error' })
      }
    },
  }
}
