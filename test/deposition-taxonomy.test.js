import test from 'node:test'
import assert from 'node:assert/strict'
import {
  autoDepositionTags, inferDepositionTopics, topicForDepositedItem,
  visibleDepositionTags, groupDepositedItems, UNCLASSIFIED_TOPIC,
} from '../src/lib/deposition-taxonomy.js'
import { filterAssets } from '../src/lib/vault-core.js'
import { filterEvidence } from '../src/lib/evidence-vault-core.js'

test('自动沉淀生成多个受控标签，来源类型与内容类型独立保留', () => {
  const tags = autoDepositionTags({ text: 'Ghd7 基因调控水稻耐盐性，见 DOI 10.1038/example', kind: 'finding', identifierKind: 'doi' })
  assert.deepEqual(tags, ['自动沉淀', '研究发现', '主题:植物科学', '主题:基因与分子', '主题:文献与证据', '来源:DOI'])
  assert.deepEqual(inferDepositionTopics('普通问候'), [])
})

test('已保存主题优先；旧条目即时归类但不改写人工标签', () => {
  const old = { id: 'old', title: '水稻耐盐性研究', tags: ['人工重点'] }
  assert.equal(topicForDepositedItem(old), '植物科学')
  assert.deepEqual(visibleDepositionTags(old), ['人工重点', '主题:植物科学'])
  assert.deepEqual(old.tags, ['人工重点'])
  assert.deepEqual(visibleDepositionTags({ title: '水稻基因研究', tags: [] }), ['主题:植物科学', '主题:基因与分子'])
  assert.equal(topicForDepositedItem({ tags: ['主题:临床医学'], title: '水稻' }), '临床医学')
  assert.equal(topicForDepositedItem({ title: '无匹配' }), UNCLASSIFIED_TOPIC)
})

test('分组每条只出现一次，未知主题留待归类；搜索能命中动态主题', () => {
  const rows = [
    { id: 'unknown', title: '其他', body: '', tags: [] },
    { id: 'plant', title: '水稻耐盐性', body: '', tags: [] },
    { id: 'gene', title: '基因表达', body: '', tags: [] },
  ]
  const groups = groupDepositedItems(rows)
  assert.deepEqual(groups.map(group => group.topic), ['植物科学', '基因与分子', '待归类'])
  assert.deepEqual(groups.flatMap(group => group.rows.map(row => row.id)).sort(), rows.map(row => row.id).sort())
  assert.deepEqual(filterAssets(rows, { query: '主题:植物科学' }).map(row => row.id), ['plant'])
  assert.deepEqual(filterEvidence(rows, { query: '主题:基因与分子' }).map(row => row.id), ['gene'])
})
