import { createHash } from 'node:crypto'
import { readProjectEntries, safeProjectName } from '../execution/evidence-store.js'
import { listResearchClaims } from './claim-ledger.js'

export async function buildResearchEvidenceExport({ project = 'default', run_id = '', mode = 'publication' } = {}) {
  const normalizedProject = safeProjectName(project)
  if (!['publication', 'draft'].includes(mode)) throw new Error('导出模式不合法。')
  const claims = await listResearchClaims({ project: normalizedProject, run_id, limit: 200 })
  if (!claims.length) throw new Error('当前范围没有 Claim，无法导出。')
  if (claims.length === 200) throw new Error('当前范围达到 200 条上限；请按运行缩小范围后导出。')
  const entries = await readProjectEntries(normalizedProject)
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const blockers = claims.flatMap(claim => {
    const missing = (claim.evidence_ids || []).filter(id => !byId.has(id))
    return [
      ...(mode === 'publication' && claim.state !== 'verified' && claim.state !== 'rejected'
        ? [{ claim_id: claim.id, state: claim.state, reason: '未人工确认的 Claim 不得作为确定结论发布。' }] : []),
      ...(mode === 'publication' && claim.state === 'verified' && (!claim.evidence_ids?.length || missing.length)
        ? [{ claim_id: claim.id, state: claim.state, reason: '已确认 Claim 的关联证据已缺失。' }] : []),
    ]
  })
  if (blockers.length) return { ready: false, mode, project: normalizedProject, run_id, blockers }
  const referenced = new Set(claims.flatMap(claim => claim.evidence_ids || []))
  const payload = {
    schema_version: 1, kind: 'research-evidence', mode, project: normalizedProject, run_id,
    exported_at: new Date().toISOString(),
    claims: claims.map(claim => ({ id: claim.id, statement: claim.statement, state: claim.state,
      evidence_ids: claim.evidence_ids || [], assessed_by: claim.assessed_by || '',
      assessment_reason: claim.assessment_reason || '',
      source_ref: claim.source_ref ? { citation: claim.source_ref.citation,
        citation_type: claim.source_ref.citation_type, locator: claim.source_ref.locator } : undefined })),
    evidence: entries.filter(entry => referenced.has(entry.id)).map(entry => ({
      id: entry.id, title: entry.title, identifier_type: entry.identifier_type,
      identifier: entry.identifier, url: entry.url,
    })),
  }
  const { exported_at: _exportedAt, ...content } = payload
  const content_sha256 = createHash('sha256').update(JSON.stringify(content)).digest('hex')
  return { ready: true, payload: { ...payload, content_sha256 }, blockers: [] }
}
