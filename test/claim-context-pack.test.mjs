import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'

process.env.HOME = await mkdtemp(path.join(os.tmpdir(), 'dsh-claim-context-'))

const { saveEvidence } = await import('../mcp/execution/evidence-store.js')
const { initializeCheckpoints, recordApproval } = await import('../mcp/state/checkpoint-manager.js')
const { listResearchClaims, recordResearchClaim, recordClaimDrafts, recordAgentClaimReviews } = await import('../mcp/state/claim-ledger.js')
const { buildResearchContextPack } = await import('../mcp/state/research-context-pack.js')
const { buildResearchEvidenceExport } = await import('../mcp/state/research-evidence-export.js')
const { extractClaimDrafts } = await import('../mcp/execution/claim-drafts.js')
const { reviewClaimsWithAgent, claimAgentReviewRoute } = await import('../dsh/claim-agent-review.js')
const { claimReviewRoute } = await import('../dsh/claim-review.js')

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

test('Claim 审阅 HTTP：草稿、人工确认与证据元数据同源往返', async () => {
  const project = 'review-http-demo'
  const saved = await saveEvidence({ identifier_type: 'doi', identifier: '10.9999/review-http',
    title: 'Review HTTP Evidence', note: '不应返回的私人笔记', project })
  const route = claimReviewRoute()
  const server = createServer((req, res) => route.handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/dsh-research-kit/claim-review`
  const post = async body => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, result: await response.json() }
  }
  try {
    const draft = await post({ project, statement: '干预 A 改善结局 B', state: 'extracted' })
    assert.equal(draft.status, 200)
    const invalid = await post({ project, claim_id: draft.result.claim.id, statement: draft.result.claim.statement,
      state: 'verified', evidence_ids: ['not-here'], assessed_by: '研究者', assessment_reason: '已核对研究方法' })
    assert.equal(invalid.status, 400)
    const confirmed = await post({ project, claim_id: draft.result.claim.id, statement: draft.result.claim.statement,
      state: 'verified', evidence_ids: [saved.id], assessed_by: '研究者', assessment_reason: '已核对研究方法' })
    assert.equal(confirmed.status, 200)
    const response = await fetch(`${url}?project=${project}`)
    const payload = await response.json()
    assert.equal(payload.claims[0].state, 'verified')
    assert.equal(payload.evidence[0].id, saved.id)
    assert.ok(!JSON.stringify(payload).includes('不应返回的私人笔记'))
    const text = '另有研究报告干预改善次要结局 [1](https://doi.org/10.9999/review-http)。'
    const extracted = await post({ action: 'extract', project, text })
    assert.equal(extracted.result.drafts[0].evidence_ids[0], saved.id)
    const selected = await post({ action: 'save_drafts', project, text, selected_indices: [0] })
    assert.equal(selected.result.saved[0].state, 'extracted')
    const blocked = await post({ action: 'export', project, mode: 'publication' })
    assert.equal(blocked.status, 200)
    assert.equal(blocked.result.ready, false)
    const draftExport = await post({ action: 'export', project, mode: 'draft' })
    assert.equal(draftExport.result.payload.claims.length, 2)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('带引用段落：先提取可定位候选，勾选后去重登记，发布导出需人工确认', async () => {
  const project = 'draft-flow-demo'
  const saved = await saveEvidence({ identifier_type: 'doi', identifier: '10.9999/draft-flow',
    title: 'Draft Flow Evidence', note: '仅用于本地研究的笔记', project })
  const text = '在给定条件下，干预 A 改善结局 B [1](https://doi.org/10.9999/draft-flow)。另一结论仍待核验。'
  const drafts = extractClaimDrafts(text, [{ id: saved.id, identifier_type: 'doi', identifier: '10.9999/draft-flow' }])
  assert.equal(drafts.length, 1)
  assert.deepEqual(drafts[0].evidence_ids, [saved.id])
  assert.match(drafts[0].source_ref.locator, /^char:\d+$/)
  assert.ok(!drafts[0].statement.includes('另一结论'))
  const first = await recordClaimDrafts({ project, run_id: 'draft-run', drafts })
  const repeat = await recordClaimDrafts({ project, run_id: 'draft-run', drafts })
  assert.equal(first.saved.length, 1)
  assert.equal(repeat.saved.length, 0)
  assert.equal(repeat.duplicates.length, 1)
  assert.equal(first.saved[0].state, 'extracted')
  const blocked = await buildResearchEvidenceExport({ project, run_id: 'draft-run' })
  assert.equal(blocked.ready, false)
  assert.equal(blocked.blockers[0].state, 'extracted')
  const draftExport = await buildResearchEvidenceExport({ project, run_id: 'draft-run', mode: 'draft' })
  assert.equal(draftExport.ready, true)
  assert.equal(draftExport.payload.claims[0].state, 'extracted')
  assert.ok(!JSON.stringify(draftExport).includes('仅用于本地研究的笔记'))
  await recordResearchClaim({ project, claim_id: first.saved[0].id, statement: first.saved[0].statement,
    state: 'verified', evidence_ids: [saved.id], assessed_by: '研究者', assessment_reason: '人工核对方法与结果' })
  const ready = await buildResearchEvidenceExport({ project, run_id: 'draft-run' })
  assert.equal(ready.ready, true)
  assert.match(ready.payload.content_sha256, /^[a-f0-9]{64}$/)
  assert.equal((await buildResearchEvidenceExport({ project, run_id: 'draft-run' })).payload.content_sha256,
    ready.payload.content_sha256, '导出时间变化不应改变内容哈希')
})

test('Agent 审阅写独立建议，拒绝伪造 verified 与过期覆盖', async () => {
  const project = 'agent-review-demo'
  const evidence = await saveEvidence({ identifier_type: 'doi', identifier: '10.9999/agent-review',
    title: 'Agent Review Evidence', note: '私人笔记不应发给模型', project })
  const draft = await recordResearchClaim({ project, statement: '干预 A 改善结局 B', state: 'extracted', evidence_ids: [evidence.id] })
  const llm = { async *stream(input) {
    assert.match(input.system, /不得建议 verified/)
    assert.ok(!JSON.stringify(input.messages).includes('私人笔记'))
    yield { type: 'text-delta', text: JSON.stringify({ assessments: [{ id: draft.claim.id,
      suggested_state: 'ambiguous', confidence: 'low', reason: '只有声明，缺少可核验来源。' }] }) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  const result = await reviewClaimsWithAgent({ llm, route: { provider: 'test', model: 'test-model' },
    sessionId: 'agent-session', project, claimIds: [draft.claim.id] })
  assert.equal(result.claims[0].state, 'extracted')
  assert.equal(result.claims[0].agent_review.suggested_state, 'ambiguous')
  const current = (await listResearchClaims({ project }))[0]
  await assert.rejects(() => recordAgentClaimReviews({ project, assessments: [{ id: current.id,
    expected_updated_at: draft.claim.updated_at, expected_revision: draft.claim.revision,
    suggested_state: 'ambiguous', reason: '过期建议' }] }), /已变化/)
  const unsafe = { async *stream() {
    yield { type: 'text-delta', text: JSON.stringify({ assessments: [{ id: draft.claim.id,
      suggested_state: 'verified', reason: '模型自称确认' }] }) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  await assert.rejects(() => reviewClaimsWithAgent({ llm: unsafe, route: { provider: 'test', model: 'test-model' },
    sessionId: 'agent-session', project, claimIds: [draft.claim.id] }), /不允许的建议状态/)
  assert.equal((await listResearchClaims({ project }))[0].state, 'extracted')
})

test('Claim Agent HTTP：当前会话模型的建议入账，人工状态不变', async () => {
  const project = 'agent-route-demo'
  const draft = await recordResearchClaim({ project, statement: '给定条件下，A 可能关联 B', state: 'extracted' })
  const route = claimAgentReviewRoute({ routes: { get: () => ({ provider: 'test', model: 'route-model' }) },
    llm: { async *stream(input) {
      const request = JSON.parse(input.messages[0].content[0].text)
      yield { type: 'text-delta', text: JSON.stringify({ assessments: [{ id: request.claims[0].id,
        suggested_state: 'ambiguous', confidence: 'low', reason: '缺少可核验来源。' }] }) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } } })
  const server = createServer((req, res) => route.handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/dsh-research-kit/claim-agent-review?session_id=test-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, claim_ids: [draft.claim.id] }),
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).reviewed, 1)
    const stored = (await listResearchClaims({ project }))[0]
    assert.equal(stored.state, 'extracted')
    assert.equal(stored.agent_review.model, 'route-model')
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('Claim Agent 路由允许跨源预检，且只接受带会话 ID 的 POST', async () => {
  const route = claimAgentReviewRoute({ llm: {}, routes: { get: () => null } })
  const response = () => ({ headers: {}, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) }, end(data) { this.data = data; this.writableEnded = true } })
  const preflight = response()
  await route.handler({ method: 'OPTIONS', headers: { origin: 'https://dsh.example' } }, preflight)
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://dsh.example')
  const missing = response()
  await route.handler({ method: 'POST', url: '/dsh-research-kit/claim-agent-review' }, missing)
  assert.equal(missing.status, 400)
})
