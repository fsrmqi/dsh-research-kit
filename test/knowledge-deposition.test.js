import test from 'node:test'
import assert from 'node:assert/strict'
import { installFakeIndexedDB } from './helpers/fake-indexeddb.js'
import { createKnowledgeStore, knowledgeStore } from '../src/knowledge-store.js'
import {
  depositAssistantMessage, attachKnowledgeDeposition,
  isAutoDepositEnabled, setAutoDepositEnabled,
  readDepositionCursor, writeDepositionCursor, depositionCursorKey,
} from '../src/knowledge-deposition.js'

// 自动沉淀编排：全链路（知识/证据/资产）、去重、事件接线、水位线与开关语义。
// 依赖全部可注入或可装桩：IndexedDB 走 fake，localStorage 用极小桩，资产用内存 stub。

const fake = installFakeIndexedDB()

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function installFakeLocalStorage() {
  const store = new Map()
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: key => { store.delete(key) },
  }
  return { store, restore() { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous } }
}

function makeAssetProviderStub() {
  const assets = []
  let counter = 0
  return {
    assets,
    list: async () => [...assets],
    save: async input => {
      const asset = { id: `asset-stub-${++counter}`, ...input }
      assets.unshift(asset)
      return asset
    },
  }
}

function makeEventSource() {
  const listeners = new Set()
  let snapshot = { entries: [], revision: 0 }
  return {
    getSnapshot: () => snapshot,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    push(event) {
      snapshot = { ...snapshot, entries: [...snapshot.entries, event], revision: snapshot.revision + 1 }
      for (const listener of [...listeners]) listener()
    },
  }
}

function makeSessionHarness(sessionId, eventSource) {
  const listListeners = new Set()
  return {
    list: {
      getSnapshot: () => ({ current: sessionId }),
      subscribe: fn => { listListeners.add(fn); return () => listListeners.delete(fn) },
    },
    binding: id => (String(id) === String(sessionId) ? { eventSource } : null),
  }
}

test('自动沉淀全链路：知识入库、证据入库、资产创建并相互关联', async () => {
  const store = createKnowledgeStore()
  const assetProvider = makeAssetProviderStub()
  const saved = []
  const summary = await depositAssistantMessage({
    text: '研究表明，Ghd7 可能影响水稻耐盐性。关键文献 https://doi.org/10.1038/test1234。',
    sessionId: 's-full', seq: 5, turn: 1, at: 12345,
    assetProvider, store,
    saveEvidence: async input => { saved.push(input); return { entry: { id: `ev-${saved.length}` } } },
    activeProject: '测试项目',
  })
  assert.equal(summary.extracted, true)
  assert.ok(summary.addedNodes + summary.mergedNodes >= 4, '基因/物种/性状/发现都应入库')
  assert.equal(summary.savedEvidence, 1, 'DOI 与 doi.org 链接是同一来源，只入库一条')
  const evidence = saved[0]
  assert.equal(evidence.project, '测试项目')
  assert.equal(evidence.identifier, '10.1038/test1234')
  assert.ok((evidence.tags || []).includes('自动沉淀'), '自动沉淀的证据必须带标记，便于用户辨认与筛选')
  assert.ok(summary.savedAssets >= 1, '发现应沉淀为灵感资产')
  const asset = assetProvider.assets[0]
  assert.equal(asset.epistemicStatus, 'to_verify')
  assert.equal(asset.verification?.status, 'pending', '自动沉淀的资产必须「待验证」')
  assert.equal(asset.thinkingKind, 'conclusion')
  assert.equal(asset.project, '测试项目')
  assert.equal(asset.provenance?.kind, 'auto-deposition')
  const nodes = await store.listNodes()
  const finding = nodes.find(node => node.kind === 'finding')
  assert.ok(finding, '应有发现节点')
  assert.deepEqual(finding.evidenceIds, ['ev-1'], '发现节点应关联证据条目')
  assert.ok(finding.sources.some(source => source.seq === 5 && source.sessionId === 's-full'), '节点应保留来源消息')
  assert.ok(finding.assetId, '发现节点应记录对应资产 id（图谱 deposited 边的数据源）')
  const gene = nodes.find(node => node.label === 'Ghd7')
  assert.ok(gene && !gene.assetId, '实体节点不进灵感资产，只作为关系端点')
})

test('重复消息合并：同一来源命中证据库去重，同一结论不重复建资产', async () => {
  const store = createKnowledgeStore()
  const assetProvider = makeAssetProviderStub()
  let calls = 0
  const saveEvidence = async () => {
    calls++
    if (calls === 1) return { entry: { id: 'ev-dup-1' } }
    const error = new Error('该来源已在本项目证据库中。')
    error.code = 'DUPLICATE'
    throw error
  }
  const text = '研究表明，Ghd7 可能影响水稻耐盐性。见 doi.org/10.1038/dup1。'
  const first = await depositAssistantMessage({ text, sessionId: 's-dup', seq: 1, assetProvider, store, saveEvidence, activeProject: '' })
  assert.equal(first.savedEvidence, 1)
  assert.ok(first.savedAssets >= 1)
  const second = await depositAssistantMessage({ text, sessionId: 's-dup', seq: 2, assetProvider, store, saveEvidence, activeProject: '' })
  assert.equal(second.duplicateEvidence, 1, '同一来源第二次沉淀应命中证据库去重')
  assert.equal(second.savedEvidence, 0)
  assert.equal(second.savedAssets, 0, '同一结论不应重复建资产卡')
  assert.ok(second.skippedAssets >= 1)
  assert.ok(second.mergedNodes >= 4, '知识节点应走合并路径')
})

