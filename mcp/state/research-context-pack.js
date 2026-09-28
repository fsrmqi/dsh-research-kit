// 只读科研 Context Pack：把显式 Claim、证据元数据和人工验证回执压缩成可审阅上下文。
import { readProjectEntries } from '../execution/evidence-store.js'
import { getCheckpointState } from './checkpoint-manager.js'
import { listResearchClaims } from './claim-ledger.js'

function evidenceSummary(entry) {
  return {
    id: entry.id,
    title: String(entry.title || '').slice(0, 240),
    identifier_type: entry.identifier_type,
    identifier: entry.identifier,
    url: entry.url,
    source_verification: entry.source_verification || 'unverified',
    claim_support: entry.claim_support || 'unassessed',
    strength: entry.strength || 'ungraded',
  }
}

export async function buildResearchContextPack({ project = 'default', run_id = '', budget_chars = 6_000, claim_limit = 20, evidence_limit = 30 } = {}) {
  const budget = Math.min(Math.max(Number(budget_chars) || 6_000, 800), 12_000)
  const [claims, entries, checkpoint] = await Promise.all([
    listResearchClaims({ project, run_id, limit: claim_limit }),
    readProjectEntries(project),
    run_id ? getCheckpointState(run_id).catch(() => ({ checkpoints: {}, pending: [], approved: [] })) : Promise.resolve({ checkpoints: {}, pending: [], approved: [] }),
  ])
  const selectedClaims = claims.filter(claim => claim.state !== 'rejected')
  const referenced = new Set(selectedClaims.flatMap(claim => claim.evidence_ids || []))
  const evidence = entries.filter(entry => referenced.has(entry.id)).slice(0, Math.min(Math.max(Number(evidence_limit) || 30, 1), 100)).map(evidenceSummary)
  const receipts = Object.entries(checkpoint.checkpoints || {}).flatMap(([stage, value]) => value?.validation_receipt
    ? [{ stage, ...value.validation_receipt }]
    : [])
  const pack = {
    project,
    run_id: run_id || '',
    claims: selectedClaims.map(claim => ({
      id: claim.id, statement: claim.statement, state: claim.state, evidence_ids: claim.evidence_ids,
      assessed_by: claim.assessed_by || undefined, assessment_reason: claim.assessment_reason || undefined,
    })),
    evidence,
    validation_receipts: receipts,
    warnings: [
      ...(selectedClaims.filter(claim => claim.state !== 'verified').length ? ['含有未确认 Claim；注入后仍必须保留其状态，不得表述为已证实事实。'] : []),
      ...(receipts.some(receipt => !receipt.evidence_ids?.length) ? ['存在未关联证据的人工检查点；它不能单独证明科研结论。'] : []),
    ],
    next_actions: [
      ...(selectedClaims.filter(claim => claim.state === 'ambiguous').length ? ['处理 ambiguous Claim：补充相互独立的证据，或明确保留不确定性。'] : []),
      ...(selectedClaims.filter(claim => claim.state === 'inferred').length ? ['inferred Claim 仅能作为推论；核对原文后再人工转为 verified 或 rejected。'] : []),
      ...(!selectedClaims.length ? ['尚无显式 Claim；先用 research_claim_record 登记需要追踪的研究结论。'] : []),
    ],
  }
  let truncated = false
  while (JSON.stringify(pack).length > budget && pack.evidence.length) { pack.evidence.pop(); truncated = true }
  while (JSON.stringify(pack).length > budget && pack.claims.length) { pack.claims.pop(); truncated = true }
  return { ...pack, budget_chars: budget, truncated, injection_policy: 'user_select_required' }
}
