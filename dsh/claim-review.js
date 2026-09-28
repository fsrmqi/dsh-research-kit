import { readProjectEntries, safeProjectName } from '../mcp/execution/evidence-store.js'
import { listResearchClaims, recordClaimDrafts, recordResearchClaim } from '../mcp/state/claim-ledger.js'
import { extractClaimDrafts } from '../mcp/execution/claim-drafts.js'
import { buildResearchEvidenceExport } from '../mcp/state/research-evidence-export.js'

export const CLAIM_REVIEW_PATH = '/dsh-research-kit/claim-review'
const MAX_BODY_BYTES = 64 * 1024

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error('body_too_large')
  }
  try { return JSON.parse(body) } catch { throw new Error('invalid_json') }
}

function requestClaim(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_claim')
  const project = safeProjectName(input.project || 'default')
  const run_id = String(input.run_id || '')
  const claim_id = String(input.claim_id || '')
  const statement = String(input.statement || '').trim()
  const state = String(input.state || 'extracted')
  const evidence_ids = input.evidence_ids || []
  const assessed_by = String(input.assessed_by || '').trim()
  const assessment_reason = String(input.assessment_reason || '').trim()
  if (run_id && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(run_id)) throw new Error('invalid_run_id')
  if (claim_id && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(claim_id)) throw new Error('invalid_claim_id')
  if (!statement || statement.length > 800 || !Array.isArray(evidence_ids) || evidence_ids.length > 30
    || evidence_ids.some(id => typeof id !== 'string' || id.length > 120)
    || assessed_by.length > 120 || assessment_reason.length > 500) throw new Error('invalid_claim')
  if (state !== 'extracted' && (!assessed_by || !assessment_reason)) throw new Error('审阅状态必须填写评估人和理由。')
  return { project, run_id, claim_id, statement, state, evidence_ids, assessed_by, assessment_reason }
}

export function claimReviewRoute({ logger } = {}) {
  return {
    kind: 'exact', path: CLAIM_REVIEW_PATH,
    async handler(req, res) {
      try {
        if (req.method === 'GET') {
          const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`)
          const project = safeProjectName(url.searchParams.get('project') || 'default')
          const [claims, entries] = await Promise.all([
            listResearchClaims({ project, limit: 200 }),
            readProjectEntries(project),
          ])
          const evidence = entries.slice(-200).reverse().map(entry => ({
            id: entry.id,
            title: entry.title,
            identifier_type: entry.identifier_type,
            identifier: entry.identifier,
            url: entry.url,
          }))
          return reply(res, 200, { ok: true, project, claims, evidence,
            claim_limit_reached: claims.length === 200, evidence_limit_reached: entries.length > 200 })
        }
        if (req.method === 'POST') {
          const body = await readBody(req)
          if (body?.action === 'extract' || body?.action === 'save_drafts') {
            const project = safeProjectName(body.project || 'default')
            const text = String(body.text || '')
            if (text.length > 12_000) return reply(res, 400, { ok: false, error: '研究文本不能超过 12000 字符。' })
            const drafts = extractClaimDrafts(text, await readProjectEntries(project), { limit: 20 })
            if (body.action === 'extract') return reply(res, 200, { ok: true, drafts })
            const selected = body.selected_indices
            if (!Array.isArray(selected) || !selected.length || selected.length > 20
              || new Set(selected).size !== selected.length
              || selected.some(index => !Number.isInteger(index) || index < 0 || index >= drafts.length)) {
              return reply(res, 400, { ok: false, error: '请选择有效的 Claim 候选。' })
            }
            const result = await recordClaimDrafts({ project, run_id: String(body.run_id || ''), drafts: selected.map(index => drafts[index]) })
            return reply(res, 200, { ok: true, ...result })
          }
          if (body?.action === 'export') {
            const result = await buildResearchEvidenceExport({ project: body.project, run_id: body.run_id || '', mode: body.mode || 'publication' })
            return reply(res, 200, { ok: true, ...result })
          }
          const input = requestClaim(body)
          const result = await recordResearchClaim(input)
          return reply(res, 200, { ok: true, claim: result.claim, updated: result.updated })
        }
        return reply(res, 405, { ok: false, error: 'method_not_allowed' })
      } catch (error) {
        try { logger?.warn?.(`claim-review error: ${error?.message || error}`) } catch {}
        const status = error?.message === 'body_too_large' ? 413
          : error?.code === 'INVALID_PROJECT' || error?.message === 'invalid_json'
            || error?.message?.startsWith('invalid_') || error?.message?.includes('必须')
            || error?.message?.includes('不存在') || error?.message?.includes('不能为空')
            || error?.message?.includes('不合法') || error?.message?.includes('无法导出') ? 400 : 500
        return reply(res, status, { ok: false, error: error?.message || 'internal_error' })
      }
    },
  }
}
