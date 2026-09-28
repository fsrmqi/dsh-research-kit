import { readProjectEntries, safeProjectName } from '../mcp/execution/evidence-store.js'
import { listResearchClaims, recordResearchClaim } from '../mcp/state/claim-ledger.js'

export const CLAIM_REVIEW_PATH = '/dsh-research-kit/claim-review'
const MAX_BODY_BYTES = 16 * 1024

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error('body_too_large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(body)) } catch { reject(new Error('invalid_json')) }
    })
    req.on('error', reject)
  })
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
          const input = requestClaim(await readBody(req))
          const result = await recordResearchClaim(input)
          return reply(res, 200, { ok: true, claim: result.claim, updated: result.updated })
        }
        return reply(res, 405, { ok: false, error: 'method_not_allowed' })
      } catch (error) {
        try { logger?.warn?.(`claim-review error: ${error?.message || error}`) } catch {}
        const status = error?.message === 'body_too_large' ? 413
          : error?.code === 'INVALID_PROJECT' || error?.message === 'invalid_json'
            || error?.message?.startsWith('invalid_') || error?.message?.includes('必须')
            || error?.message?.includes('不存在') ? 400 : 500
        return reply(res, status, { ok: false, error: error?.message || 'internal_error' })
      }
    },
  }
}
