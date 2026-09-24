import test from 'node:test'
import assert from 'node:assert/strict'
import { extractKnowledge } from '../src/lib/knowledge-extract.js'
import { createKnowledgeStore } from '../src/knowledge-store.js'
import { depositAssistantMessage } from '../src/knowledge-deposition.js'
import { reviewableAssistantMessage } from '../src/message-deposit-action.js'

test('逐条审阅按消息 ID 定位，不误用最近回答', () => {
  const entries = [
    { type: 'assistant/message', seq: 4, data: { message: { id: 'first', content: [{ type: 'text', text: '研究表明，Ghd7 促进水稻耐盐性。' }] } } },
    { type: 'assistant/message', seq: 8, data: { message: { id: 'second', content: [{ type: 'text', text: '另一条回答。' }] } } },
  ]
  const sessions = { binding: () => ({ eventSource: { getSnapshot: () => ({ entries }) } }) }
  const found = reviewableAssistantMessage(sessions, 's1', 'first')
  assert.equal(found.seq, 4)
  assert.match(found.text, /Ghd7/)
  assert.ok(found.extraction.nodes.length > 0)
  assert.equal(reviewableAssistantMessage(sessions, 's1', 'missing'), null)
})

test('确认沉淀只写入勾选的知识与引用，未勾选来源不入库', async () => {
  const text = '研究表明，Ghd7 促进水稻耐盐性。见 https://doi.org/10.1038/selected。'
  const extraction = extractKnowledge(text)
  const finding = extraction.nodes.find(node => node.kind === 'finding')
  assert.ok(finding)
  const store = createKnowledgeStore()
  const saved = []
  const summary = await depositAssistantMessage({
    text, sessionId: 'review-s1', seq: 91, store, activeProject: '审阅项目',
    selection: { nodeKeys: [finding.key], citationIndexes: [] },
    saveEvidence: async input => { saved.push(input); return { entry: { id: 'ev' } } },
  })
  assert.equal(summary.citations, 0)
  assert.equal(saved.length, 0)
  assert.ok((await store.listNodes()).some(node => node.key === finding.key))
  const citationOnly = await depositAssistantMessage({
    text, sessionId: 'review-s1', seq: 92, store, activeProject: '审阅项目',
    selection: { nodeKeys: [], citationIndexes: [0] },
    saveEvidence: async input => { saved.push(input); return { entry: { id: 'ev-2' } } },
  })
  assert.equal(citationOnly.addedNodes, 0)
  assert.equal(citationOnly.savedEvidence, 1)
  assert.equal(saved.length, 1)
})
