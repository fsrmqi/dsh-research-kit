import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { installFakeIndexedDB } from './helpers/fake-indexeddb.js'
import { createEvidenceVaultStore } from '../src/evidence-vault-store.js'
import { buildEvidenceGraph } from '../src/lib/evidence-graph-core.js'
import {
  assetEvidenceLinkId, normalizeAssetEvidenceLink,
  deriveAssetEvidenceCandidates, assetEvidenceGraphEdges,
} from '../src/lib/asset-evidence-links.js'

// 资产-证据互链（ROADMAP §11 P5）：用户显式确认的支撑关系。
// 候选只推导、确认后才建边；同一对端点按稳定 id 去重；端点消失优雅兜底。
// 风险点专项：IndexedDB v1 → v2 老库升级（evidence store 不丢、links store 补建）。

test('link 身份与规范化：稳定 id 去重，端点缺失拒绝入库', () => {
  assert.equal(assetEvidenceLinkId('a1', 'e9'), 'asset-evidence:a1::e9')
  assert.equal(assetEvidenceLinkId('a1', 'e9'), assetEvidenceLinkId('a1', 'e9'), '同一对端点必得同一 id')
  const link = normalizeAssetEvidenceLink({ assetId: ' a1 ', evidenceId: 'e9', project: 'P', createdAt: 5 })
  assert.deepEqual(link, { id: 'asset-evidence:a1::e9', assetId: 'a1', evidenceId: 'e9', project: 'P', createdAt: 5 })
  assert.throws(() => normalizeAssetEvidenceLink({ evidenceId: 'e9' }), /assetId/)
  assert.throws(() => normalizeAssetEvidenceLink({ assetId: 'a1' }), /evidenceId/)
  // 图谱边形状：畸形行跳过，合法行带 supports 关系（属性名随图谱核心约定为 kind）。
  assert.deepEqual(assetEvidenceGraphEdges([{ assetId: 'a1', evidenceId: 'e9' }, { assetId: 'a2' }, null]), [
    { from: 'asset:a1', to: 'evidence:e9', kind: 'supports' },
  ])
})

test('候选推导：知识链种子跨项目最高分；同项目与共同标签次之；已关联端点排除', () => {
  const asset = { id: 'a1', project: '大麦51660', tags: ['序列比对', '突变体'] }
  const entries = [
    { id: 'ev-same', title: '同项目证据', project: '大麦51660', status: 'unverified', tags: [] },
    { id: 'ev-tag', title: '标签重合证据', project: '大麦51660', status: 'unverified', tags: ['序列比对', '面板'] },
    { id: 'ev-chain', title: '知识链同源证据', project: '其他项目', status: 'verified', tags: [] },
    { id: 'ev-other', title: '无关项目证据', project: '别的项目', status: 'unverified', tags: [] },
    { id: 'ev-linked', title: '已关联证据', project: '大麦51660', status: 'unverified', tags: [] },
    { id: '', title: '无 id 不参与', project: '大麦51660' },
  ]
  const knowledgeNodes = [{ id: 'k1', assetId: 'a1', evidenceIds: ['ev-chain'] }]
  const existingLinks = [{ assetId: 'a1', evidenceId: 'ev-linked' }]
  const candidates = deriveAssetEvidenceCandidates({ asset, evidenceEntries: entries, knowledgeNodes, existingLinks })
  assert.equal(candidates.some(row => row.evidenceId === 'ev-linked'), false, '已关联端点不再出现在候选里')
  assert.equal(candidates.some(row => row.evidenceId === 'ev-other'), false, '无信号源的跨项目条目不推荐')
  assert.equal(candidates[0].evidenceId, 'ev-chain', '知识链种子最高分且跨项目成立')
  assert.match(candidates[0].reasons[0], /知识链同源/)
  const tagRow = candidates.find(row => row.evidenceId === 'ev-tag')
  assert.ok(tagRow.score > candidates.find(row => row.evidenceId === 'ev-same').score, '共同标签加分')
  assert.match(tagRow.reasons.join('；'), /共同标签：序列比对/)
  // 确定性：同一输入重复推导 deepEqual；limit 生效。
  const again = deriveAssetEvidenceCandidates({ asset, evidenceEntries: entries, knowledgeNodes, existingLinks })
  assert.deepEqual(candidates, again)
  // limit 生效：同项目资产在限流下只出 1 条。
  assert.equal(deriveAssetEvidenceCandidates({ asset: { id: 'a1', project: '大麦51660' }, evidenceEntries: entries, limit: 1 }).length, 1)
  assert.deepEqual(deriveAssetEvidenceCandidates({ asset: {} }), [], '无 id 资产不出候选')
})

