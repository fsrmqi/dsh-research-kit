import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DREAM_MAX_PROPOSALS,
  buildDreamSnapshot,
  buildWakeBrief,
  composeDreamInputs,
  fingerprintDreamAnchors,
  mergeDreamProposals,
  parseDreamLlmProposals,
  planDreamAccept,
  runLocalDream,
  scopeDreamRecords,
  shouldSkipDream,
} from '../src/lib/research-dream.js'
import {
  clearDreamStoreForTest,
  getHandledDreamSignatures,
  getPreferredDreamMode,
  latestDreamReport,
  listDreamReports,
  pendingDreamInbox,
  saveDreamReport,
  setPreferredDreamMode,
  updateDreamProposalStatus,
} from '../src/dream-store.js'
import { RESEARCH_DREAM_PATH, researchDreamRoute } from '../dsh/research-dream.js'
import {
  coverIndex, expandDreamMemory, hotDreamMemory, memoryCardFromProposal, retireCoveredRecords, themeFromCards,
} from '../src/lib/dream-memory.js'

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
  const conflict = report.proposals.find(p => p.kind === 'conflict_alert' && p.refs.claimIds.includes('cl-conflict'))
  assert.equal(conflict.action.options.claimId, 'cl-conflict')
  const duplicate = report.proposals.find(p => p.kind === 'duplicate_evidence')
  assert.deepEqual(duplicate.action.options.evidenceIds, ['ev-1', 'ev-2'])
})

test('scopeDreamRecords：默认课题与命名课题互不纳入对方的知识', () => {
  const rows = [
    { id: 'default-node', project: '' },
    { id: 'missing-project' },
    { id: 'named-node', project: 'barley-fertility' },
    { id: 'other-node', project: 'wheat-stress' },
  ]
  assert.deepEqual(scopeDreamRecords(rows, '').map(row => row.id), ['default-node', 'missing-project'])
  assert.deepEqual(scopeDreamRecords(rows, 'barley-fertility').map(row => row.id), ['named-node'])
  assert.deepEqual(scopeDreamRecords(rows, 'wheat-stress').map(row => row.id), ['other-node'])
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
        title: '混入捏造 ID 的提案',
        summary: '同时引用真实和捏造证据，应整条拒绝',
        refs: { evidenceIds: ['ev-1', 'ev-3', 'ev-hallucinated'], claimIds: [], nodeIds: [] },
        promptDraft: '请对比 ev-1 和 ev-3。',
      },
      {
        kind: 'hypothesis_draft',
        priority: 88,
        title: '真实锚定假说',
        summary: '只引用快照中存在的证据与缺口论断',
        refs: { evidenceIds: ['ev-1', 'ev-3'], claimIds: ['cl-gap'], nodeIds: [] },
      },
      {
        kind: 'hypothesis_draft',
        priority: 87,
        title: '混入捏造灵感',
        summary: '证据是真的，但灵感 ID 不存在，应整条拒绝',
        refs: { evidenceIds: ['ev-1'], assetIds: ['asset-missing'] },
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
  assert.equal(associative[0].title, '真实锚定假说')
  assert.deepEqual(associative[0].refs.evidenceIds, ['ev-1', 'ev-3'])
  assert.deepEqual(associative[0].refs.claimIds, ['cl-gap'])
  assert.equal(associative[0].unverifiedInference, true)

  const empty = buildDreamSnapshot({ project: 'empty', evidence: [], claims: [], knowledgeNodes: [], knowledgeClaims: [] })
  const sourceless = parseDreamLlmProposals({
    proposals: [{ kind: 'hypothesis_draft', priority: 80, title: '无来源假说', summary: '快照为空时也不应放行', refs: {} }],
  }, empty, { mode: 'full' })
  assert.equal(sourceless.length, 0)
})

test('composeDreamInputs：新材料带上未决锚点，已核实的旧记录留在主库', () => {
  const watermark = { at: 1_000, lastDreamAt: 1_000, anchorFingerprint: 'stale' }
  const composed = composeDreamInputs({
    evidence: [
      { id: 'old-verified', status: 'verified', title: 'settled paper', updatedAt: 100 },
      { id: 'old-open', status: 'unverified', title: 'barley tapetum backlog', updatedAt: 200 },
      { id: 'new-ev', status: 'unverified', title: 'barley tapetum heat', updatedAt: 2_000 },
    ],
    claims: [
      { id: 'done', state: 'verified', statement: '已确认', updated_at: new Date(100).toISOString() },
      { id: 'open', state: 'extracted', statement: '待核验 barley tapetum', updated_at: new Date(150).toISOString() },
    ],
    watermark,
  })
  assert.equal(composed.deltaCount, 1)
  assert.deepEqual(composed.evidence.map(item => item.id).sort(), ['new-ev', 'old-open'])
  assert.deepEqual(composed.claims.map(item => item.id), ['open'])
  const crowded = composeDreamInputs({
    evidence: Array.from({ length: 30 }, (_, index) => ({
      id: `new-${index}`, status: 'verified', title: `paper ${index}`, updatedAt: 5_000 + index,
    })),
    watermark,
  })
  assert.equal(crowded.evidence.length, 24)
  assert.equal(crowded.deltaCount, 24)
})

