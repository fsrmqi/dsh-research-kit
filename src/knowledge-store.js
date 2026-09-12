import {
  hashKey, normalizeKnowledgeNodeDraft, normalizeKnowledgeClaimDraft,
  KNOWLEDGE_STATUSES,
} from './lib/knowledge-extract.js'
import { indexedDbFactory, requestToPromise } from './evidence-vault-store.js'

// 自动沉淀知识库持久化：IndexedDB 双 store（nodes / claims）。
//
// 与证据库（dsh-research-kit-evidence）同一套取舍：
//   - IndexedDB 而非 localStorage：知识节点与关系会随对话持续增长，不能挤占配额；
//   - 沙箱/隐私模式下降级为进程内内存存储，接口不变，isDegraded() 显式告知；
//   - 顶层符号名全局唯一：构建器把所有模块拼进同一作用域（见 evidence-store.js 注释），
//     因此 IndexedDB 工具从 evidence-vault-store 导入复用，绝不重名声明。
//
// 去重与合并语义（对应需求「相同内容合并，保留来源消息；冲突结论并列保留」）：
//   - 节点 id = hash(kind + entityKind + 规范化标签) → 同一内容天然合并；
//     合并时**追加**来源消息（同一 sessionId+seq 只记一次，最多保留前 5 条）；
//   - 关系 id = hash(主语key | 关系 | 宾语key | 极性) → 「A 可能影响 B」与
//     「A 促进 B」是两条关系记录，**并列保留**，谁也不覆盖谁；
//   - 用户推进过的核验状态（verified/disputed）不会被自动沉淀降回 to_verify。

export const KNOWLEDGE_DB_NAME = 'dsh-research-kit-knowledge'
export const KNOWLEDGE_DB_VERSION = 1
export const KNOWLEDGE_NODE_STORE = 'nodes'
export const KNOWLEDGE_CLAIM_STORE = 'claims'
export const KNOWLEDGE_NODE_ID_PREFIX = 'kn-'
export const KNOWLEDGE_CLAIM_ID_PREFIX = 'kc-'

// 来源消息是追溯线索不是全文存档：每条知识最多记 5 条来源，每条摘录 200 字。
export const MAX_SOURCES_PER_RECORD = 5
export const MAX_SOURCE_EXCERPT_CHARS = 200
export const MAX_EVIDENCE_LINKS_PER_NODE = 12

function knowledgeSourceId(source) {
  return `${source.sessionId || ''}:${Number.isFinite(source.seq) ? source.seq : ''}`
}

function normalizeKnowledgeSource(input = {}) {
  const excerpt = String(input.excerpt || '').trim()
  return {
    sessionId: String(input.sessionId || ''),
    seq: Number.isFinite(Number(input.seq)) ? Number(input.seq) : null,
    turn: Number.isFinite(Number(input.turn)) ? Number(input.turn) : null,
    at: Number(input.at) || 0,
    excerpt: excerpt.length > MAX_SOURCE_EXCERPT_CHARS ? `${excerpt.slice(0, MAX_SOURCE_EXCERPT_CHARS - 1)}…` : excerpt,
  }
}

// 追加来源消息：同一 sessionId+seq 只记一次；超过上限时保留最早的（首次出处最可追溯）。
function mergeKnowledgeSources(existing = [], incoming = []) {
  const rows = Array.isArray(existing) ? [...existing] : []
  const seen = new Set(rows.map(knowledgeSourceId))
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const source = normalizeKnowledgeSource(raw)
    if (source.excerpt === '' && !source.sessionId && source.seq === null) continue
    const id = knowledgeSourceId(source)
    if (seen.has(id)) continue
    seen.add(id)
    rows.push(source)
  }
  return rows.slice(0, MAX_SOURCES_PER_RECORD)
}

export function knowledgeNodeIdFor(key) {
  return `${KNOWLEDGE_NODE_ID_PREFIX}${hashKey(key)}`
}

