import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEvidenceEntry } from '../src/lib/evidence-vault-core.js'
import { isHumanAssessedEvidence, planAgentEvidenceBatch, evidenceAssessmentFingerprint, normalizeAgentEvidenceResult } from '../src/lib/agent-evidence-batch.js'
import { assessEvidenceBatch, evidenceAgentAssessRoute, EVIDENCE_AGENT_ASSESS_PATH } from '../dsh/evidence-agent-assess.js'

const row = (id, overrides = {}) => normalizeEvidenceEntry({ id, title: `研究 ${id}`, url: `https://example.org/${id}`, ...overrides })
const result = id => ({ id, traceability: 'identified', studyType: 'unknown', claimSupport: 'unassessed', strength: 'ungraded', confidence: 'low', reason: '只有元数据，待核对原文。' })

test('默认排除人工处理过的条目，包含选项可全部重跑；已有 Agent 判断不被排除', () => {
  const rows = [row('new'), row('manual', { assessedBy: 'researcher', assessedAt: 1 }), row('verified', { status: 'verified' }), row('agent', { agentAssessment: { ...result('agent'), at: 2 } })]
  assert.equal(isHumanAssessedEvidence(rows[0]), false)
  assert.equal(isHumanAssessedEvidence(rows[1]), true)
  assert.equal(isHumanAssessedEvidence(rows[2]), true)
  assert.equal(isHumanAssessedEvidence(rows[3]), false)
  assert.deepEqual(planAgentEvidenceBatch(rows).eligible.map(item => item.id), ['new', 'agent'])
  assert.equal(planAgentEvidenceBatch(rows).skippedHuman, 2)
  assert.equal(planAgentEvidenceBatch(rows, { includeHuman: true }).eligible.length, 4)
  assert.equal(planAgentEvidenceBatch(Array.from({ length: 13 }, (_, i) => row(`e${i}`))).batches.length, 3)
})

test('Agent 结果独立持久化，不覆盖人工状态与评估，快照能检测并发变化', () => {
  const human = row('e1', { status: 'verified', assessedBy: 'researcher', assessedAt: 100, assessmentReason: '看过原文' })
  const agent = normalizeAgentEvidenceResult({ assessments: [result('e1')] }, ['e1'], { model: 'test', at: 200 })[0]
  const merged = normalizeEvidenceEntry({ ...human, agentAssessment: agent })
  assert.equal(merged.status, 'verified')
  assert.equal(merged.assessmentReason, '看过原文')
  assert.equal(merged.agentAssessment.model, 'test')
  assert.notEqual(evidenceAssessmentFingerprint(merged), evidenceAssessmentFingerprint(human))
  assert.deepEqual(normalizeEvidenceEntry({ ...merged, agentAssessmentHistory: [agent] }).agentAssessmentHistory, [agent])
})

test('Agent 结构化响应拒绝缺失、重复、未知 ID 和非法枚举', () => {
  assert.throws(() => normalizeAgentEvidenceResult({ assessments: [] }, ['e1']), /数量/)
  assert.throws(() => normalizeAgentEvidenceResult({ assessments: [result('e2')] }, ['e1']), /未知/)
  assert.throws(() => normalizeAgentEvidenceResult({ assessments: [result('e1'), result('e1')] }, ['e1', 'e2']), /重复/)
  assert.throws(() => normalizeAgentEvidenceResult({ assessments: [{ ...result('e1'), strength: 'verified' }] }, ['e1']), /不合法/)
})

test('每次请求调用当前会话模型，且不接受非正常结束', async () => {
  let calls = 0
  const llm = { async *stream(options) {
    calls++
    assert.equal(options.model, 'fresh-model')
    assert.match(options.system, /没有检索网页/)
    yield { type: 'text-delta', text: JSON.stringify({ assessments: [result('e1')] }) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  const options = { llm, route: { provider: 'test', model: 'fresh-model' }, sessionId: 's1', entries: [row('e1')] }
  assert.equal((await assessEvidenceBatch(options)).assessments[0].id, 'e1')
  await assessEvidenceBatch(options)
  assert.equal(calls, 2)
  await assert.rejects(() => assessEvidenceBatch({ ...options, entries: Array(7).fill(row('x')) }), /数量/)
  const truncated = { async *stream() { yield { type: 'text-delta', text: '{}' }; yield { type: 'finish', reason: { kind: 'max-tokens' } } } }
  await assert.rejects(() => assessEvidenceBatch({ ...options, llm: truncated }), /未正常完成/)
})

test('批量判断路由要求 POST 与会话 ID', async () => {
  const route = evidenceAgentAssessRoute({ llm: {}, routes: { get: () => null } })
  const response = () => ({ writeHead(status) { this.status = status }, end(data) { this.data = data } })
  const get = response()
  await route.handler({ method: 'GET' }, get)
  assert.equal(get.status, 405)
  const missing = response()
  await route.handler({ method: 'POST', url: EVIDENCE_AGENT_ASSESS_PATH }, missing)
  assert.equal(missing.status, 400)
})

test('批量判断路由允许跨源 OPTIONS 预检，避免真实 POST 被 405 拦截', async () => {
  const route = evidenceAgentAssessRoute({ llm: {}, routes: { get: () => null } })
  const response = { headers: {}, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) }, end() { this.ended = true } }
  await route.handler({ method: 'OPTIONS', headers: { origin: 'https://dsh.example' } }, response)
  assert.equal(response.status, 204)
  assert.equal(response.headers['access-control-allow-origin'], 'https://dsh.example')
  assert.match(response.headers['access-control-allow-methods'], /POST/)
})

test('批量判断路由正常返回结构化 JSON，不会因 response close 误取消', async () => {
  const route = evidenceAgentAssessRoute({
    llm: { async *stream() {
      yield { type: 'text-delta', text: JSON.stringify({ assessments: [result('e1')] }) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } },
    routes: { get: () => ({ provider: 'test', model: 'test-model' }) },
  })
  const response = {
    writableEnded: false, destroyed: false, headers: {},
    on() {}, off() {},
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) },
    end(data) { this.writableEnded = true; this.data = data },
  }
  const request = {
    method: 'POST', url: `${EVIDENCE_AGENT_ASSESS_PATH}?session_id=s1`, on() {}, off() {},
    async *[Symbol.asyncIterator]() { yield JSON.stringify({ entries: [row('e1')] }) },
  }
  await route.handler(request, response)
  assert.equal(response.status, 200)
  assert.equal(JSON.parse(response.data).assessments[0].id, 'e1')
})
