import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

process.env.HOME = await mkdtemp(path.join(os.tmpdir(), 'dsh-claim-context-'))

const { saveEvidence } = await import('../mcp/execution/evidence-store.js')
const { initializeCheckpoints, recordApproval } = await import('../mcp/state/checkpoint-manager.js')
const { listResearchClaims, recordResearchClaim } = await import('../mcp/state/claim-ledger.js')
const { buildResearchContextPack } = await import('../mcp/state/research-context-pack.js')

test.after(async () => { await rm(process.env.HOME, { recursive: true, force: true }) })

test('Claim 台账：verified 必须由人工、理由和证据共同门禁', async () => {
  await assert.rejects(
    () => recordResearchClaim({ project: 'claim-demo', statement: '干预改善结果', state: 'verified', evidence_ids: ['e-1'] }),
    /assessed_by|assessment_reason/i,
  )
  const recorded = await recordResearchClaim({
    project: 'claim-demo', run_id: 'claim-run', statement: '干预可能改善结果', state: 'inferred', evidence_ids: ['e-1'],
  })
  assert.equal(recorded.claim.state, 'inferred')
  const saved = await saveEvidence({ identifier_type: 'doi', identifier: '10.9999/claim-ledger', title: 'Claim Ledger Evidence', project: 'claim-demo' })
  await assert.rejects(
    () => recordResearchClaim({
      project: 'claim-demo', run_id: 'claim-run', claim_id: recorded.claim.id, statement: recorded.claim.statement,
      state: 'verified', evidence_ids: ['missing-evidence'], assessed_by: '研究者', assessment_reason: '已核对全文方法与结果',
    }),
    /不存在的 evidence_ids/i,
  )
  const verified = await recordResearchClaim({
    project: 'claim-demo', run_id: 'claim-run', claim_id: recorded.claim.id, statement: recorded.claim.statement,
    state: 'verified', evidence_ids: [saved.id], assessed_by: '研究者', assessment_reason: '已核对全文方法与结果',
  })
  assert.equal(verified.updated, true)
  assert.equal((await listResearchClaims({ project: 'claim-demo', run_id: 'claim-run' }))[0].state, 'verified')
})

test('科研 Context Pack：只投影证据元数据与验证回执，未确认 Claim 保留状态', async () => {
  const project = 'pack-demo'
  const runId = 'pack-run'
  const saved = await saveEvidence({ identifier_type: 'doi', identifier: '10.9999/context-pack', title: 'Context Pack Evidence', note: '不得泄露的研究笔记', project, run_id: runId })
  await recordResearchClaim({ project, run_id: runId, statement: '待核验的机制假设', state: 'ambiguous', evidence_ids: [saved.id] })
  await initializeCheckpoints(runId, { checkpoints: [{ after_stage: 'synthesis', required: true }] }, ['synthesis'])
  const approval = await recordApproval(runId, 'synthesis', {
    approved_by: '研究者', evidence_ids: [saved.id], validation_summary: '已人工检查来源与研究问题匹配。',
  })
  assert.equal(approval.validation_receipt.evidence_ids[0], saved.id)

  const pack = await buildResearchContextPack({ project, run_id: runId, budget_chars: 3000 })
  assert.equal(pack.injection_policy, 'user_select_required')
  assert.equal(pack.claims[0].state, 'ambiguous')
  assert.equal(pack.evidence[0].id, saved.id)
  assert.equal(pack.validation_receipts[0].evidence_ids[0], saved.id)
  assert.ok(pack.warnings.some(warning => warning.includes('未确认 Claim')))
  assert.ok(!JSON.stringify(pack).includes('note'), 'Context Pack 不应投影证据笔记或全文')
})
