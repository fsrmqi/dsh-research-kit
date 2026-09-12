import test from 'node:test'
import assert from 'node:assert/strict'
import { installFakeIndexedDB } from './helpers/fake-indexeddb.js'
import { createKnowledgeStore, knowledgeStore } from '../src/knowledge-store.js'
import {
  depositAssistantMessage, attachKnowledgeDeposition,
  depositLatestAssistantMessage, latestDepositableMessage,
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
  const notifyAll = () => { for (const listener of [...listeners]) listener() }
  return {
    getSnapshot: () => snapshot,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    push(event) {
      snapshot = { ...snapshot, entries: [...snapshot.entries, event], revision: snapshot.revision + 1 }
      notifyAll()
    },
    // 只通知不追加：模拟宿主「每次会话活动都触发订阅回调」的行为（增量扫描的关键场景）。
    notify: notifyAll,
    // 整体替换窗口（不通知）：模拟宿主裁剪/重放历史。
    replaceEntries(entries) { snapshot = { ...snapshot, entries: [...entries] } },
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

test('project 传递：知识节点带当前项目，资产去重按（标题+项目）隔离', async () => {
  const store = createKnowledgeStore()
  const assetProvider = makeAssetProviderStub()
  // 用本文件其他用例没碰过的实体（OsNAC9/小麦/抗旱性），避免与共享桩库里的既有行纠缠。
  const text = '研究表明，OsNAC9 可能影响小麦抗旱性。'
  const first = await depositAssistantMessage({ text, sessionId: 's-proj', seq: 1, assetProvider, store, saveEvidence: async () => ({ entry: { id: 'ev-p1' } }), activeProject: '项目A' })
  assert.ok(first.savedAssets >= 1)
  const gene = (await store.listNodes()).find(node => node.label === 'OsNAC9')
  assert.equal(gene.project, '项目A', '知识节点应记录沉淀时的当前项目')

  // 同一结论在另一个项目：不应被项目 A 的资产挡住（资产侧与证据库同口径按项目隔离）
  const second = await depositAssistantMessage({ text, sessionId: 's-proj', seq: 2, assetProvider, store, saveEvidence: async () => ({ entry: { id: 'ev-p2' } }), activeProject: '项目B' })
  assert.equal(second.savedAssets, 1, '不同项目的同名结论应各自建卡')
  const projects = assetProvider.assets.map(asset => asset.project).sort()
  assert.deepEqual(projects, ['项目A', '项目B'])
  // 同一项目内重复消息：仍然跳过，不重复建卡
  const third = await depositAssistantMessage({ text, sessionId: 's-proj', seq: 3, assetProvider, store, saveEvidence: async () => { const error = new Error('dup'); error.code = 'DUPLICATE'; throw error }, activeProject: '项目A' })
  assert.equal(third.savedAssets, 0)
  assert.ok(third.skippedAssets >= 1)
})

test('事件接线增量扫描：穿插非回答事件不漏沉淀；重复通知与窗口替换不重复入库', async () => {
  const storage = installFakeLocalStorage()
  try {
    setAutoDepositEnabled(true)
    const eventSource = makeEventSource()
    const assetProvider = makeAssetProviderStub()
    const sessions = makeSessionHarness('sess-incr', eventSource)
    const dispose = attachKnowledgeDeposition({ sessions }, { assetProvider })
    // 穿插：assistant → tool → assistant。两条回答都要被处理，非回答事件只推进扫描位。
    eventSource.push({ type: 'assistant/message', seq: 5, data: { message: { content: [{ type: 'text', text: '研究表明，Ghd7 促进水稻耐盐性。' }] } } })
    eventSource.push({ type: 'tool/call', seq: 6, data: {} })
    eventSource.push({ type: 'assistant/message', seq: 7, data: { message: { content: [{ type: 'text', text: '研究表明，OsNAC3 抑制水稻耐盐性。' }] } } })
    await sleep(30)
    assert.equal(readDepositionCursor('sess-incr'), 7, '水位线应推进到最后一条 assistant/message')
    const assetsAfterPushes = assetProvider.assets.length
    assert.ok(assetsAfterPushes >= 2, '两条回答都应创建灵感资产')
    const nodesAfterPushes = (await knowledgeStore().listNodes()).length
    // 同一窗口反复通知（宿主每次会话活动都回调订阅）——增量扫描后不得重复入库。
    eventSource.notify()
    eventSource.notify()
    await sleep(30)
    assert.equal(assetProvider.assets.length, assetsAfterPushes, '重复通知不得重复建资产')
    assert.equal((await knowledgeStore().listNodes()).length, nodesAfterPushes, '重复通知不得重复入库知识')
    // 窗口被整体替换成只剩最后一条（模拟宿主裁剪/重放）——同样不得重复。
    eventSource.replaceEntries([eventSource.getSnapshot().entries.at(-1)])
    eventSource.notify()
    await sleep(30)
    assert.equal((await knowledgeStore().listNodes()).length, nodesAfterPushes, '窗口替换后旧消息不得重复入库')
    // 裁剪后的窗口继续追加：新回答照常沉淀。
    eventSource.push({ type: 'assistant/message', seq: 8, data: { message: { content: [{ type: 'text', text: '研究表明，OsWRKY71 可能影响水稻耐盐性。' }] } } })
    await sleep(30)
    assert.ok((await knowledgeStore().listNodes()).length > nodesAfterPushes, '裁剪后的窗口上追加新回答仍能沉淀')
    assert.equal(readDepositionCursor('sess-incr'), 8)
    dispose()
  } finally {
    storage.restore()
  }
})

test('事件接线重挂：水位线已推进的会话不回溯重复沉淀，新回答照常处理', async () => {
  const storage = installFakeLocalStorage()
  try {
    setAutoDepositEnabled(true)
    const eventSource = makeEventSource()
    eventSource.push({ type: 'assistant/message', seq: 5, data: { message: { content: [{ type: 'text', text: '研究表明，Ghd7 促进水稻耐盐性。' }] } } })
    const sessions = makeSessionHarness('sess-reattach', eventSource)
    const assetProvider = makeAssetProviderStub()
    const first = attachKnowledgeDeposition({ sessions }, { assetProvider })
    await sleep(30)
    const assetsAfterFirst = assetProvider.assets.length
    assert.ok(assetsAfterFirst >= 1)
    assert.equal(readDepositionCursor('sess-reattach'), 5)
    first()
    // 卸载后重挂：水位线已到 5，重放窗口里的同一条消息不得再入库。
    const second = attachKnowledgeDeposition({ sessions }, { assetProvider })
    eventSource.notify()
    eventSource.push({ type: 'tool/call', seq: 6, data: {} })
    await sleep(30)
    assert.equal(assetProvider.assets.length, assetsAfterFirst, '重挂后重放历史不得重复建资产')
    assert.equal(readDepositionCursor('sess-reattach'), 5, '非回答事件不推进处理水位线')
    eventSource.push({ type: 'assistant/message', seq: 7, data: { message: { content: [{ type: 'text', text: '研究表明，SD7 促进水稻耐盐性。' }] } } })
    await sleep(30)
    assert.ok(assetProvider.assets.length > assetsAfterFirst, '重挂后的新回答应正常沉淀')
    assert.equal(readDepositionCursor('sess-reattach'), 7)
    second()
  } finally {
    storage.restore()
  }
})

test('手动沉淀：latestDepositableMessage 挑最近一条有正文的回答，无正文不算可沉淀', () => {
  const entries = [
    { type: 'user/message', seq: 1, data: {} },
    { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: '' }] } } },
    { type: 'tool/call', seq: 3, data: {} },
    { type: 'assistant/message', seq: 4, time: 555, data: { interrupted: true, turn: 2, message: { content: [{ type: 'text', text: 'Ghd7 可能影响水稻耐盐性' }] } } },
  ]
  const found = latestDepositableMessage(entries)
  assert.equal(found.seq, 4, '应挑最近一条有正文的助手回答')
  assert.equal(found.interrupted, true, '被中断的半截回答要如实标注，交由调用方提示')
  assert.equal(found.turn, 2)
  assert.equal(found.at, 555)
  assert.equal(latestDepositableMessage([]), null)
  assert.equal(latestDepositableMessage(undefined), null)
  assert.equal(latestDepositableMessage([{ type: 'assistant/message', seq: 9, data: { message: { content: [] } } }]), null, '无正文不算可沉淀')
})

