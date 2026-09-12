import test from 'node:test'
import assert from 'node:assert/strict'
import { installFakeIndexedDB } from './helpers/fake-indexeddb.js'
import {
  createKnowledgeStore, knowledgeNodeIdFor, knowledgeClaimIdFor, knowledgeClaimKeyFor,
} from '../src/knowledge-store.js'
import { extractKnowledge } from '../src/lib/knowledge-extract.js'

// 自动沉淀知识库：去重合并、冲突并列、持久化等价命题与内存降级。
// fake-indexeddb 的语义与证据库测试一致：数据活在桩的闭包里，重建 store 只重连不重置。

const fake = installFakeIndexedDB()

const SOURCE_A = { sessionId: 'sess-a', seq: 1, turn: 1, at: 1000, excerpt: 'Ghd7 可能影响水稻耐盐性。' }
const SOURCE_B = { sessionId: 'sess-a', seq: 2, turn: 1, at: 2000, excerpt: '再次提到 Ghd7 可能影响水稻耐盐性。' }

test('提取结果入库：节点/关系生成稳定 id，来源消息随行', async () => {
  const store = createKnowledgeStore()
  const extraction = extractKnowledge('Ghd7 可能影响水稻耐盐性。')
  const applied = await store.applyExtraction({ nodes: extraction.nodes, claims: extraction.claims, source: SOURCE_A })
  assert.equal(applied.addedNodes, 3)
  assert.equal(applied.addedClaims, 2)
  assert.ok(applied.nodes.every(node => node.id.startsWith('kn-')))
  assert.ok(applied.claims.every(claim => claim.id.startsWith('kc-')))
  const gene = applied.nodes.find(node => node.label === 'Ghd7')
  assert.equal(gene.id, knowledgeNodeIdFor(gene.key), '节点 id 由规范化 key 决定（跨消息可合并的前提）')
  assert.ok(applied.claims.every(claim => applied.nodes.some(node => node.id === claim.from) && applied.nodes.some(node => node.id === claim.to)),
    '关系端点必须解析成节点 id，不允许悬挂')
  const mayAffect = applied.claims.find(claim => claim.relation === 'may-affect')
  assert.equal(mayAffect.id, knowledgeClaimIdFor(knowledgeClaimKeyFor({
    fromKey: 'entity:gene:ghd7', relation: 'may-affect', toKey: 'entity:trait:耐盐性', polarity: 'uncertain',
  })))
  assert.deepEqual(mayAffect.sources.map(source => source.seq), [1])
})

test('相同内容合并：追加来源不重复，人工核验状态不被降级', async () => {
  const store = createKnowledgeStore()
  const extraction = extractKnowledge('Ghd7 可能影响水稻耐盐性。')
  const first = await store.applyExtraction({ nodes: extraction.nodes, claims: extraction.claims, source: SOURCE_A })
  const gene = first.nodes.find(node => node.label === 'Ghd7')
  await store.setNodeStatus(gene.id, 'verified')
  const second = await store.applyExtraction({ nodes: extraction.nodes, claims: extraction.claims, source: SOURCE_B })
  assert.equal(second.addedNodes, 0)
  assert.equal(second.mergedNodes, 3, '同一内容第二次进入应走合并而不是新增')
  assert.equal(second.mergedClaims, 2)
  const mergedGene = second.nodes.find(node => node.label === 'Ghd7')
  assert.equal(mergedGene.status, 'verified', '自动沉淀不得把人工核验状态降回待核验')
  assert.deepEqual(mergedGene.sources.map(source => source.seq), [1, 2], '两次来源消息都应保留')
  const sameSource = await store.applyExtraction({ nodes: extraction.nodes, claims: extraction.claims, source: SOURCE_A })
  const remerged = sameSource.nodes.find(node => node.label === 'Ghd7')
  assert.equal(remerged.sources.length, 2, '同一 sessionId+seq 的来源只记一次')
})

