import { normalizeEvidenceEntry, findDuplicate } from './lib/evidence-vault-core.js'
import { normalizeAssetEvidenceLink } from './lib/asset-evidence-links.js'

// 证据库持久化：IndexedDB 最小 schema。
//
// 为什么不用 localStorage：灵感资产已经占用 localStorage，且证据条目会持续增长，
// 无上限扩张的 localStorage 会挤占宿主页面配额。IndexedDB 是 ROADMAP §4 隐私边界里的硬要求。
//
// 降级策略：宿主沙箱（iframe / 隐私模式 / 插件受限环境）可能不提供 indexedDB，
// 也可能 open 被拒。此时一律退化为进程内内存存储，接口保持 Promise 不变——
// 视图照常可用，只是刷新后清空，并通过 isDegraded() 显式告知用户，绝不静默伪装成已持久化。

const DB_NAME = 'dsh-research-kit-evidence'
// v2：新增 assetEvidenceLinks store（ROADMAP §11 P5 资产-证据互链）。
// 升级回调按 objectStoreNames.contains 守卫创建，v1 老库平滑升级、既有数据不动。
const DB_VERSION = 2
const STORE = 'evidence'
const LINKS_STORE = 'assetEvidenceLinks'
// link 总量保险丝：超出时拒绝新建并提示（正常使用远达不到）。
const MAX_LINKS = 500
const PROJECT_KEY = 'dsh-research-kit.evidence.project'

// indexedDB 工厂与请求转 Promise 也被 knowledge-store（自动沉淀知识库）复用：
// 导出而非复制——构建器把全部模块拼进同一作用域，同名顶层函数会静默覆盖。
export function indexedDbFactory() {
  try {
    return typeof globalThis !== 'undefined' && globalThis.indexedDB ? globalThis.indexedDB : null
  } catch {
    return null
  }
}

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'))
  })
}

// 「当前项目」是工作上下文而非证据数据，体积恒定，放 localStorage 更合适：
// 视图初始化时可同步读取，不必等 IndexedDB 打开。localStorage 不可用时退回进程内变量。
function readStoredProject() {
  try { return globalThis.localStorage?.getItem(PROJECT_KEY) || '' } catch { return '' }
}

function writeStoredProject(value) {
  try { globalThis.localStorage?.setItem(PROJECT_KEY, value) } catch { /* 不可用则仅进程内生效 */ }
}

function sortBySavedAt(rows) {
  return [...rows].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
}