test('梦境记忆：记忆卡盖住冷记录，主题摘要对外只暴露热层', async () => {
  const cardA = memoryCardFromProposal({
    id: 'p-a', kind: 'duplicate_evidence', title: '两条证据重复', summary: '同一篇文献保存了两次',
    refs: { evidenceIds: ['ev-old-1', 'ev-old-2'] },
  })
  const cardB = memoryCardFromProposal({
    id: 'p-b', kind: 'stale_review', title: '一条旧论断还没核', summary: '先核这一条',
    refs: { claimIds: ['cl-old'] },
  })
  const cardC = memoryCardFromProposal({
    id: 'p-c', kind: 'gap_clue', title: '旧缺口仍在', summary: '新证据还没对上',
    refs: { evidenceIds: ['ev-gap'], claimIds: ['cl-gap'] },
  })
  assert.equal(cardA.judgment, 'duplicate')
  const retired = retireCoveredRecords([
    { id: 'ev-old-1', status: 'unverified', updatedAt: 10 },
    { id: 'ev-new', status: 'unverified', updatedAt: Date.now() + 60_000 },
  ], 'evidence', coverIndex({ cards: [{ ...cardA, updatedAt: '2026-01-02T00:00:00.000Z' }], themes: [] }))
  assert.deepEqual(retired.map(item => item.id), ['ev-new'])

  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const home = await mkdtemp(join(tmpdir(), 'dream-memory-'))
  process.env.DSH_RESEARCH_KIT_HOME = home
  try {
    const store = await import(`../mcp/state/dream-memory.js?home=${Date.now()}`)
    let memory = await store.recordDreamMemoryCard('demo', cardA)
    memory = await store.recordDreamMemoryCard('demo', cardB)
    memory = await store.recordDreamMemoryCard('demo', cardC)
    const theme = themeFromCards(memory.cards)
    memory = await store.recordDreamMemoryTheme('demo', theme)
    const hot = hotDreamMemory(memory)
    assert.equal(hot.themes.length, 1)
    assert.equal(hot.cards.length, 0)
    assert.equal(hot.foldedCardCount, 3)
    assert.equal(coverIndex(hot).has('ev-old-1'), true)
    const expanded = expandDreamMemory(memory, hot.themes[0].id)
    assert.equal(expanded.layer, 'theme')
    assert.ok(expanded.theme.covers.evidenceIds.includes('ev-old-1'))
    const draft = await store.recordDreamMemoryCard('demo', { id: 'external', status: 'pending', gist: '待审', covers: { evidenceIds: ['ev-draft'] } })
    assert.equal(coverIndex(draft).has('ev-draft'), false)
    assert.equal((await store.dreamMemoryView('demo')).pending[0].id, 'external')
    const confirmed = await store.changeDreamMemory('demo', { id: 'external', decision: 'confirm' })
    assert.equal(coverIndex(confirmed).has('ev-draft'), true)
    const view = await store.dreamMemoryView('demo', { id: cardA.id })
    assert.equal(view.layer, 'card')
    assert.deepEqual(view.card.covers.evidenceIds, ['ev-old-1', 'ev-old-2'])
    const undone = await store.changeDreamMemory('demo', { proposalId: 'p-a' })
    assert.equal(coverIndex(undone).has('ev-old-1'), false)
    assert.equal(coverIndex(undone).has('cl-old'), true)
    assert.equal(undone.themes.length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('shouldSkipDream：没有新材料且未决项未变时跳过，第一次和手动强制不跳过', () => {
  const buckets = { evidence: [{ id: 'old-open', status: 'unverified', updatedAt: 10 }] }
  const fingerprint = fingerprintDreamAnchors(buckets)
  const watermark = { at: 100, lastDreamAt: 100, anchorFingerprint: fingerprint }
  assert.equal(shouldSkipDream({ deltaCount: 0, anchorFingerprint: fingerprint, watermark }).skip, true)
  assert.equal(shouldSkipDream({ deltaCount: 0, anchorFingerprint: fingerprint, watermark: null }).skip, false)
  assert.equal(shouldSkipDream({ deltaCount: 0, anchorFingerprint: fingerprint, watermark, force: true }).skip, false)
  assert.equal(shouldSkipDream({ deltaCount: 1, anchorFingerprint: fingerprint, watermark }).skip, false)
  const cooled = shouldSkipDream({
    deltaCount: 1,
    anchorFingerprint: 'changed',
    watermark: { lastDreamAt: Date.now(), anchorFingerprint: fingerprint },
    auto: true,
    now: Date.now(),
  })
  assert.equal(cooled.skip, true)
  assert.equal(cooled.reason, 'cooldown')
})

test('planDreamAccept：联想只登记为待核验，不写成已证实', () => {
  const ops = planDreamAccept({
    category: 'associative',
    title: '高温调控绒毡层',
    summary: '需要对照实验。',
    refs: { evidenceIds: ['ev-1'], assetIds: ['asset-1'] },
  })
  const claim = ops.find(op => op.type === 'register_claim')
  assert.equal(claim.claim.state, 'extracted')
  assert.match(claim.claim.statement, /梦境推论 · 待核验/)
  assert.deepEqual(claim.claim.evidence_ids, ['ev-1'])
  assert.equal(ops.find(op => op.type === 'save_asset').asset.epistemicStatus, 'to_verify')
  assert.equal(ops.find(op => op.type === 'link_evidence').pairs[0].assetId, 'asset-1')
  const brief = buildWakeBrief({
    pending: [
      { id: '1', title: '冲突', kind: 'conflict_alert' },
      { id: '2', title: '线索', kind: 'gap_clue', unverifiedInference: true },
      { id: '3', title: '第三条', kind: 'stale_review' },
      { id: '4', title: '超出', kind: 'stale_review' },
    ],
    run: { workflowName: '文献综述', status: 'waiting_review' },
  })
  assert.equal(brief.top.length, 3)
  assert.equal(brief.stoppedAt, '文献综述 · waiting_review')
  assert.equal(brief.conflictCount, 1)
  assert.equal(brief.clueCount, 1)
})

test('mergeDreamProposals：完整梦保留本地冲突，不被单条联想覆盖', () => {
  const snapshot = buildDreamSnapshot(sampleData())
  const local = runLocalDream({ snapshot, mode: 'full' })
  const conflict = local.proposals.find(item => item.kind === 'conflict_alert')
  const host = [{
    ...conflict,
    id: 'host-conflict',
    signature: `${conflict.signature}|rewritten`,
    priority: 100,
    title: '模型改写后的冲突结论',
    summary: '这条不应替换规则已经发现的正反证据。',
  }, {
    id: 'host-bridge',
    signature: 'bridge_insight|ev-3,ev-4',
    kind: 'bridge_insight',
    category: 'associative',
    priority: 99,
    title: '一条新的跨文献联想',
    summary: '只应占联想名额。',
    refs: { evidenceIds: ['ev-3', 'ev-4'], claimIds: [], nodeIds: [], knowledgeClaimIds: [] },
    status: 'pending',
    unverifiedInference: true,
  }]
  const merged = mergeDreamProposals({ local: local.proposals, host, mode: 'full' })
  assert.ok(merged.length <= DREAM_MAX_PROPOSALS)
  assert.equal(merged.filter(item => item.kind === 'conflict_alert' && item.refs.claimIds?.includes('cl-conflict')).length, 1)
  assert.equal(merged.find(item => item.kind === 'conflict_alert' && item.refs.claimIds?.includes('cl-conflict')).title, conflict.title)
  assert.ok(merged.some(item => item.kind === 'bridge_insight'))
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

  saveDreamReport({
    id: 'dream-r2',
    project: 'proj-a',
    mode: 'full',
    digest: '第二次梦境',
    proposals: [
      { id: 'p3', signature: 'sig-3', title: '新提案', status: 'pending' },
    ],
  })
  assert.deepEqual(pendingDreamInbox(listDreamReports('proj-a')).map(item => item.signature), ['sig-3', 'sig-2'])
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
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const routes = new Map([['sess-1', { provider: 'mock', model: 'mock-dream-v1' }]])
  const route = researchDreamRoute({ llm: fakeLlm, routes })
  assert.equal(route.path, RESEARCH_DREAM_PATH)

  const invoke = (method, url, body) => new Promise(resolve => {
    const payload = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body))
    const req = {
      method,
      url,
      on() {},
      off() {},
      async *[Symbol.asyncIterator]() { if (payload) yield payload },
    }
    let statusCode = 0
    let responseBody = ''
    const res = {
      writeHead(code) { statusCode = code },
      end(chunk = '') { responseBody += chunk; resolve({ statusCode, json: JSON.parse(responseBody || '{}') }) },
    }
    route.handler(req, res)
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
