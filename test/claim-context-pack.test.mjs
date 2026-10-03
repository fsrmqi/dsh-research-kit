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


test('Claim 内容版本：MCP 修改已确认结论不能沿用旧人工核验', async () => {
  const { evidenceTools } = await import('../mcp/tools/evidence.js')
  const { z } = await import('zod/v3')
  const tool = evidenceTools.find(item => item.name === 'research_claim_record')
  const schema = z.object(tool.inputSchema)
  const project = 'verified-content-version'
  const evidence = await saveEvidence({ project, title: '人工核对来源', identifier_type: 'doi', identifier: '10.9999/version' })
  const original = await recordResearchClaim({ project, statement: 'A 提升 B', state: 'verified',
    evidence_ids: [evidence.id], assessed_by: '研究者', assessment_reason: '全文支持 A 提升 B' })
  const result = await tool.execute(schema.parse({ project, claim_id: original.claim.id, statement: 'A 降低 B', state: 'verified' }))
  assert.match(JSON.stringify(result), /必须重新提供人工/)
  assert.equal((await listResearchClaims({ project }))[0].statement, 'A 提升 B')
  const draft = await recordResearchClaim({ project, claim_id: original.claim.id, statement: 'A 降低 B', state: 'extracted' })
  assert.equal(draft.claim.assessment_reason, '')
  await assert.rejects(() => recordResearchClaim({ project, claim_id: original.claim.id, state: 'verified' }), /必须重新提供人工/)
  assert.equal((await buildResearchEvidenceExport({ project })).ready, false)
  await recordResearchClaim({ project, claim_id: original.claim.id, state: 'verified',
    evidence_ids: [evidence.id], assessed_by: '另一位研究者', assessment_reason: '重新核对新版本' })
  assert.equal((await buildResearchEvidenceExport({ project })).ready, true)
})

test('Context Pack：多条长回执也必须符合最终序列化字符预算', async () => {
  const runId = 'receipt-budget-run'
  for (let i = 0; i < 4; i++) {
    const stage = `stage-${i}`
    await initializeCheckpoints(runId, { checkpoints: [{ after_stage: stage }] }, [stage])
    await recordApproval(runId, stage, { validation_summary: '详细人工核验说明'.repeat(60) })
  }
  const pack = await buildResearchContextPack({ project: 'receipt-budget', run_id: runId, budget_chars: 800 })
  assert.ok(JSON.stringify(pack).length <= 800)
  assert.equal(pack.truncated, true)
  assert.equal(pack.injection_policy, 'user_select_required')
})

test('Context Pack：检查点损坏必须显式报错，不能静默伪装成没有人工回执', async () => {
  const { writeFile, mkdir } = await import('node:fs/promises')
  const { dataPath } = await import('../mcp/paths.js')
  await mkdir(dataPath('checkpoints'), { recursive: true })
  await writeFile(dataPath('checkpoints', 'corrupt-pack-run.json'), 'invalid json')
  await assert.rejects(() => buildResearchContextPack({ project: 'receipt-budget', run_id: 'corrupt-pack-run' }), { code: 'CHECKPOINT_STATE_CORRUPT' })
})