test('事件接线：回答完成事件触发沉淀，水位线防止事件重放导致重复', async () => {
  const storage = installFakeLocalStorage()
  try {
    setAutoDepositEnabled(true)
    assert.equal(isAutoDepositEnabled(), true)
    const eventSource = makeEventSource()
    const assetProvider = makeAssetProviderStub()
    const sessions = makeSessionHarness('sess-live', eventSource)
    const before = (await knowledgeStore().listNodes()).length
    const dispose = attachKnowledgeDeposition({ sessions }, { assetProvider })
    eventSource.push({
      type: 'assistant/message', seq: 5, time: 111,
      data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '研究表明，Ghd7 促进水稻耐盐性。' }] } },
    })
    await sleep(30)
    const after = await knowledgeStore().listNodes()
    assert.ok(after.length > before, '回答完成后应自动沉淀知识节点')
    assert.equal(readDepositionCursor('sess-live'), 5, '处理后水位线应推进')
    assert.ok(assetProvider.assets.length >= 1, '事件驱动的沉淀也应创建灵感资产')
    // 再次通知（模拟刷新后事件窗口重放同一段历史）：水位线保证不重复入库。
    eventSource.push({ type: 'tool/call', seq: 6, data: {} })
    await sleep(30)
    assert.equal((await knowledgeStore().listNodes()).length, after.length, '旧消息不得因事件重放而重复沉淀')
    dispose()
  } finally {
    storage.restore()
  }
})

test('开关语义：关闭时不沉淀但水位线照常前进；interrupted 半截回答跳过；开启后不回溯', async () => {
  const storage = installFakeLocalStorage()
  try {
    setAutoDepositEnabled(false)
    const eventSource = makeEventSource()
    const sessions = makeSessionHarness('sess-off', eventSource)
    const dispose = attachKnowledgeDeposition({ sessions }, { assetProvider: makeAssetProviderStub() })
    eventSource.push({
      type: 'assistant/message', seq: 10,
      data: { message: { content: [{ type: 'text', text: '研究表明，OsNAC3 促进水稻耐盐性。' }] } },
    })
    await sleep(30)
    assert.equal(readDepositionCursor('sess-off'), 10, '关闭期间水位线仍前进')
    assert.equal((await knowledgeStore().listNodes()).filter(node => node.label.includes('OsNAC3')).length, 0)
    // interrupted = 被取消的半截回答：即使开启也不提取，但水位线照常推进。
    eventSource.push({
      type: 'assistant/message', seq: 11,
      data: { interrupted: true, message: { content: [{ type: 'text', text: '研究表明，OsNAC3 促进水稻耐盐性。' }] } },
    })
    await sleep(30)
    assert.equal(readDepositionCursor('sess-off'), 11)
    // 开启开关：只处理新回答，绝不回放关闭期间的消息。
    setAutoDepositEnabled(true)
    eventSource.push({
      type: 'assistant/message', seq: 12,
      data: { message: { content: [{ type: 'text', text: '研究表明，OsNAC3 促进水稻耐盐性。' }] } },
    })
    await sleep(30)
    assert.ok((await knowledgeStore().listNodes()).some(node => node.label.includes('OsNAC3')), '开启后的新回答应被沉淀')
    // 过短消息跳过提取，但水位线照常推进。
    const count = (await knowledgeStore().listNodes()).length
    eventSource.push({
      type: 'assistant/message', seq: 13,
      data: { message: { content: [{ type: 'text', text: '太短' }] } },
    })
    await sleep(30)
    assert.equal(readDepositionCursor('sess-off'), 13)
    assert.equal((await knowledgeStore().listNodes()).length, count)
    dispose()
  } finally {
    storage.restore()
  }
})

test('水位线读写往返与键名约定', () => {
  const storage = installFakeLocalStorage()
  try {
    assert.equal(readDepositionCursor('sess-x'), 0, '未记录过的会话水位线为 0')
    writeDepositionCursor('sess-x', 42)
    assert.equal(readDepositionCursor('sess-x'), 42)
    assert.equal(depositionCursorKey('sess-x'), 'dsh-research-kit.deposition.cursor.sess-x')
  } finally {
    storage.restore()
  }
})

test('宿主未提供 sessions 服务时静默跳过，不抛错', () => {
  const dispose = attachKnowledgeDeposition({}, {})
  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(() => dispose())
})
