import test from 'node:test'
import assert from 'node:assert/strict'
import { installFakeIndexedDB } from './helpers/fake-indexeddb.js'
import { createEvidenceVaultStore } from '../src/evidence-vault-store.js'
import { createKnowledgeStore } from '../src/knowledge-store.js'
import { extractKnowledge } from '../src/lib/knowledge-extract.js'

test('浏览器项目整理：证据、关联与知识节点迁移后可撤销，重建 store 可读快照', async () => {
  const fake = installFakeIndexedDB()
  try {
    const evidence = createEvidenceVaultStore()
    const knowledge = createKnowledgeStore()
    const original = await evidence.save({ title: 'Barley NP1', identifier: '10.9999/np1', project: 'barley-NP1-IPE1-family' })
    await evidence.linkAssetEvidence({ assetId: 'a1', evidenceId: original.entry.id, project: 'barley-NP1-IPE1-family' })
    const extracted = extractKnowledge('大麦 NP1 可能影响雄性不育。')
    await knowledge.applyExtraction({ ...extracted, project: 'barley-NP1-IPE1-family' })
    const moves = [{ from: 'barley-NP1-IPE1-family', to: '大麦雄性不育' }]
    const evidencePlan = await evidence.remapProjects(moves, { dryRun: true, now: 12345 })
    await evidence.writeOrganizerJournal({ status: 'file', fileId: 'file-1', evidenceSnapshot: evidencePlan })
    await evidence.remapProjects(moves, { now: 12345, expectedSnapshot: evidencePlan })
    const knowledgePlan = await knowledge.remapProjects(moves, { dryRun: true })
    await knowledge.remapProjects(moves, { expectedSnapshot: knowledgePlan })
    assert.equal((await evidence.list({ project: '大麦雄性不育' })).length, 1)
    assert.equal((await evidence.list({ project: '大麦雄性不育' }))[0].legacyProject, 'barley-NP1-IPE1-family')
    assert.equal((await evidence.listAssetEvidenceLinks({ project: '大麦雄性不育' })).length, 1)
    assert.ok((await knowledge.listNodes()).some(item => item.project === '大麦雄性不育'))
    assert.equal((await createEvidenceVaultStore().readOrganizerJournal()).fileId, 'file-1')
    await knowledge.restoreProjectOrganization(knowledgePlan)
    await evidence.restoreProjectOrganization(evidencePlan)
    assert.equal((await evidence.list({ project: 'barley-NP1-IPE1-family' })).length, 1)
    assert.equal((await evidence.listAssetEvidenceLinks({ project: 'barley-NP1-IPE1-family' })).length, 1)
  } finally { fake.restore() }
})
