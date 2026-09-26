import test from 'node:test'
import assert from 'node:assert/strict'
import { installFakeIndexedDB } from './helpers/fake-indexeddb.js'
import { createEvidenceVaultStore } from '../src/evidence-vault-store.js'
import { normalizeResearchLedgerEvent, researchLedgerSummary, latestResearchScreening, summarizeSearchSnapshot } from '../src/lib/research-ledger.js'

test('科研账本区分检索、筛选与执行产出，排除须有理由', () => {
  assert.throws(() => normalizeResearchLedgerEvent({ kind: 'screening', evidenceId: 'e1', decision: 'exclude' }), /理由/)
  const artifact = normalizeResearchLedgerEvent({ kind: 'artifact', title: '图一', executionRef: '' })
  assert.equal(artifact.state, 'draft')
  const events = [
    { kind: 'search' },
    { kind: 'screening', evidenceId: 'e1', decision: 'exclude', at: 1 },
    { kind: 'screening', evidenceId: 'e1', decision: 'include', at: 2 },
    { kind: 'artifact' },
  ]
  assert.deepEqual(researchLedgerSummary(events), { searches: 1, included: 1, excluded: 0, pending: 0, artifacts: 1 })
  assert.equal(latestResearchScreening([...events, { kind: 'screening', evidenceId: 'e1', decision: 'exclude', at: 3 }]).get('e1').decision, 'exclude')
})

test('科研账本跨 store 持久化，项目整理与撤销保持原归属', async () => {
  const fake = installFakeIndexedDB()
  try {
    const store = createEvidenceVaultStore()
    const saved = await store.save({ title: '大麦研究', identifier: '10.1234/barley', project: 'barley-NP1-IPE1-family' })
    await store.saveResearchLedgerEvent({ kind: 'search', project: 'barley-NP1-IPE1-family', database: 'PubMed', query: 'barley NP1', resultCount: 1 })
    await store.saveResearchLedgerEvent({ kind: 'screening', project: 'barley-NP1-IPE1-family', evidenceId: saved.entry.id, decision: 'include' })
    assert.equal((await createEvidenceVaultStore().listResearchLedger({ project: 'barley-NP1-IPE1-family' })).length, 2)
    const mappings = [{ from: 'barley-NP1-IPE1-family', to: '大麦雄性不育' }]
    const snapshot = await store.remapProjects(mappings, { dryRun: true, now: 1234 })
    await store.remapProjects(mappings, { now: 1234, expectedSnapshot: snapshot })
    assert.equal((await store.listResearchLedger({ project: '大麦雄性不育' })).length, 2)
    await store.restoreProjectOrganization(snapshot)
    assert.equal((await store.listResearchLedger({ project: 'barley-NP1-IPE1-family' })).length, 2)
  } finally { fake.restore() }
})

test('检索快照标识稳定，只代表当前返回页；重复来源计数可复核', () => {
  const input = { databaseId: 'pubmed', query: 'barley NP1', sources: [{ id: 'pmid:1' }, { id: 'pmid:1' }, { id: 'pmid:2' }] }
  const first = summarizeSearchSnapshot(input)
  assert.equal(first.resultCount, 3)
  assert.equal(first.deduplicatedCount, 1)
  assert.deepEqual(first.sourceIds, ['pmid:1', 'pmid:2'])
  assert.equal(first.snapshotId, summarizeSearchSnapshot({ ...input, sources: [...input.sources].reverse() }).snapshotId)
  assert.notEqual(first.snapshotId, summarizeSearchSnapshot({ ...input, query: 'other' }).snapshotId)
})