test('手动沉淀：注入 entries 直接入库；无会话服务 / 无当前会话 / 无回答分别给出可判定错误', async () => {
  const store = createKnowledgeStore()
  const result = await depositLatestAssistantMessage({
    entries: [{ type: 'assistant/message', seq: 3, data: { message: { content: [{ type: 'text', text: '研究表明，OsWRKY71 可能影响水稻耐盐性。' }] } } }],
    sessionId: 's-manual', store, saveEvidence: async () => ({ entry: { id: 'ev-m1' } }), activeProject: '项目M',
  })
  assert.equal(result.error, undefined)
  assert.equal(result.seq, 3)
  assert.equal(result.summary.extracted, true)
  assert.ok(result.summary.addedNodes + result.summary.mergedNodes >= 3, '手动沉淀应入库知识节点（新库为新增，共享库为合并）')
  const gene = (await store.listNodes()).find(node => node.label === 'OsWRKY71')
  assert.equal(gene.project, '项目M', '手动沉淀同样记录当前项目')

  assert.deepEqual(await depositLatestAssistantMessage({ entries: [], sessions: null }), { error: 'empty' }, '空窗口 → empty')
  assert.deepEqual(await depositLatestAssistantMessage({ sessions: null }), { error: 'no-sessions' }, '无会话服务 → no-sessions')
  const emptyCurrentHarness = { list: { getSnapshot: () => ({ current: '' }), subscribe: () => () => {} }, binding: () => null }
  assert.deepEqual(await depositLatestAssistantMessage({ sessions: emptyCurrentHarness }), { error: 'no-session' }, '无当前会话 → no-session')
})

