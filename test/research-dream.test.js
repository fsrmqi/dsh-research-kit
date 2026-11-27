import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  DREAM_MAX_PROPOSALS,
  buildDreamSnapshot,
  parseDreamLlmProposals,
  runLocalDream,
} from '../src/lib/research-dream.js'
import {
  clearDreamStoreForTest,
  getHandledDreamSignatures,
  getPreferredDreamMode,
  latestDreamReport,
  saveDreamReport,
  setPreferredDreamMode,
  updateDreamProposalStatus,
} from '../src/dream-store.js'
import { RESEARCH_DREAM_PATH, researchDreamRoute } from '../dsh/research-dream.js'

function sampleData() {
  const now = Date.now()
  return {
    project: 'barley-fertility',
    evidence: [
      { id: 'ev-1', title: 'HvNP1 regulates tapetum lipid transport in barley', identifier: '10.1000/hvnp1-a', identifierKind: 'doi', status: 'unverified', tags: ['tapetum', 'pollen'], savedAt: now - 10_000 },
      { id: 'ev-2', title: 'HvNP1 regulates tapetum lipid transport in barley', identifier: '10.1000/hvnp1-a', identifierKind: 'doi', status: 'unverified', tags: ['tapetum', 'pollen'], savedAt: now - 9_000 },
      { id: 'ev-3', title: 'Pollen exine defects under heat stress in barley tapetum', identifier: '10.1000/exine-heat', identifierKind: 'doi', status: 'verified', tags: ['tapetum', 'pollen', 'heat'], savedAt: now - 8_000 },
      { id: 'ev-4', title: 'Independent assay shows normal pollen fertility under low temperature', identifier: '10.1000/cold-pollen', identifierKind: 'doi', status: 'verified', tags: ['pollen'], savedAt: now - 7_000 },
      { id: 'ev-5', title: 'Extra unverified study on cuticle wax biosynthesis', identifier: '10.1000/wax', identifierKind: 'doi', status: 'unverified', tags: ['cuticle'], savedAt: now - 20_000 },
    ],
    claims: [
      {
        id: 'cl-conflict',
        statement: 'HvNP1 敲除导致雄性不育',
        state: 'ambiguous',
        evidence_ids: ['ev-1', 'ev-4'],
        links: [
          { evidenceId: 'ev-1', stance: 'supports' },
          { evidenceId: 'ev-4', stance: 'refutes' },
        ],
        updated_at: new Date(now - 5 * 86400_000).toISOString(),
      },
      {
        id: 'cl-unlinked',
        statement: 'HvNP1 regulates tapetum lipid transport and pollen exine formation',
        state: 'extracted',
        evidence_ids: [],
        links: [],
        updated_at: new Date(now - 4 * 86400_000).toISOString(),
      },
      {
        id: 'cl-gap',
        statement: '【缺口：尚不清楚高温胁迫下 barley tapetum pollen exine 是否受 HvNP1 影响】',
        state: 'ambiguous',
        evidence_ids: ['ev-1'],
        links: [{ evidenceId: 'ev-1', stance: 'insufficient' }],
        updated_at: new Date(now - 6 * 86400_000).toISOString(),
      },
    ],
    knowledgeNodes: [
      { id: 'kn-1', label: 'HvNP1', kind: 'entity', status: 'to_verify', evidenceIds: ['ev-1'], updatedAt: now },
      { id: 'kn-2', label: 'tapetum degeneration', kind: 'entity', status: 'to_verify', evidenceIds: ['ev-3'], updatedAt: now },
    ],
    knowledgeClaims: [
      { id: 'kc-1', from: 'kn-1', to: 'kn-2', relation: 'promotes', polarity: 'positive', status: 'to_verify', updatedAt: now },
      { id: 'kc-2', from: 'kn-1', to: 'kn-2', relation: 'inhibits', polarity: 'negative', status: 'to_verify', updatedAt: now },
    ],
  }
}

test('巩固梦：检测重复证据、立场冲突与未关联论断，并压缩在 Top 5 以内', () => {
  const snapshot = buildDreamSnapshot(sampleData())
  const report = runLocalDream({ snapshot, mode: 'consolidation' })
  assert.equal(report.mode, 'consolidation')
  assert.equal(report.engine, 'local-rules')
  assert.ok(report.proposals.length >= 3 && report.proposals.length <= DREAM_MAX_PROPOSALS)
  const kinds = new Set(report.proposals.map(p => p.kind))
  assert.ok(kinds.has('duplicate_evidence'))
  assert.ok(kinds.has('conflict_alert'))
  assert.ok(report.proposals.every(p => p.category === 'consolidation' && p.unverifiedInference === false))
})

test('联想梦：识别缺口线索与跨文献桥接，全部标注为待核验推论', () => {
  const snapshot = buildDreamSnapshot(sampleData())
  const report = runLocalDream({ snapshot, mode: 'associative' })
  assert.equal(report.mode, 'associative')
  assert.ok(report.proposals.length >= 1 && report.proposals.length <= DREAM_MAX_PROPOSALS)
  assert.ok(report.proposals.every(p => p.category === 'associative' && p.unverifiedInference === true))
  assert.ok(report.proposals.some(p => p.kind === 'gap_clue' || p.kind === 'bridge_insight'))
})

