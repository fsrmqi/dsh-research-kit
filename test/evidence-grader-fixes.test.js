import { test } from 'node:test'
import assert from 'node:assert'
import { gradeEvidence, gradeLabel } from '../mcp/execution/evidence-grader.js'

test('arXiv 来源应评为 inference，而非 missing', () => {
  const entry = {
    identifier_type: 'arxiv',
    identifier: '2301.00001',
    title: 'Machine Learning Advances',
    note: 'A novel approach to transformer models',
  }
  const result = gradeEvidence(entry)
  assert.strictEqual(result.grade, 'inference', 'arXiv 有标识符应评为推论级')
  assert.ok(result.confidence >= 0.5 && result.confidence <= 0.7, '置信度应在合理范围')
})

test('URL 来源应评为 inference，而非 missing', () => {
  const entry = {
    identifier_type: 'none',
    url: 'https://example.com/paper',
    title: 'Example Paper',
    note: 'Some research findings',
  }
  const result = gradeEvidence(entry)
  assert.strictEqual(result.grade, 'inference', 'URL 有链接应评为推论级')
})

test('DOI 且无推断用语应评为 empirical', () => {
  const entry = {
    identifier_type: 'doi',
    identifier: '10.1038/s41586-023-06001-1',
    title: 'Nature Article',
    note: 'Experimental results on protein folding',
  }
  const result = gradeEvidence(entry)
  assert.strictEqual(result.grade, 'empirical', 'DOI 实证级')
  assert.strictEqual(result.confidence, 0.7, '无强主张用语时 confidence=0.7')
})

test('DOI 含强主张用语 confidence 应为 0.85', () => {
  const entry = {
    identifier_type: 'doi',
    identifier: '10.1038/s41586-023-06001-1',
    title: 'Proven Mechanism',
    note: 'We prove that X causes Y through rigorous experiments',
  }
  const result = gradeEvidence(entry)
  assert.strictEqual(result.grade, 'empirical', 'DOI 仍是实证级')
  assert.strictEqual(result.confidence, 0.85, '含强主张用语时 confidence=0.85')
})

test('gradeLabel 返回中文标签', () => {
  assert.strictEqual(gradeLabel('empirical'), '实证')
  assert.strictEqual(gradeLabel('inference'), '推论')
  assert.strictEqual(gradeLabel('missing'), '缺失')
  assert.strictEqual(gradeLabel('ungraded'), '未分级')
  assert.strictEqual(gradeLabel('unknown'), 'unknown') // 未知值原样返回
})

test('pmcid 来源应评为 empirical', () => {
  const entry = {
    identifier_type: 'pmcid',
    identifier: 'PMC1234567',
    title: 'PubMed Central Article',
    note: 'Clinical trial results',
  }
  const result = gradeEvidence(entry)
  assert.strictEqual(result.grade, 'empirical', 'PMCID 是 peer-reviewed 类型')
})

test('nct 试验编号应评为 empirical', () => {
  const entry = {
    identifier_type: 'nct',
    identifier: 'NCT01234567',
    title: 'Clinical Trial Registration',
    note: 'Phase III randomized controlled trial',
  }
  const result = gradeEvidence(entry)
  assert.strictEqual(result.grade, 'empirical', 'NCT 是 peer-reviewed 类型')
})

test('纯 URL 无标识符仍为 inference 不是 missing', () => {
  const entry = {
    identifier_type: 'none',
    url: 'https://blog.example.com/research',
    title: 'Research Blog Post',
  }
  const result = gradeEvidence(entry)
  assert.strictEqual(result.grade, 'inference', 'URL 可追溯但弱于 DOI')
  assert.strictEqual(result.confidence, 0.5, 'URL 的 confidence=0.5')
})