test('手动沉淀：不开自动开关也能经挂接登记的会话服务入库最近一条回答', async () => {
  const storage = installFakeLocalStorage()
  try {
    setAutoDepositEnabled(false)
    const eventSource = makeEventSource()
    eventSource.push({ type: 'assistant/message', seq: 12, data: { message: { content: [{ type: 'text', text: '研究表明，SD7 促进水稻耐盐性。' }] } } })
    const sessions = makeSessionHarness('sess-manual', eventSource)
    const assetProvider = makeAssetProviderStub()
    const dispose = attachKnowledgeDeposition({ sessions }, { assetProvider })
    await sleep(30)
    assert.equal(assetProvider.assets.length, 0, '开关关闭：挂接本身不沉淀')
    assert.equal(readDepositionCursor('sess-manual'), 12, '水位线在挂接期间照常推进')
    const result = await depositLatestAssistantMessage({ assetProvider })
    assert.equal(result.error, undefined)
    assert.equal(result.seq, 12)
    assert.equal(result.summary.extracted, true, '手动入口不受开关限制')
    assert.ok(result.summary.savedAssets >= 1, '手动沉淀同样联动灵感资产')
    const finding = (await knowledgeStore().listNodes()).find(node => node.label.includes('SD7'))
    assert.ok(finding, '手动沉淀的知识节点应可从共享库读回')
    assert.ok((finding.sources || []).some(source => source.sessionId === 'sess-manual' && source.seq === 12), '来源消息应记录会话与 seq')
    dispose()
    // 卸载后模块登记已清除：不传 sessions 时不再能读到会话。
    const afterDispose = await depositLatestAssistantMessage({ assetProvider })
    assert.deepEqual(afterDispose, { error: 'no-sessions' }, '卸载后手动入口必须失效')
  } finally {
    storage.restore()
  }
})
