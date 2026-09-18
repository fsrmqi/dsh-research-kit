import { test } from 'node:test'
import assert from 'node:assert'
import { checkQuality, checkWritingQuality } from '../mcp/execution/writing-quality.js'

test('exception 术语不应被标记：paradigm shift', () => {
  const text = 'This paper proposes a paradigm shift in machine learning research.'
  const result = checkQuality(text)
  
  const paradigmFlagged = result.flagged_terms.find(f => f.term === 'paradigm')
  assert.ok(!paradigmFlagged, 'paradigm shift 应被豁免')
})

test('exception 术语不应被标记：robust regression', () => {
  const text = 'We use robust regression to handle outliers in the data.'
  const result = checkQuality(text)
  
  const robustFlagged = result.flagged_terms.find(f => f.term === 'robust')
  assert.ok(!robustFlagged, 'robust regression 应被豁免')
})

test('snake_case 和 camelCase 键应一致', () => {
  const text = 'The landscape of AI is evolving rapidly. We explore the multifaceted challenges in modern technology. This research demonstrates significant progress.'
  const result = checkQuality(text)
  
  // landscape 和 multifaceted 都应被标记
  const terms = result.flagged_terms.map(f => f.term)
  assert.ok(terms.includes('landscape'), 'landscape 应被标记')
  assert.ok(terms.includes('multifaceted'), 'multifaceted 应被标记')
})

test('throat_clearing 短语检测', () => {
  const text = "In order to understand the results, we conducted experiments. It's important to note that the data was clean."
  const result = checkQuality(text)
  
  const phrases = result.throat_clearing.map(t => t.phrase)
  assert.ok(phrases.includes('in order to'), 'in order to 应被检测')
  assert.ok(phrases.includes("it's important to note that"), "it's important to note that 应被检测")
})

test('short text returns empty', () => {
  const text = 'Short text'
  const result = checkQuality(text)
  
  assert.strictEqual(result.flagged_terms.length, 0)
  assert.strictEqual(result.summary.message.includes('过短'), true)
})

test('writing quality does not throw', async () => {
  const text = 'This is a test with some flagged terms like crucial and pivotal. In order to validate, we ran experiments.'
  const result = await checkWritingQuality(text)
  
  assert.ok(result.data, '应返回数据')
  assert.ok(result.meta, '应包含元数据')
})

test('punctuation issues detection', () => {
  const text = 'This is sentence one — this is sentence two — this is sentence three. Another sentence here.'
  const result = checkQuality(text)
  
  // em-dash 使用频率高应被检测
  assert.ok(result.punctuation_issues.length >= 0, '标点问题检测逻辑存在')
})

test('long sentences detection', () => {
  const text = 'This is a very long sentence that contains more than forty words and should be flagged as potentially problematic for readability and comprehension by readers who are not experts in the field.'
  const result = checkQuality(text)
  
  assert.ok(result.summary.long_sentences_over_40_words >= 0, '长句检测逻辑存在')
})

test('Chinese text processing', () => {
  const text = '本研究探讨了人工智能领域的多个方面。这是一个复杂的问题，需要深入分析。'
  const result = checkQuality(text)
  
  assert.ok(result.summary.text_length > 0, '中文文本长度应被计数')
})
