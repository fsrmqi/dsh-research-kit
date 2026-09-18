import test from 'node:test'
import assert from 'node:assert/strict'
import {
  currentResearchContext, setResearchProject, startResearchRun,
  activeResearchRun, listResearchRuns,
} from '../src/research-context-store.js'

function installStorage() {
  const rows = new Map()
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => rows.get(key) || null,
    setItem: (key, value) => rows.set(key, String(value)),
  }
  return () => { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous }
}

test('研究上下文：项目与运行可跨读取复用，且不保存 Prompt', () => {
  const restore = installStorage()
  try {
    setResearchProject('水稻耐盐性')
    const run = startResearchRun({ sessionId: 's-1', workflowId: 'review-paper', workflowName: '审阅论文', stages: ['检索', '核验'], status: 'active', now: 123 })
    assert.equal(currentResearchContext().project, '水稻耐盐性')
    assert.equal(activeResearchRun()?.id, run.id)
    assert.equal(listResearchRuns({ project: '水稻耐盐性', sessionId: 's-1' }).length, 1)
    assert.equal('prompt' in run, false)
    assert.equal('text' in run, false)
  } finally { restore() }
})
