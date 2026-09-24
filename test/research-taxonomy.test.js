import test from 'node:test'
import assert from 'node:assert/strict'
import { inferResearchClassification, isControlledResearchTopic, normalizeResearchClassification } from '../src/lib/research-taxonomy.js'

test('科研主题可多标签命中，并与物种／方法维度分开', () => {
  const classification = inferResearchClassification('大麦 NP1 雄性不育，RNA-seq 分析基因表达调控')
  assert.ok(classification.topics.some(item => item.primary === '作物遗传育种' && item.secondary === '雄性不育'))
  assert.ok(classification.topics.some(item => item.primary === '分子机制'))
  assert.ok(classification.facets.organism.includes('大麦'))
  assert.ok(classification.facets.method.includes('RNA-seq'))
  assert.equal(classification.reviewed, false)
  assert.equal(isControlledResearchTopic('作物遗传育种', '雄性不育'), true)
  assert.equal(isControlledResearchTopic('随机项目', '临时任务'), false)
})

test('人工确认的主题不因新文本命中而被静默覆盖', () => {
  const value = normalizeResearchClassification({ reviewed: true, topics: [{ primary: '研究方法', secondary: '统计分析' }] }, '大麦雄性不育')
  assert.deepEqual(value.topics.map(item => `${item.primary}/${item.secondary}`), ['研究方法/统计分析'])
  assert.equal(value.topics[0].source, 'researcher')
})
