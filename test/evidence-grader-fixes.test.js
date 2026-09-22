import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gradeEvidence, gradeLabel } from '../mcp/execution/evidence-grader.js'

test('DOI、PMID、PMCID、NCT 和预印本标识均不足以自动判定证据强度', () => {
  for (const [identifier_type, identifier] of [['doi', '10.9999/placeholder'], ['pmid', '12345678'], ['pmcid', 'PMC1234567'], ['nct', 'NCT01234567'], ['arxiv', '2301.00001']]) {
    const result = gradeEvidence({ identifier_type, identifier, title: '研究方案', status: 'unverified' })
    assert.equal(result.grade, 'ungraded', identifier_type)
    assert.ok(result.confidence <= 0.3)
  }
})

test('URL 来源有追溯线索，但不能自动评为推论', () => {
  assert.equal(gradeEvidence({ url: 'https://example.com/paper' }).grade, 'ungraded')
})

test('谨慎措辞不会把已有 DOI 判为来源缺失', () => {
  for (const note of ['结果可能有效', 'Results may suggest an effect', 'We hypothesize an effect']) {
    const result = gradeEvidence({ identifier_type: 'doi', identifier: '10.9999/example', note })
    assert.equal(result.grade, 'ungraded')
    assert.doesNotMatch(result.reasoning, /标识符或链接不完整/)
  }
})

test('强断言不提高分级或置信度', () => {
  const entry = { identifier_type: 'doi', identifier: '10.9999/example' }
  assert.deepEqual(gradeEvidence({ ...entry, note: 'We prove that X causes Y' }), gradeEvidence(entry))
})

test('gradeLabel 保留现有等级兼容性', () => {
  for (const [grade, label] of [['empirical', '实证'], ['inference', '推论'], ['missing', '缺失'], ['ungraded', '未分级'], ['unknown', 'unknown']]) {
    assert.equal(gradeLabel(grade), label)
  }
})

test('来源已核验不等于研究结论已被支持', () => {
  assert.equal(gradeEvidence({ identifier_type: 'doi', identifier: '10.9999/example', status: 'verified' }).grade, 'ungraded')
})

test('缺少来源或仅空白字段才评为缺失', () => {
  for (const entry of [{}, { identifier_type: 'doi', identifier: '  ', url: '  ' }, { identifier_type: 'none', identifier: 'unknown' }]) {
    assert.equal(gradeEvidence(entry).grade, 'missing')
  }
})

test('盘点保留来源线索，预览及应用未知分级不会覆盖人工分级', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'dsh-grade-regression-'))
  const previous = process.env.DSH_RESEARCH_KIT_HOME
  process.env.DSH_RESEARCH_KIT_HOME = home
  try {
    const { writeProjectEntries, readProjectEntries } = await import('../mcp/execution/evidence-store.js')
    const { inventoryEvidence, applyEvidenceGrades } = await import('../mcp/execution/evidence-inventory.js')
    const entry = { id: 'human-graded', identifier_type: 'doi', identifier: '10.9999/example', grade: 'empirical', graded_by: 'human', status: 'verified', project: 'review' }
    await writeProjectEntries('review', [entry])
    const inventory = await inventoryEvidence({ project: 'review' })
    assert.equal(inventory.entries[0].suggested_grade, 'ungraded')
    assert.equal(inventory.entries[0].stored_grade, 'empirical')
    assert.equal(inventory.summary.missing_traceability, 0)
    const preview = await applyEvidenceGrades({ project: 'review', evidence_ids: [entry.id] })
    assert.deepEqual(preview.plan, [])
    const applied = await applyEvidenceGrades({ project: 'review', evidence_ids: [entry.id], apply: true })
    assert.equal(applied.changed, 0)
    assert.deepEqual(await readProjectEntries('review'), [entry])
  } finally {
    if (previous === undefined) delete process.env.DSH_RESEARCH_KIT_HOME
    else process.env.DSH_RESEARCH_KIT_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})
