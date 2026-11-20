import test from 'node:test'
import assert from 'node:assert/strict'
import {
  currentResearchContext, setResearchProject, startResearchRun,
  activeResearchRun, listResearchRuns, resumeResearchRun,
} from '../src/research-context-store.js'
import { workspaceIdForProject } from '../src/lib/research-workspaces.js'
import { buildLiteratureReviewExport } from '../src/lib/literature-review-export.js'

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
    assert.equal(run.workspaceId, workspaceIdForProject('水稻耐盐性'))
    assert.equal(listResearchRuns({ project: '水稻耐盐性', sessionId: 's-1' }).length, 1)
    assert.equal('prompt' in run, false)
    assert.equal('text' in run, false)
  } finally { restore() }
})

test('从另一会话恢复原运行，不重建记录，拒绝跨项目恢复', () => {
  const restore = installStorage()
  try {
    setResearchProject('综述项目')
    const first = startResearchRun({ sessionId: 'old', workflowId: 'literature-review' })
    startResearchRun({ sessionId: 'new', workflowId: 'literature-review' })
    assert.deepEqual(resumeResearchRun(first.id), first)
    assert.equal(activeResearchRun().id, first.id)
    assert.equal(listResearchRuns({ project: '综述项目' }).length, 2)
    setResearchProject('另一项目')
    assert.equal(currentResearchContext().activeRunId, '')
    assert.equal(resumeResearchRun(first.id), null)
    assert.equal(resumeResearchRun(first.id, '综述项目'), null)
  } finally { restore() }
})

test('综述导出按稳定证据 ID 保留人工理由、支持与反驳，并显式标记缺失来源', () => {
  const report = buildLiteratureReviewExport({
    project: '综述项目', exportedAt: 1,
    entries: [{ id: 'a', title: '纳入文献', identifierKind: 'doi', identifier: '10.1234/a' }, { id: 'b', title: '排除文献' }],
    ledger: [
      { kind: 'screening', evidenceId: 'a', decision: 'include', at: 2 },
      { kind: 'screening', evidenceId: 'b', decision: 'include', at: 1 },
      { kind: 'screening', evidenceId: 'b', decision: 'exclude', reason: '__proto__', at: 3 },
    ],
    claims: [{
      id: 'c', state: 'verified', assessed_by: '审核者', assessment_reason: '核对原文及方法',
      links: [{ evidenceId: 'a', stance: 'supports' }, { evidenceId: 'missing', stance: 'refutes' }],
    }],
  })
  assert.deepEqual(report.summary, { candidates: 2, included: 1, excluded: 1, pending: 0 })
  assert.equal(report.excludedReasons.__proto__, 1)
  assert.equal(report.claims[0].reason, '核对原文及方法')
  assert.deepEqual(report.claims[0].links.map(link => [link.stance, link.sourceAvailable]), [['supports', true], ['refutes', false]])
  assert.match(report.bibtex, /10\.1234\/a/)
  assert.doesNotMatch(report.bibtex, /排除文献/)
})
