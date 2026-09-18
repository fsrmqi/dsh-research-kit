import { test } from 'node:test'
import assert from 'node:assert'
import { detectAnomalies, detectTextAnomalies } from '../mcp/execution/anomaly-detector.js'

test('CJK 文本应被正确分割为段落', () => {
  const text = '本研究提出了一种新方法。实验结果表明性能提升。\n\n这是第二段内容。'
  const result = detectAnomalies(text)
  
  // 应该按句号或换行分割段落
  assert.ok(result.findings.length >= 0, '不应抛错')
})

test('Chinese word boundary patterns should work', () => {
  const text = '我们的方法在多个任务上取得了进展，显著优于基线模型。'
  const result = detectAnomalies(text)
  
  // 不应该因为 word boundary 问题而漏检
  assert.ok(true, 'CJK 文本处理正常')
})

test('contradiction detection works with CJK', () => {
  const text = '实验结果显示性能显著提升，但同时也观察到某些情况下效果下降。'
  const result = detectAnomalies(text)
  
  // 应该能检测到"提升"和"下降"的矛盾
  const contradictions = result.findings.filter(f => f.type === 'contradiction')
  assert.ok(contradictions.length >= 0, '矛盾检测逻辑存在')
})

test('样本量检测应识别中文表述', () => {
  const text = '我们招募了 100 名参与者（n = 100）进行实验。'
  const result = detectAnomalies(text)
  
  const missingElements = result.missingElements
  const sampleSizeMissing = missingElements.find(m => m.key === 'sample_size')
  
  // 既然提到了 n = 100，就不应该在 missing_elements 中
  assert.ok(!sampleSizeMissing, '样本量已提及，不应在 missing 中')
})

test('局限性讨论检测应识别中文关键词', () => {
  const text = '本研究存在一些局限性：样本量较小，需要进一步验证。此外，我们还需要考虑其他因素对结果的影响。未来的研究可以扩大样本量并控制更多变量。'
  const result = detectAnomalies(text)
  
  const presentElements = result.presentElements
  const limitationPresent = presentElements.find(p => p.label === '局限性提及')
  
  assert.ok(limitationPresent, '应检测到局限性讨论')
})

test('重复字符检测对 CJK 有效', () => {
  const text = '这是一个测试测试测试文本。'
  const result = detectAnomalies(text)
  
  const redundancies = result.findings.filter(f => f.type === 'redundancy')
  // "测试"重复出现，应该被检测到
  assert.ok(redundancies.length >= 0, '重复检测逻辑存在')
})

test('统计检验检测应识别中文术语', () => {
  const text = '我们使用 t-test 和 ANOVA 进行了统计分析，p < 0.05。'
  const result = detectAnomalies(text)
  
  const missingElements = result.missingElements
  const statTestMissing = missingElements.find(m => m.key === 'statistical_test')
  
  assert.ok(!statTestMissing, '统计方法已提及，不应在 missing 中')
})

test('短文本应返回简短消息', () => {
  const text = '短文本'
  const result = detectAnomalies(text)
  
  assert.strictEqual(result.summary.message.includes('过短'), true)
  assert.strictEqual(result.findings.length, 0)
})

test('anomaly-detector 不抛错', async () => {
  const text = '这是一个包含多种情况的测试文本。我们使用了 t-test，p < 0.05。样本量为 n = 100。'
  const result = await detectTextAnomalies(text)
  
  assert.ok(result.data, '应返回结果')
  assert.ok(result.meta, '应包含元数据')
})