// 关系的稳定身份：主语 key | 关系 | 宾语 key | 极性。极性参与身份是刻意的——
// 「A 可能影响 B」（不确定）与「A 促进 B」（正向）语义不同，应并列保留供人工裁决。
export function knowledgeClaimKeyFor({ fromKey, relation, toKey, polarity }) {
  return `${fromKey}|${relation}|${toKey}|${polarity}`
}

export function knowledgeClaimIdFor(identity) {
  return `${KNOWLEDGE_CLAIM_ID_PREFIX}${hashKey(identity)}`
}

function sortKnowledgeNodes(rows) {
  return [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

function sortKnowledgeClaims(rows) {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function createKnowledgeStore() {
  let dbPromise = null
  let degraded = false
  const memory = { nodes: [], claims: [] }

  const connect = () => {
    if (degraded) return Promise.resolve(null)
    if (dbPromise) return dbPromise
    const factory = indexedDbFactory()
    if (!factory) { degraded = true; return Promise.resolve(null) }
    dbPromise = new Promise(resolve => {
      let request
      try { request = factory.open(KNOWLEDGE_DB_NAME, KNOWLEDGE_DB_VERSION) } catch { degraded = true; resolve(null); return }
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(KNOWLEDGE_NODE_STORE)) {
          const nodes = db.createObjectStore(KNOWLEDGE_NODE_STORE, { keyPath: 'id' })
          nodes.createIndex('key', 'key')
          nodes.createIndex('kind', 'kind')
          nodes.createIndex('updatedAt', 'updatedAt')
        }
        if (!db.objectStoreNames.contains(KNOWLEDGE_CLAIM_STORE)) {
          const claims = db.createObjectStore(KNOWLEDGE_CLAIM_STORE, { keyPath: 'id' })
          claims.createIndex('from', 'from')
          claims.createIndex('to', 'to')
          claims.createIndex('updatedAt', 'updatedAt')
        }
      }
      request.onsuccess = () => { if (!request.result) degraded = true; resolve(request.result || null) }
      request.onerror = () => { degraded = true; resolve(null) }
      request.onblocked = () => { degraded = true; resolve(null) }
    })
    return dbPromise
  }

  const withStore = async (storeName, mode, run) => {
    const db = await connect()
    if (!db) return undefined
    const tx = db.transaction(storeName, mode)
    const value = await run(tx.objectStore(storeName))
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('IndexedDB 事务失败'))
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务被中止'))
    })
    return value
  }

  const readNodes = async () => {
    const rows = await withStore(KNOWLEDGE_NODE_STORE, 'readonly', store => requestToPromise(store.getAll()))
    return sortKnowledgeNodes(Array.isArray(rows) ? rows : memory.nodes)
  }

  const readClaims = async () => {
    const rows = await withStore(KNOWLEDGE_CLAIM_STORE, 'readonly', store => requestToPromise(store.getAll()))
    return sortKnowledgeClaims(Array.isArray(rows) ? rows : memory.claims)
  }

  const putRows = async (storeName, rows) => {
    if (!rows.length) return true
    const touched = await withStore(storeName, 'readwrite', async store => {
      for (const row of rows) await requestToPromise(store.put(row))
      return true
    })
    if (!touched) {
      const bucket = storeName === KNOWLEDGE_NODE_STORE ? 'nodes' : 'claims'
      const merged = [...rows, ...memory[bucket].filter(item => !rows.some(row => row.id === item.id))]
      memory[bucket] = bucket === 'nodes' ? sortKnowledgeNodes(merged) : sortKnowledgeClaims(merged)
    }
    return true
  }

  const deleteRow = async (storeName, id) => {
    const touched = await withStore(storeName, 'readwrite', store => requestToPromise(store.delete(id)))
    if (!touched) {
      const bucket = storeName === KNOWLEDGE_NODE_STORE ? 'nodes' : 'claims'
      memory[bucket] = memory[bucket].filter(item => item.id !== id)
    }
    return true
  }

  return {
    // 主动探测：宿主根本没有 indexedDB 时，不必等第一次读写就如实报告降级。
    isDegraded: () => degraded || indexedDbFactory() === null,

    async listNodes({ kind } = {}) {
      const rows = await readNodes()
      return kind ? rows.filter(row => row.kind === kind) : rows
    },

    async listClaims() {
      return readClaims()
    },

    // 把一条提取结果合并入库。nodes/claims 是提取器输出的 draft（带 key），
    // source 是来源消息（{ sessionId, seq, turn, at, excerpt }），可为空（手动提取）。
    async applyExtraction({ nodes = [], claims = [], source = {}, now = Date.now() } = {}) {
      const origin = normalizeKnowledgeSource(source)
      const hasOrigin = Boolean(origin.excerpt || origin.sessionId || origin.seq !== null)
      const existingNodes = await readNodes()
      const existingClaims = await readClaims()
      const nodeById = new Map(existingNodes.map(row => [row.id, row]))
      const nodeIdByKey = new Map(existingNodes.map(row => [row.key, row.id]))
      const claimById = new Map(existingClaims.map(row => [row.id, row]))
      const touchedNodes = []
      const touchedClaims = []
      let addedNodes = 0
      let mergedNodes = 0
      let addedClaims = 0
      let mergedClaims = 0
      let skippedNodes = 0
      let skippedClaims = 0

      for (const draft of Array.isArray(nodes) ? nodes : []) {
        let clean
        try { clean = normalizeKnowledgeNodeDraft(draft) } catch { skippedNodes++; continue }
        const id = knowledgeNodeIdFor(clean.key)
        const previous = nodeById.get(id)
        const incoming = hasOrigin ? [{ ...origin, excerpt: draft.excerpt || origin.excerpt }] : []
        if (previous) {
          const next = {
            ...previous,
            label: clean.label,
            entityKind: clean.kind === 'entity' ? (clean.entityKind || previous.entityKind) : previous.entityKind,
            sources: mergeKnowledgeSources(previous.sources, incoming),
            // 用户推进过的核验状态不回退：自动沉淀只填写「待核验」，不改写人工结论。
            status: previous.status === 'to_verify' ? 'to_verify' : previous.status,
            updatedAt: now,
          }
          nodeById.set(id, next)
          touchedNodes.push(next)
          mergedNodes++
        } else {
          const row = {
            id,
            key: clean.key,
            kind: clean.kind,
            entityKind: clean.entityKind,
            label: clean.label,
            status: 'to_verify',
            sources: mergeKnowledgeSources([], incoming),
            evidenceIds: [],
            assetId: '',
            createdAt: now,
            updatedAt: now,
          }
          nodeById.set(id, row)
          nodeIdByKey.set(clean.key, id)
          touchedNodes.push(row)
          addedNodes++
        }
      }

      // 关系端点解析失败（实体被限额截断）就丢弃该关系，绝不悬挂。
      for (const draft of Array.isArray(claims) ? claims : []) {
        let clean
        try { clean = normalizeKnowledgeClaimDraft(draft) } catch { skippedClaims++; continue }
        const fromId = nodeIdByKey.get(clean.fromKey)
        const toId = nodeIdByKey.get(clean.toKey)
        if (!fromId || !toId) { skippedClaims++; continue }
        const identity = knowledgeClaimKeyFor(clean)
        const id = knowledgeClaimIdFor(identity)
        const previous = claimById.get(id)
        const incoming = hasOrigin ? [{ ...origin, excerpt: draft.excerpt || origin.excerpt }] : []
        const row = {
          id,
          key: identity,
          from: fromId,
          to: toId,
          relation: clean.relation,
          polarity: clean.polarity,
          status: previous && previous.status !== 'to_verify' ? previous.status : 'to_verify',
          sources: mergeKnowledgeSources(previous?.sources, incoming),
          createdAt: previous?.createdAt || now,
          updatedAt: now,
        }
        claimById.set(id, row)
        touchedClaims.push(row)
        if (previous) mergedClaims++
        else addedClaims++
      }

      await putRows(KNOWLEDGE_NODE_STORE, touchedNodes)
      await putRows(KNOWLEDGE_CLAIM_STORE, touchedClaims)
      return {
        nodes: await readNodes(),
        claims: await readClaims(),
        addedNodes, mergedNodes, skippedNodes,
        addedClaims, mergedClaims, skippedClaims,
      }
    },

    async setNodeStatus(id, status) {
      if (!KNOWLEDGE_STATUSES.includes(status)) throw new Error(`未知的核验状态：${status}`)
      const rows = await readNodes()
      const row = rows.find(item => item.id === id)
      if (!row || row.status === status) return row || null
      const next = { ...row, status, updatedAt: Date.now() }
      await putRows(KNOWLEDGE_NODE_STORE, [next])
      return next
    },

    async setClaimStatus(id, status) {
      if (!KNOWLEDGE_STATUSES.includes(status)) throw new Error(`未知的核验状态：${status}`)
      const rows = await readClaims()
      const row = rows.find(item => item.id === id)
      if (!row || row.status === status) return row || null
      const next = { ...row, status, updatedAt: Date.now() }
      await putRows(KNOWLEDGE_CLAIM_STORE, [next])
      return next
    },

    async linkEvidence(nodeId, evidenceId) {
      const clean = String(evidenceId || '')
      if (!clean) return null
      const rows = await readNodes()
      const row = rows.find(item => item.id === nodeId)
      if (!row) return null
      if ((row.evidenceIds || []).includes(clean)) return row
      const next = { ...row, evidenceIds: [...(row.evidenceIds || []), clean].slice(0, MAX_EVIDENCE_LINKS_PER_NODE), updatedAt: Date.now() }
      await putRows(KNOWLEDGE_NODE_STORE, [next])
      return next
    },

    async setAssetId(nodeId, assetId) {
      const clean = String(assetId || '')
      if (!clean) return null
      const rows = await readNodes()
      const row = rows.find(item => item.id === nodeId)
      if (!row) return null
      if (row.assetId === clean) return row
      const next = { ...row, assetId: clean, updatedAt: Date.now() }
      await putRows(KNOWLEDGE_NODE_STORE, [next])
      return next
    },

    // 删除一个知识节点，同时删除指向它的全部关系（图谱不允许悬挂端点）。
    // 关系与节点在不同 store，无法共享一个事务：先删关系再删节点，中断也只是多留一条孤儿关系。
    async removeNode(nodeId) {
      const claims = await readClaims()
      const doomed = claims.filter(row => row.from === nodeId || row.to === nodeId)
      for (const row of doomed) await deleteRow(KNOWLEDGE_CLAIM_STORE, row.id)
      await deleteRow(KNOWLEDGE_NODE_STORE, nodeId)
      return true
    },

    // 只清空知识图谱沉淀；证据库与灵感资产不受影响（与「清空本会话临时记录」的边界互补）。
    async clear() {
      const clearedNodes = await withStore(KNOWLEDGE_NODE_STORE, 'readwrite', store => requestToPromise(store.clear()))
      const clearedClaims = await withStore(KNOWLEDGE_CLAIM_STORE, 'readwrite', store => requestToPromise(store.clear()))
      if (clearedNodes === undefined && clearedClaims === undefined) { memory.nodes = []; memory.claims = [] }
      return true
    },
  }
}

// ── 单例 + 订阅 ───────────────────────────────────────────────────────────────
// 与证据库同样的理由：沉淀入口（会话事件监听）与展示入口（证据图谱）不在同一棵
// 子树里，靠模块级单例与监听保持同步。
let sharedKnowledgeStore = null
const knowledgeListeners = new Set()

export function knowledgeStore() {
  if (!sharedKnowledgeStore) sharedKnowledgeStore = createKnowledgeStore()
  return sharedKnowledgeStore
}

export function subscribeKnowledge(listener) {
  knowledgeListeners.add(listener)
  return () => knowledgeListeners.delete(listener)
}

export function publishKnowledge() {
  for (const listener of knowledgeListeners) { try { listener() } catch { /* 单个监听失败不影响其余 */ } }
}