test('完整梦：兼顾巩固与联想，跳过已处理 signature 且严格截断至 5 条', () => {
  const snapshot = buildDreamSnapshot(sampleData())
  const first = runLocalDream({ snapshot, mode: 'full' })
  assert.ok(first.proposals.length <= DREAM_MAX_PROPOSALS)
  assert.ok(first.proposals.some(p => p.category === 'consolidation'))
  assert.ok(first.proposals.some(p => p.category === 'associative'))

  const dismissed = [first.proposals[0].signature]
  const second = runLocalDream({ snapshot, mode: 'full', handledSignatures: dismissed })
  assert.ok(!second.proposals.some(p => p.signature === dismissed[0]))
})

test('parseDreamLlmProposals：丢弃编造 ID 的幻觉提案，保留真实锚定提案并按模式过滤', () => {
  const snapshot = buildDreamSnapshot(sampleData())
  const raw = {
    proposals: [
      {
        kind: 'bridge_insight',
        priority: 95,
        title: '幻觉提案',
        summary: '引用了不存在的证据 ID',
        refs: { evidenceIds: ['ev-fake-999'], claimIds: [], nodeIds: [] },
      },
      {
        kind: 'bridge_insight',
        priority: 90,
        title: '真实跨文献桥接',
        summary: '结合 ev-1 与 ev-3 检验高温下绒毡层表型',
        refs: { evidenceIds: ['ev-1', 'ev-3', 'ev-hallucinated'], claimIds: [], nodeIds: [] },
        promptDraft: '请对比 ev-1 和 ev-3。',
      },
      {
        kind: 'duplicate_evidence',
        priority: 99,
        title: '巩固类在联想模式应被过滤',
        summary: '不应出现在 associative 模式',
        refs: { evidenceIds: ['ev-1', 'ev-2'] },
      },
    ],
  }
  const associative = parseDreamLlmProposals(raw, snapshot, { mode: 'associative' })
  assert.equal(associative.length, 1)
  assert.equal(associative[0].title, '真实跨文献桥接')
  assert.deepEqual(associative[0].refs.evidenceIds, ['ev-1', 'ev-3'])
  assert.equal(associative[0].unverifiedInference, true)
})

test('dream-store：持久化偏好模式、按课题存取简报并记录已处理 signature', () => {
  clearDreamStoreForTest()
  assert.equal(getPreferredDreamMode(), 'full')
  setPreferredDreamMode('associative')
  assert.equal(getPreferredDreamMode(), 'associative')

  const saved = saveDreamReport({
    id: 'dream-r1',
    project: 'proj-a',
    mode: 'full',
    digest: '已扫描 2 条证据',
    proposals: [
      { id: 'p1', signature: 'sig-1', title: '提案 1', status: 'pending' },
      { id: 'p2', signature: 'sig-2', title: '提案 2', status: 'pending' },
    ],
  })
  assert.equal(latestDreamReport('proj-a')?.id, saved.id)
  assert.equal(latestDreamReport('proj-b'), null)

  updateDreamProposalStatus({ reportId: 'dream-r1', proposalId: 'p1', status: 'dismissed', project: 'proj-a' })
  assert.deepEqual(getHandledDreamSignatures('proj-a'), ['sig-1'])
  assert.equal(latestDreamReport('proj-a').proposals[0].status, 'dismissed')
  clearDreamStoreForTest()
})

test('researchDreamRoute：校验路由参数并在宿主模型返回合法 JSON 时输出锚定提案', async () => {
  const snapshot = buildDreamSnapshot(sampleData())
  const fakeLlm = {
    async *stream() {
      yield {
        type: 'text-delta',
        text: JSON.stringify({
          proposals: [
            {
              kind: 'hypothesis_draft',
              priority: 91,
              title: '高温调控 HvNP1 绒毡层脂质转运假说',
              summary: '结合已有证据设计高温对照实验验证。',
              refs: { evidenceIds: ['ev-1', 'ev-3'], claimIds: ['cl-gap'] },
            },
          ],
        }),
      }
      yield { type: 'finish', finishReason: 'stop' }
    },
  }
  const routes = new Map([['sess-1', { provider: 'mock', model: 'mock-dream-v1' }]])
  const route = researchDreamRoute({ llm: fakeLlm, routes })
  assert.equal(route.path, RESEARCH_DREAM_PATH)

  const invoke = (method, url, body) => new Promise(resolve => {
    const req = new EventEmitter()
    req.method = method
    req.url = url
    let statusCode = 0
    let responseBody = ''
    const res = {
      writeHead(code) { statusCode = code },
      end(chunk = '') { responseBody += chunk; resolve({ statusCode, json: JSON.parse(responseBody || '{}') }) },
    }
    route.handler(req, res)
    if (body !== undefined) {
      req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
    }
    req.emit('end')
  })

  const noRoute = await invoke('POST', `${RESEARCH_DREAM_PATH}?session_id=missing`, { mode: 'full', snapshot })
  assert.equal(noRoute.statusCode, 503)

  const ok = await invoke('POST', `${RESEARCH_DREAM_PATH}?session_id=sess-1`, { mode: 'associative', snapshot })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json.ok, true)
  assert.equal(ok.json.model, 'mock-dream-v1')
  assert.equal(ok.json.proposals.length, 1)
  assert.equal(ok.json.proposals[0].unverifiedInference, true)
  assert.deepEqual(ok.json.proposals[0].refs.evidenceIds, ['ev-1', 'ev-3'])
})
