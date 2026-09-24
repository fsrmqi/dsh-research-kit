import test from 'node:test'
import assert from 'node:assert/strict'
import { installFakeIndexedDB } from './helpers/fake-indexeddb.js'
import { normalizeResearchClaim } from '../src/lib/research-claims.js'
import { createEvidenceVaultStore } from '../src/evidence-vault-store.js'
import { buildEvidenceGraph } from '../src/lib/evidence-graph-core.js'

test('论断支持／反驳必须有来源位置与评估者；未评估关系保持中性', () => {
  assert.throws(() => normalizeResearchClaim({ statement: 'X 影响 Y', links: [{ evidenceId: 'e1', stance: 'supports' }] }), /来源位置/)
  const claim = normalizeResearchClaim({ statement: 'X 影响 Y', question: 'X 是否影响 Y？', links: [{ evidenceId: 'e1', stance: 'unassessed' }] }, 123)
  assert.equal(claim.links[0].stance, 'unassessed')
  const graph = buildEvidenceGraph({
    savedEvidence: [{ id: 'e1', title: '来源' }], researchClaims: [claim],
    knowledge: { nodes: [{ id: 'kn1', kind: 'finding', label: '待核发现', evidenceIds: ['e1'] }], claims: [] },
  })
  assert.ok(graph.edges.some(edge => edge.from === `research-claim:${claim.id}` && edge.to === 'evidence:e1' && edge.kind === 'linked'))
  assert.ok(graph.edges.some(edge => edge.from === 'evidence:e1' && edge.to === 'kn1' && edge.kind === 'linked'))
  assert.equal(graph.edges.some(edge => edge.kind === 'supports'), false)
})

test('研究论断持久化，且无法关联不存在的证据', async () => {
  const fake = installFakeIndexedDB()
  try {
    const store = createEvidenceVaultStore()
    const saved = await store.save({ title: '来源 A', url: 'https://example.org/a', project: '课题 A' })
    await assert.rejects(() => store.saveResearchClaim({ statement: '论断', links: [{ evidenceId: 'missing' }] }), /不存在/)
    const claim = await store.saveResearchClaim({ project: '课题 A', statement: '论断', links: [{ evidenceId: saved.entry.id, stance: 'unassessed' }] })
    assert.equal((await createEvidenceVaultStore().listResearchClaims({ project: '课题 A' }))[0].id, claim.id)
  } finally { fake.restore() }
})