test('存储：v1 老库升级到 v2 不丢数据，links store 补建可用', async () => {
  const fake = installFakeIndexedDB()
  try {
    // 手工预置一个 v1 老库：只有 evidence store 与一条既有条目。
    const raw = fake.fake.open('dsh-research-kit-evidence', 1)
    await new Promise((resolve, reject) => {
      raw.onsuccess = resolve
      raw.onerror = reject
      raw.onupgradeneeded = () => { raw.result.createObjectStore('evidence', { keyPath: 'id' }) }
    })
    const seedTx = raw.result.transaction('evidence')
    const putRequest = seedTx.objectStore().put({ id: 'ev-old', title: '升级前条目', status: 'unverified', project: '' })
    await new Promise((resolve, reject) => { putRequest.onsuccess = resolve; putRequest.onerror = reject })
    await new Promise(resolve => { seedTx.oncomplete = resolve })

    const store = createEvidenceVaultStore()
    const rows = await store.list()
    assert.equal(rows.length, 1, 'v1 既有条目在升级后仍在')
    assert.equal(rows[0].id, 'ev-old')
    // 新 link store 直接可用。
    const { link, created } = await store.linkAssetEvidence({ assetId: 'a1', evidenceId: 'ev-old', project: '' })
    assert.equal(created, true)
    assert.equal(link.id, 'asset-evidence:a1::ev-old')
  } finally {
    fake.restore()
  }
})

test('存储：同一对端点去重；按端点过滤；证据删除联动清链；降级路径行为一致', async () => {
  const fake = installFakeIndexedDB()
  try {
    const store = createEvidenceVaultStore()
    await store.save({ title: '证据 A', sourceDatabase: 'PubMed', identifier: '10.1/a', project: 'P' })
    const first = await store.linkAssetEvidence({ assetId: 'a1', evidenceId: 'dup-target', project: 'P' })
    assert.equal(first.created, true)
    const second = await store.linkAssetEvidence({ assetId: 'a1', evidenceId: 'dup-target', project: 'P' })
    assert.equal(second.created, false, '重复建立返回既有记录')
    assert.equal(second.link.id, first.link.id)
    await store.linkAssetEvidence({ assetId: 'a2', evidenceId: 'dup-target', project: 'P' })
    assert.equal((await store.listAssetEvidenceLinks({ assetId: 'a1' })).length, 1)
    assert.equal((await store.listAssetEvidenceLinks({ evidenceId: 'dup-target' })).length, 2)
    // 证据端点删除：以其为一端的 link 全部联动解除。
    const doomed = (await store.list({ project: 'P' }))[0]
    await store.linkAssetEvidence({ assetId: 'a1', evidenceId: doomed.id, project: 'P' })
    await store.remove(doomed.id)
    assert.equal((await store.listAssetEvidenceLinks({ evidenceId: doomed.id })).length, 0, '证据删除联动清链')
    assert.equal((await store.listAssetEvidenceLinks({ assetId: 'a1' })).some(row => row.evidenceId === 'dup-target'), true, '其他 link 不受影响')
    // 资产端批量解除。
    await store.removeAssetEvidenceLinks({ assetId: 'a1' })
    assert.equal((await store.listAssetEvidenceLinks({ assetId: 'a1' })).length, 0)
    // 总量保险丝可触发：清场后精确灌满 500 条，第 501 条被拒。
    await store.removeAssetEvidenceLinks({})
    for (let index = 0; index < 500; index++) await store.linkAssetEvidence({ assetId: `bulk-${index}`, evidenceId: 'fill', project: '' })
    let last
    try { await store.linkAssetEvidence({ assetId: 'overflow', evidenceId: 'fill' }); last = 'no-throw' } catch (error) { last = error.code }
    assert.equal(last, 'LINK_LIMIT')
  } finally {
    fake.restore()
  }

  // 降级（无 IndexedDB）：行为一致，仅驻留内存。
  const previous = globalThis.indexedDB
  delete globalThis.indexedDB
  try {
    const store = createEvidenceVaultStore()
    const first = await store.linkAssetEvidence({ assetId: 'a1', evidenceId: 'e1' })
    const second = await store.linkAssetEvidence({ assetId: 'a1', evidenceId: 'e1' })
    assert.equal(first.created, true)
    assert.equal(second.created, false)
    assert.equal(store.isDegraded(), true)
    assert.equal((await store.listAssetEvidenceLinks({ assetId: 'a1' })).length, 1)
    await store.removeAssetEvidenceLinks({ assetId: 'a1' })
    assert.equal((await store.listAssetEvidenceLinks()).length, 0)
  } finally {
    globalThis.indexedDB = previous
  }
})