test('统一 Claim 台账：本地迁移保留 ID 和立场，忽略外来已确认状态且幂等', async () => {
  const { importLocalResearchClaims, researchClaimPage } = await import('../mcp/state/claim-ledger.js')
  const project = 'unified-local'
  const evidence = await saveEvidence({ project, identifier_type: 'doi', identifier: '10.9999/unified-local', title: '来源' })
  const input = { id: 'legacy-local', project, question: '研究问题', statement: '研究论断', state: 'verified',
    links: [{ evidenceId: evidence.id, stance: 'refutes', locator: '图 2', assessedBy: '研究者' }] }
  assert.equal((await importLocalResearchClaims({ project, claims: [input] })).added, 1)
  assert.equal((await importLocalResearchClaims({ project, claims: [{ ...input, statement: '不得覆盖' }] })).added, 0)
  const page = await researchClaimPage({ project })
  assert.equal(page.claims[0].id, 'legacy-local'); assert.equal(page.claims[0].state, 'extracted')
  assert.equal(page.claims[0].links[0].stance, 'refutes'); assert.equal(page.claims[0].question, '研究问题')
  const updated = await recordResearchClaim({ project, claim_id: 'legacy-local', expected_revision: 1,
    statement: '研究论断', state: 'verified', evidence_ids: [evidence.id], assessed_by: '研究者', assessment_reason: '核对原文并评估反证' })
  const exported = await buildResearchEvidenceExport({ project, mode: 'publication' })
  assert.equal(exported.payload.claims[0].state, 'verified')
  assert.equal(exported.payload.claims[0].links[0].stance, 'refutes')
  await assert.rejects(() => recordResearchClaim({ project, claim_id: updated.claim.id, expected_revision: 1, statement: '旧版本内容' }), /已被更新/)
  await assert.rejects(() => recordResearchClaim({ project, claim_id: updated.claim.id, links: [{ evidenceId: evidence.id, stance: 'supports', locator: '图 3', assessedBy: '另一个人' }] }), /重新提供/)
})

test('统一 Claim 台账：分页超过 200 条不遗漏，旧 MCP 查询上限保留', async () => {
  const { importLocalResearchClaims, researchClaimPage } = await import('../mcp/state/claim-ledger.js')
  const project = 'unified-pagination'
  for (let offset = 0; offset < 205; offset += 50) await importLocalResearchClaims({ project,
    claims: Array.from({ length: Math.min(50, 205 - offset) }, (_, index) => ({ id: `local-${offset + index}`, statement: `假设 ${offset + index}`, links: [] })) })
  const first = await researchClaimPage({ project }); const second = await researchClaimPage({ project, offset: first.next_offset })
  assert.equal(first.claims.length, 200); assert.equal(second.claims.length, 5); assert.equal(second.next_offset, null)
  assert.equal(new Set([...first.claims, ...second.claims].map(row => row.id)).size, 205)
  assert.equal((await listResearchClaims({ project, limit: 999 })).length, 200)
})

test('项目整理同时迁移证据与 Claim 台账，撤销保留人工审核状态', async () => {
  const { organizeEvidenceProjects, undoEvidenceProjectOrganization } = await import('../mcp/execution/evidence-store.js')
  const from = 'joint-before', to = 'joint-after'
  const evidence = await saveEvidence({ project: from, identifier_type: 'doi', identifier: '10.9999/joint', title: '联合迁移来源' })
  const created = await recordResearchClaim({ project: from, statement: '人工判断', state: 'verified', evidence_ids: [evidence.id], assessed_by: '研究者', assessment_reason: '已核对全文' })
  const result = await organizeEvidenceProjects([{ from, to }])
  assert.equal((await listResearchClaims({ project: from })).length, 0)
  const moved = (await listResearchClaims({ project: to }))[0]
  assert.equal(moved.id, created.claim.id); assert.equal(moved.state, 'verified')
  assert.equal((await buildResearchEvidenceExport({ project: to })).ready, true)
  await undoEvidenceProjectOrganization(result.id)
  assert.equal((await listResearchClaims({ project: from }))[0].state, 'verified')
  assert.equal((await listResearchClaims({ project: to })).length, 0)
})

test('项目整理后 Claim 有新审核时拒绝撤销，避免覆盖人工判断', async () => {
  const { organizeEvidenceProjects, undoEvidenceProjectOrganization, finalizeEvidenceProjectOrganization } = await import('../mcp/execution/evidence-store.js')
  const created = await recordResearchClaim({ project: 'joint-conflict-a', statement: '待审阅声明' })
  const result = await organizeEvidenceProjects([{ from: 'joint-conflict-a', to: 'joint-conflict-b' }])
  await recordResearchClaim({ project: 'joint-conflict-b', claim_id: created.claim.id, statement: '新判断内容', state: 'ambiguous' })
  await assert.rejects(() => undoEvidenceProjectOrganization(result.id), /论断在整理后发生变化/)
  assert.equal((await listResearchClaims({ project: 'joint-conflict-b' }))[0].statement, '新判断内容')
  await finalizeEvidenceProjectOrganization(result.id)
})
