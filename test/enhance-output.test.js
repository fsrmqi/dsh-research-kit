import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEnhanceOutput, DIAGNOSIS_LABELS, DIAGNOSIS_DIMENSIONS } from '../src/lib/enhance-output.js'

test('解析诊断块与改写正文的协议分隔', () => {
  const raw = [
    '[DIAG] concept_clarity: 「优化」未定义',
    '[DIAG] hidden_premise: [GAP] 假设了有历史数据',
    '[DIAG] falsifiability: [OK]',
    '[DIAG] actionability: 产出摘要一份',
    '[DIAG] context_fit: 契合',
    '===PROMPT===',
    '改写后的研究提示词'
  ].join('\n')
  const parsed = parseEnhanceOutput(raw)
  assert.equal(parsed.prompt, '改写后的研究提示词')
  assert.equal(parsed.diagnosis.concept_clarity, '「优化」未定义')
  assert.equal(parsed.diagnosis.hidden_premise, '[GAP] 假设了有历史数据')
  assert.equal(parsed.diagnosisMeta.status, 'complete')
  assert.deepEqual(parsed.diagnosisMeta.missingDimensions, [])
})

test('流式模式剥离尚未传完的协议尾巴', () => {
  const parsed = parseEnhanceOutput('改写正文第一行\n[DIAG]', { streaming: true })
  assert.equal(parsed.prompt, '改写正文第一行')
})

test('无诊断的纯正文原样通过', () => {
  const text = '只是一段普通提示词，没有协议行。'
  const parsed = parseEnhanceOutput(text)
  assert.equal(parsed.prompt, text)
  assert.equal(parsed.diagnosis, null)
  assert.equal(parsed.diagnosisMeta.status, 'missing')
})

test('未知维度进 warnings，不进 diagnosis', () => {
  const raw = '[DIAG] nonsense_dim: 无效\n===PROMPT===\n正文'
  const parsed = parseEnhanceOutput(raw)
  assert.equal(parsed.prompt, '正文')
  assert.ok(parsed.diagnosisMeta.warnings.includes('unknown_dimension'))
  assert.equal(parsed.diagnosis, null)
})

test('中文别名维度可识别且键序与标签表一致', () => {
  const raw = '[DIAG] 概念澄清: 未定义\n===PROMPT===\n正文'
  const parsed = parseEnhanceOutput(raw)
  assert.equal(parsed.diagnosis.concept_clarity, '未定义')
  assert.deepEqual(DIAGNOSIS_DIMENSIONS, Object.keys(DIAGNOSIS_LABELS))
})