test('图谱出口：互链画「资产 → 支撑证据」边；端点缺失自然剔除；随持久范围收敛', () => {
  const assets = [{ id: 'a1', title: '大麦 51660 突变体 cDNA 产物错位（分析结论）' }]
  const savedEvidence = [{ id: 'ev1', title: 'HG00516 参考文献证据', sourceDatabase: 'PubMed', identifier: '10.1/x', status: 'unverified' }]
  const links = [{ assetId: 'a1', evidenceId: 'ev1' }, { assetId: 'a1', evidenceId: 'ev-gone' }]
  const graph = buildEvidenceGraph({ assets, savedEvidence, assetEvidenceLinks: links })
  const support = graph.edges.filter(edge => edge.kind === 'supports')
  assert.deepEqual(support, [{ from: 'asset:a1', to: 'evidence:ev1', kind: 'supports' }], '悬空端点的 link 被末尾边过滤剔除')
  // 「本会话」范围不显示持久互链（视图层传空数组时等价于无）。
  const sessionOnly = buildEvidenceGraph({ assets, savedEvidence, assetEvidenceLinks: [] })
  assert.equal(sessionOnly.edges.some(edge => edge.kind === 'supports'), false)
})

test('接线：入口 A 候选勾选显式建立（绝不自动）；入口 B 只读反查；图谱消费 link 表', () => {
  // 入口 A：资产卡内的候选区与确认按钮。
  const vault = readFileSync(new URL('../src/research-vault.js', import.meta.url), 'utf8')
  assert.match(vault, /deriveAssetEvidenceCandidates/, '资产卡未接候选推导')
  assert.match(vault, /建立关联（\$\{picked\.size\}）/, '建立必须是显式按钮，且计数与勾选一致')
  assert.match(vault, /linkAssetToEvidence/, '未接建立入口')
  assert.match(vault, /removeAssetEvidenceLinks\(\{ assetId: item\.id \}\)/, '本视图的资产删除未联动清链')
  assert.match(vault, /绝不自动|不会自动发生/, '「绝不自动建边」的边界说明缺失')
  // 入口 B：证据条目只读反查 + 标题缺失兜底。
  const pane = readFileSync(new URL('../src/research-evidence-vault.js', import.meta.url), 'utf8')
  assert.match(pane, /assetTitlesById = null/, '反查标题必须由分区传入且可缺省')
  assert.match(pane, /被引用于：/, '证据条目缺少「被引用于」只读反查')
  assert.match(pane, /不在当前列表/, '反查的悬空资产要如实标注')
  assert.match(pane, /资产-证据关联关系不在备份内/, '备份导出未如实声明 link 边界')
  // 出口：图谱传入互链且只在持久范围显示。
  const graph = readFileSync(new URL('../src/research-evidence-graph.js', import.meta.url), 'utf8')
  assert.match(graph, /listAssetEvidenceLinks/)
  assert.match(graph, /assetEvidenceLinks: includePersistent \? assetEvidenceLinks : \[\]/, '互链应随「持久沉淀」范围收敛')
  const core = readFileSync(new URL('../src/lib/evidence-graph-core.js', import.meta.url), 'utf8')
  assert.match(core, /assetEvidenceGraphEdges\(assetEvidenceLinks\)/, '图谱核心未消费互链')
})