export function createEvidenceVaultStore() {
  let dbPromise = null
  let degraded = false
  let memory = []
  let activeProject = null

  const connect = () => {
    if (degraded) return Promise.resolve(null)
    if (dbPromise) return dbPromise
    const factory = indexedDbFactory()
    if (!factory) { degraded = true; return Promise.resolve(null) }
    dbPromise = new Promise(resolve => {
      let request
      try { request = factory.open(DB_NAME, DB_VERSION) } catch { degraded = true; resolve(null); return }
      request.onupgradeneeded = () => {
        const db = request.result
        // 两个 store 都按 contains 守卫：v1 老库升 v2 时 evidence 已存在，只补建 links。
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' })
          store.createIndex('savedAt', 'savedAt')
          store.createIndex('project', 'project')
          store.createIndex('status', 'status')
        }
        if (!db.objectStoreNames.contains(LINKS_STORE)) {
          const links = db.createObjectStore(LINKS_STORE, { keyPath: 'id' })
          links.createIndex('assetId', 'assetId')
          links.createIndex('evidenceId', 'evidenceId')
          links.createIndex('project', 'project')
        }
      }
      request.onsuccess = () => { if (!request.result) degraded = true; resolve(request.result || null) }
      request.onerror = () => { degraded = true; resolve(null) }
      request.onblocked = () => { degraded = true; resolve(null) }
    })
    return dbPromise
  }

  // 返回 undefined 表示「没有可用的 IndexedDB」，调用方据此走内存分支。
  const withStore = async (mode, run, storeName = STORE) => {
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

  // 内存降级路径的 link 存储：与 IndexedDB 路径行为一致（去重按稳定 id）。
  let memoryLinks = []

  const readAll = async () => {
    const rows = await withStore('readonly', store => requestToPromise(store.getAll()))
    return sortBySavedAt(Array.isArray(rows) ? rows : memory)
  }

  // 项目是最常用的列表边界；不要在 IndexedDB 已建索引的情况下把整库搬到 JS 再过滤。
  // 降级内存路径仍复用同一契约，便于保持两条路径行为一致。
  const readProject = async project => {
    if (typeof project !== 'string') return readAll()
    const rows = await withStore('readonly', store => requestToPromise(store.index('project').getAll(project)))
    return sortBySavedAt(Array.isArray(rows) ? rows : memory.filter(item => (item.project || '') === project))
  }

  // project 为 undefined/null 时返回全部；为字符串时精确匹配（'' 表示未归类）。
  const inProject = (rows, project) =>
    (typeof project === 'string' ? rows.filter(item => (item.project || '') === project) : rows)

  return {
    isDegraded: () => degraded,

    // ── 项目上下文 ──────────────────────────────────────────
    getActiveProject() {
      if (activeProject === null) activeProject = readStoredProject()
      return activeProject
    },
    setActiveProject(project) {
      activeProject = String(project || '')
      writeStoredProject(activeProject)
      return activeProject
    },

    async list({ project } = {}) {
      return readProject(project)
    },

    // 项目名来自用户手填，保留原始大小写，按去重后排序；只用于下拉与筛选。
    async listProjects() {
      const rows = await readAll()
      return [...new Set(rows.map(item => item.project).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    },

    // onDuplicate: 'reject'（默认，抛错交给 UI 询问）| 'update'（覆盖已有）| 'new'（强制另存）
    async save(input, { onDuplicate = 'reject' } = {}) {
      // 校验先于持久化：非法条目即使在降级模式下也不入库，避免两条路径行为不一致。
      const entry = normalizeEvidenceEntry(input)
      const existing = await readProject(entry.project)
      const duplicate = findDuplicate(existing, entry)
      if (duplicate && onDuplicate === 'reject') {
        const error = new Error(`该来源已在本项目证据库中：「${duplicate.title}」。`)
        error.code = 'DUPLICATE'
        error.duplicate = duplicate
        throw error
      }
      // 覆盖时沿用原 id 与首次保存时间：更新笔记不该让条目在列表里跳到最前。
      const finalEntry = duplicate && onDuplicate === 'update'
        ? { ...entry, id: duplicate.id, savedAt: duplicate.savedAt }
        : entry
      const stored = await withStore('readwrite', async store => {
        await requestToPromise(store.put(finalEntry))
        return finalEntry
      })
      if (!stored) memory = [finalEntry, ...memory.filter(item => item.id !== finalEntry.id)]
      return { entry: finalEntry, duplicate: duplicate || null, updated: Boolean(duplicate) && onDuplicate === 'update' }
    },

    async remove(id) {
      const key = String(id)
      const touched = await withStore('readwrite', async store => {
        await requestToPromise(store.delete(key))
        return true
      })
      if (!touched) memory = memory.filter(item => item.id !== key)
      // 证据端点消失：同步清理以其为一端的 link（资产端悬空由视图优雅兜底，见 assetEvidenceGraphEdges）。
      await this.removeAssetEvidenceLinks({ evidenceId: key })
      return true
    },

    // 按项目彻底删除：只删该项目的条目，其余项目不受影响。
    async removeByProject(project) {
      const doomed = (await readProject(project)).map(item => item.id)
      const touched = await withStore('readwrite', async store => {
        for (const id of doomed) await requestToPromise(store.delete(String(id)))
        return true
      })
      if (!touched) memory = memory.filter(item => !doomed.includes(item.id))
      for (const id of doomed) await this.removeAssetEvidenceLinks({ evidenceId: id })
      return doomed.length
    },

    async clear() {
      const touched = await withStore('readwrite', async store => {
        await requestToPromise(store.clear())
        return true
      })
      if (!touched) memory = []
      await this.removeAssetEvidenceLinks({})
      return true
    },

    // ── 资产-证据互链（ROADMAP §11 P5）────────────────────────────────────
    // link 是用户显式确认的支撑关系；建立走 normalize 校验，同一对端点按稳定 id 去重。

    async linkAssetEvidence({ assetId, evidenceId, project = '', createdAt = Date.now() } = {}) {
      const link = normalizeAssetEvidenceLink({ assetId, evidenceId, project, createdAt })
      const existing = await this.listAssetEvidenceLinks({ assetId: link.assetId, evidenceId: link.evidenceId })
      if (existing.length) return { link: existing[0], created: false }
      const all = await this.listAssetEvidenceLinks()
      if (all.length >= MAX_LINKS) {
        const error = new Error(`关联关系已达上限（${MAX_LINKS} 条）；请先清理不再需要的关联。`)
        error.code = 'LINK_LIMIT'
        throw error
      }
      const touched = await withStore('readwrite', async store => {
        await requestToPromise(store.put(link))
        return true
      }, LINKS_STORE)
      if (!touched) memoryLinks = [link, ...memoryLinks.filter(row => row.id !== link.id)]
      return { link, created: true }
    },

    // 过滤参数全部可选：不传返回全部（有界，见 MAX_LINKS）。
    async listAssetEvidenceLinks({ assetId, evidenceId, project } = {}) {
      const rows = await withStore('readonly', store => requestToPromise(store.getAll()), LINKS_STORE)
      const list = Array.isArray(rows) ? rows : memoryLinks
      return list
        .filter(row => (assetId === undefined || String(row.assetId) === String(assetId))
          && (evidenceId === undefined || String(row.evidenceId) === String(evidenceId))
          && (project === undefined || String(row.project || '') === String(project)))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    },

    async removeAssetEvidenceLink(id) {
      const key = String(id)
      const touched = await withStore('readwrite', async store => {
        await requestToPromise(store.delete(key))
        return true
      }, LINKS_STORE)
      if (!touched) memoryLinks = memoryLinks.filter(row => row.id !== key)
      return true
    },

    // 批量解除：按任一端点过滤（证据删除 / 资产删除 / 清空时的联动清理）。
    async removeAssetEvidenceLinks({ assetId, evidenceId } = {}) {
      const doomed = (await this.listAssetEvidenceLinks({ assetId, evidenceId })).map(row => row.id)
      if (!doomed.length) return 0
      const touched = await withStore('readwrite', async store => {
        for (const id of doomed) await requestToPromise(store.delete(id))
        return true
      }, LINKS_STORE)
      if (!touched) memoryLinks = memoryLinks.filter(row => !doomed.includes(row.id))
      return doomed.length
    },

    // 批量写回（导入用）：一次事务写完，避免逐条 put 之间被中断留下半份数据。
    async importMany(entries) {
      const rows = Array.isArray(entries) ? entries : []
      if (!rows.length) return 0
      const touched = await withStore('readwrite', async store => {
        for (const row of rows) await requestToPromise(store.put(row))
        return true
      })
      if (!touched) memory = [...rows, ...memory.filter(item => !rows.some(row => row.id === item.id))]
      return rows.length
    },
  }
}
