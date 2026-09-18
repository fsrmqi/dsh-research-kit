
import test from 'node:test'
import assert from 'node:assert/strict'
import { detectAnomalies } from '../mcp/execution/anomaly-detector.js'
import { extractClaims } from '../mcp/execution/claim-auditor.js'
import { evaluateCheckpoints } from '../mcp/state/checkpoint-manager.js'
import { generateFigure } from '../mcp/execution/figure-generator.js'
import { safeProjectName } from '../mcp/execution/evidence-store.js'

test('异常检测：显著性矛盾在同一分段内触发，短文本返回完整结构', () => {
  const result = detectAnomalies('The difference is significant. The no significant difference was also noted.')
  assert.equal(result.summary.contradictions, 1)
  const short = detectAnomalies('短')
  assert.deepEqual(short.findings, [])
  assert.equal(short.summary.message, '文本过短，无法进行有效分析。')
})

test('claim 审计：同一 DOI 的不同 claim 被正确去重，避免重复提取', () => {
  const text = [
    'CRISPR enables genome editing [1](https://doi.org/10.1038/s41586-020-2649-2).',
    'NumPy is a fruit [1](https://doi.org/10.1038/s41586-020-2649-2).',
    'NumPy is also a programming language [1](https://doi.org/10.1038/s41586-020-2649-2).',
  ].join(' ')
  const claims = extractClaims(text)
  // 同一 DOI 只提取一次（首次出现）
  assert.strictEqual(claims.length, 1, '同一 DOI 应被去重')
  assert.ok(claims[0].citation.includes('10.1038'), 'DOI 正确')
})

test('checkpoint：完成阶段命中 required 检查点才暂停', () => {
  const workflow = {
    checkpoints: [
      { after_stage: 'literature_search', action: 'review_sources', required: true },
      { after_stage: 'synthesis', action: 'human_review', required: false },
    ],
  }
  assert.equal(evaluateCheckpoints(workflow, []).should_pause, false)
  const result = evaluateCheckpoints(workflow, ['literature_search'])
  assert.equal(result.should_pause, true)
  assert.equal(result.pending_checkpoints[0].action, 'review_sources')
})

test('项目名拒绝路径逃逸片段', () => {
  assert.throws(() => safeProjectName('..'))
  assert.throws(() => safeProjectName('.'))
  assert.equal(safeProjectName('my/project'), 'my-project')
})

test('图表脚本：Python 字符串转义处理换行、反斜杠和引号', () => {
  const result = generateFigure('bar_paired_delta', {
    categories: ['A\nB'],
    baseline: [1],
    method: [2],
  }, { title: "A\nB \\ 'quote'" })
  assert.equal(result.error, undefined)
  assert.ok(result.data.script.includes("'A\\nB'"))
  assert.ok(result.data.script.includes("A\\nB \\\\ \\'quote\\'"))
})
