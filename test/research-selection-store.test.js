import test from 'node:test'
import assert from 'node:assert/strict'
import { createResearchSelectionStore } from '../src/research-selection-store.js'

test('同一会话共享资源选择，另一个会话保持隔离', () => {
  const first = createResearchSelectionStore('session-a')
  const sameSession = createResearchSelectionStore('session-a')
  const otherSession = createResearchSelectionStore('session-b')
  let observed = []
  const off = sameSession.subscribe(ids => { observed = ids })
  first.set(['pubmed', 'citation-hygiene', 'pubmed'])
  assert.deepEqual(sameSession.get(), ['pubmed', 'citation-hygiene'])
  assert.deepEqual(observed, ['pubmed', 'citation-hygiene'])
  assert.deepEqual(otherSession.get(), [])
  off()
})
