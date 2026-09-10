import test from 'node:test'
import assert from 'node:assert/strict'
import { createEvidenceStore } from '../src/evidence-store.js'

test('同一会话的证据索引跨实例实时同步，且不依赖 localStorage', () => {
  const sessionId = `evidence-${Date.now()}-${Math.random()}`
  const writer = createEvidenceStore(sessionId)
  const reader = createEvidenceStore(sessionId)
  const updates = []
  reader.subscribe(value => updates.push(value))

  writer.recordWorkflow({ id: 'review-paper', name: '审阅论文', resourceIds: ['pubmed'] })

  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0].workflows, [{ id: 'review-paper', name: '审阅论文', resourceIds: ['pubmed'], at: updates[0].workflows[0].at }])
  assert.equal(reader.get().workflows.length, 1)
})

test('不同会话的证据索引相互隔离', () => {
  const suffix = `${Date.now()}-${Math.random()}`
  const first = createEvidenceStore(`first-${suffix}`)
  const second = createEvidenceStore(`second-${suffix}`)

  first.recordWorkflow({ id: 'review-paper', name: '审阅论文' })

  assert.equal(first.get().workflows.length, 1)
  assert.equal(second.get().workflows.length, 0)
})