test('冲突结论并列保留：同端点不同极性/不同关系各自成记录', async () => {
  const store = createKnowledgeStore()
  await store.applyExtraction({ nodes: extractKnowledge('Ghd7 促进水稻耐盐性。').nodes, claims: extractKnowledge('Ghd7 促进水稻耐盐性。').claims, source: SOURCE_A })
  const conflict = await store.applyExtraction({ nodes: extractKnowledge('Ghd7 抑制水稻耐盐性。').nodes, claims: extractKnowledge('Ghd7 抑制水稻耐盐性。').claims, source: SOURCE_B })
  const relations = conflict.claims.filter(claim => claim.relation === 'promotes' || claim.relation === 'inhibits')
  assert.equal(relations.length, 2, '促进与抑制应并列保留，谁也不覆盖谁')
  assert.deepEqual(relations.map(claim => claim.relation).sort(), ['inhibits', 'promotes'])
})

test('持久化等价命题：同一数据库重建 store 后数据仍在', async () => {
  const first = createKnowledgeStore()
  const extraction = extractKnowledge('Ghd7 可能影响水稻耐盐性。')
  const applied = await first.applyExtraction({ nodes: extraction.nodes, claims: extraction.claims, source: SOURCE_A })
  const second = createKnowledgeStore()
  const rows = await second.listNodes()
  // 本文件前面的用例共用同一个桩数据库，这里断言「本批数据全部仍在」而非精确总数。
  assert.ok(rows.length >= applied.nodes.length)
  assert.ok(rows.some(node => node.label === 'Ghd7'))
  const claims = await second.listClaims()
  assert.ok(claims.length >= applied.claims.length)
  assert.ok(claims.some(claim => claim.relation === 'may-affect'))
})

test('证据与资产关联、删除节点级联清理关系', async () => {
  const store = createKnowledgeStore()
  const extraction = extractKnowledge('研究表明，Ghd7 促进水稻耐盐性。')
  const applied = await store.applyExtraction({ nodes: extraction.nodes, claims: extraction.claims, source: SOURCE_A })
  const gene = applied.nodes.find(node => node.label === 'Ghd7')
  await store.linkEvidence(gene.id, 'ev-1')
  await store.linkEvidence(gene.id, 'ev-1') // 重复链接幂等
  await store.setAssetId(gene.id, 'asset-9')
  const linked = (await store.listNodes()).find(node => node.id === gene.id)
  assert.deepEqual(linked.evidenceIds, ['ev-1'])
  assert.equal(linked.assetId, 'asset-9')
  await store.removeNode(gene.id)
  const after = await store.listNodes()
  const claims = await store.listClaims()
  assert.ok(!after.some(node => node.id === gene.id))
  assert.ok(claims.every(claim => claim.from !== gene.id && claim.to !== gene.id), '删除节点必须级联删除指向它的关系')
})

test('clear 只清知识库，可反复使用', async () => {
  const store = createKnowledgeStore()
  await store.applyExtraction({ nodes: extractKnowledge('Ghd7 促进水稻耐盐性。').nodes, claims: extractKnowledge('Ghd7 促进水稻耐盐性。').claims, source: SOURCE_A })
  await store.clear()
  assert.equal((await store.listNodes()).length, 0)
  assert.equal((await store.listClaims()).length, 0)
})

test('无 IndexedDB 时降级为内存存储并显式告知', async () => {
  fake.restore()
  try {
    const store = createKnowledgeStore()
    assert.equal(store.isDegraded(), true)
    const extraction = extractKnowledge('Ghd7 可能影响水稻耐盐性。')
    const applied = await store.applyExtraction({ nodes: extraction.nodes, claims: extraction.claims, source: SOURCE_A })
    assert.equal(applied.addedNodes, 3)
    assert.equal((await store.listNodes()).length, 3)
  } finally {
    installFakeIndexedDB() // 恢复桩，避免污染本文件后续用例的降级前提
  }
})
