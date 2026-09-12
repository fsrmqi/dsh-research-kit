import { extractKnowledge, normalizeKnowledgeLabel } from './lib/knowledge-extract.js'
import { knowledgeStore, publishKnowledge } from './knowledge-store.js'
import { saveEvidenceEntry, getActiveProject } from './research-evidence-vault.js'

// 自动沉淀编排：接入 DSH「回答完成」事件，把助手回答自动转成知识结构并联动三个库。
//
// 数据流（需求原文的对应关系）：
//   1. 回答完成   → sessions.binding(sessionId).eventSource 里的 assistant/message 事件；
//   2. 结构化提取 → extractKnowledge（问题/实体/发现/假设/方法/关系/引用来源）；
//   3. 自动入库   → 发现/假设/问题/方法 → 灵感资产（待验证）；引用来源 → 证据库（未核验）；
//                    知识节点与关系 → knowledge-store（待核验），同时生成图谱节点与连线；
//   4. 合并去重   → 相同内容按稳定 id 合并，追加来源消息；冲突结论（同端点不同极性）并列保留；
//   5. 追溯       → 节点携带来源消息摘录与证据/资产关联，图谱点开结论即可回看。
//
// 隐私与安全边界：
//   - 默认关闭，必须在图谱页显式开启（显式 opt-in，不静默读取会话内容）；
//   - 提取在浏览器本地完成，无任何网络请求；只有用户手动核验后内容才可信；
//   - 只保留有界摘录（每条来源 ≤200 字、每条知识 ≤5 条来源），不存整段回答。

export const AUTO_DEPOSIT_STORAGE_KEY = 'dsh-research-kit.auto-deposit.enabled'
export const AUTO_DEPOSIT_EVENT = 'dsh-research-kit:auto-deposit-changed'
export const DEPOSITION_TAG = '自动沉淀'
// 证据条目的来源库标注：不是目录里的数据库，图谱里不会连到资源节点，靠 supports 边连知识节点。
export const DEPOSITION_SOURCE_DATABASE = '会话回答'
// 开关关闭期间的事件水位线照常前进：开启后只处理新回答，不回溯补提取历史会话。
// 长度门槛只拦纯寒暄（「好的，谢谢」）；真正的过滤者是提取器——无研究内容自然返回空结构，
// 门槛定得过高会误伤「Ghd7 促进水稻耐盐性。」这类短而真实的回答。
export const MIN_DEPOSITION_MESSAGE_CHARS = 12
// 只有这四类知识进入灵感资产；实体（基因/性状/物种…）只在图谱里作为关系端点。
export const DEPOSIT_ASSET_KINDS = ['question', 'hypothesis', 'finding', 'method']
export const DEPOSIT_ASSET_THINKING_KIND = { question: 'question', hypothesis: 'assumption', finding: 'conclusion', method: 'method' }

// ── 开关 ──────────────────────────────────────────────────────────────────────

export function isAutoDepositEnabled() {
  try { return globalThis.localStorage?.getItem(AUTO_DEPOSIT_STORAGE_KEY) === '1' } catch { return false }
}

export function setAutoDepositEnabled(value) {
  try { globalThis.localStorage?.setItem(AUTO_DEPOSIT_STORAGE_KEY, value ? '1' : '0') } catch { /* 不可用时仅本次会话生效 */ }
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(AUTO_DEPOSIT_EVENT, { detail: { enabled: Boolean(value) } }))
    }
  } catch { /* 通知失败不影响开关本身 */ }
  return Boolean(value)
}

export function onAutoDepositChange(listener) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
  const handler = () => { try { listener(isAutoDepositEnabled()) } catch { /* 单个监听失败不影响其余 */ } }
  window.addEventListener(AUTO_DEPOSIT_EVENT, handler)
  return () => window.removeEventListener(AUTO_DEPOSIT_EVENT, handler)
}

// ── 处理水位线（按会话记录已提取到的 seq）──────────────────────────────────────
// localStorage 足够：每会话只存一个数字。刷新页面后事件源会重放全部历史事件，
// 靠水位线避免重复沉淀；没有它，每次刷新都会把旧回答再入库一遍。

export function depositionCursorKey(sessionId) {
  return `dsh-research-kit.deposition.cursor.${String(sessionId || 'local')}`
}

export function readDepositionCursor(sessionId) {
  try { return Number(globalThis.localStorage?.getItem(depositionCursorKey(sessionId))) || 0 } catch { return 0 }
}

export function writeDepositionCursor(sessionId, seq) {
  try { globalThis.localStorage?.setItem(depositionCursorKey(sessionId), String(Number(seq) || 0)) } catch { /* 不可用时重启后会重复提取一次，可接受 */ }
}

// ── 单条消息沉淀 ──────────────────────────────────────────────────────────────

function normalizeTitleForDedupe(title) {
  return normalizeKnowledgeLabel(title).toLowerCase()
}

const EMPTY_SUMMARY = { extracted: false, addedNodes: 0, mergedNodes: 0, addedClaims: 0, mergedClaims: 0, citations: 0, savedEvidence: 0, duplicateEvidence: 0, failedEvidence: 0, savedAssets: 0, skippedAssets: 0 }

// 最近一次成功沉淀的摘要（含 at 时间戳），供图谱页展示「最近沉淀」反馈。
// 模块级单变量：只有最后一次有意义，无需历史。
let latestDepositionSummary = null

export function lastDepositionSummary() {
  return latestDepositionSummary
}

// 灵感资产去重键：标题 + 项目。证据库按项目隔离去重，资产侧必须同口径——
// 否则项目 A 沉淀过的结论会在项目 B 被误跳过（资产正文可能按项目有不同的 nextAction）。
function assetDedupeKey(title, project) {
  return `${normalizeTitleForDedupe(title)}::${String(project || '').trim()}`
}

// 把一条助手回答沉淀入库。所有依赖可注入（store/assetProvider/saveEvidence/activeProject），
// 便于在 Node 测试里用内存存储与桩复现完整链路；浏览器侧使用默认单例。
// 返回摘要供测试与 UI 提示使用；任何单步失败都被计数吞掉——自动流程不允许打断宿主。
export async function depositAssistantMessage({
  text,
  sessionId = '',
  seq = null,
  turn = null,
  at = 0,
  assetProvider = null,
  store = knowledgeStore(),
  saveEvidence = saveEvidenceEntry,
  activeProject,
  now = Date.now(),
} = {}) {
  const summary = { ...EMPTY_SUMMARY, sessionId: String(sessionId || ''), seq: Number.isFinite(Number(seq)) ? Number(seq) : null }
  const source = String(text || '')
  if (!source.trim()) return summary
  const extraction = extractKnowledge(source)
  summary.citations = extraction.citations.length
  if (!extraction.nodes.length && !extraction.claims.length && !extraction.citations.length) return summary
  summary.extracted = true

  const origin = { sessionId: summary.sessionId, seq: summary.seq, turn, at: at || now, excerpt: source.trim() }
  const project = activeProject !== undefined ? activeProject : getActiveProject()
  const applied = await store.applyExtraction({ nodes: extraction.nodes, claims: extraction.claims, source: origin, project, now })
  summary.addedNodes = applied.addedNodes
  summary.mergedNodes = applied.mergedNodes
  summary.addedClaims = applied.addedClaims
  summary.mergedClaims = applied.mergedClaims

  const touchedByThisMessage = row => (row.sources || []).some(item => item.sessionId === summary.sessionId && item.seq === summary.seq)

  // 引用来源 → 证据库：状态保持「未核验」，重复（同项目同标识符）直接跳过，绝不覆盖已有条目。
  const evidenceIds = []
  for (const citation of extraction.citations) {
    try {
      const result = await saveEvidence({
        title: citation.title || citation.identifier || citation.url,
        sourceDatabase: DEPOSITION_SOURCE_DATABASE,
        identifier: citation.identifier,
        identifierKind: citation.identifierKind,
        url: citation.url,
        project,
        tags: [DEPOSITION_TAG],
        reason: `自动沉淀：助手回答中引用的来源（消息 seq ${summary.seq ?? '未知'}），需逐条人工核验。`,
        note: `来源摘录：${(citation.title || '').slice(0, 160)}`,
      })
      if (result?.entry?.id) { evidenceIds.push(result.entry.id); summary.savedEvidence++ }
    } catch (error) {
      if (error?.code === 'DUPLICATE') summary.duplicateEvidence++
      else summary.failedEvidence++
    }
  }
  if (evidenceIds.length) {
    for (const node of applied.nodes) {
      if (!DEPOSIT_ASSET_KINDS.includes(node.kind)) continue
      if (!touchedByThisMessage(node)) continue
      for (const evidenceId of evidenceIds) await store.linkEvidence(node.id, evidenceId)
    }
  }

  // 发现/假设/问题/方法 → 灵感资产：按（标题 + 项目）去重（同一结论不重复建卡），全部为「待验证」。
  let knownAssetKeys = new Set()
  if (typeof assetProvider?.list === 'function') {
    try {
      knownAssetKeys = new Set(((await assetProvider.list()) || [])
        .map(item => assetDedupeKey(item?.title, item?.project))
        .filter(key => !key.startsWith('::')))
    } catch { knownAssetKeys = new Set() }
  }
  for (const node of applied.nodes) {
    if (!DEPOSIT_ASSET_KINDS.includes(node.kind)) continue
    if (!touchedByThisMessage(node)) continue
    const body = node.sources?.[0]?.excerpt || node.label
    const dedupeKey = assetDedupeKey(node.label, project)
    if (!body.trim() || typeof assetProvider?.save !== 'function' || knownAssetKeys.has(dedupeKey)) { summary.skippedAssets++; continue }
    try {
      const asset = await assetProvider.save({
        title: node.label,
        body,
        type: 'insight',
        thinkingKind: DEPOSIT_ASSET_THINKING_KIND[node.kind] || 'conclusion',
        epistemicStatus: 'to_verify',
        verification: { status: 'pending', evidence: '', checkedAt: 0 },
        project,
        tags: [DEPOSITION_TAG],
        note: `自动沉淀自助手回答，默认待验证；来源消息：会话 ${summary.sessionId || '本地'} seq ${summary.seq ?? '未知'}。`,
        provenance: { kind: 'auto-deposition', sessionId: summary.sessionId, seq: summary.seq },
      })
      if (asset?.id) {
        await store.setAssetId(node.id, asset.id)
        knownAssetKeys.add(dedupeKey)
        summary.savedAssets++
      } else { summary.skippedAssets++ }
    } catch { summary.skippedAssets++ }
  }

  publishKnowledge()
  if (summary.extracted) latestDepositionSummary = { ...summary, at: now }
  return summary
}

// ── DSH 事件接线 ──────────────────────────────────────────────────────────────

// assistant/message 的 data.message.content 是内容块数组；只取可见文本块。
function depositionTextOf(data) {
  const content = data?.message?.content
  if (!Array.isArray(content)) return ''
  return content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
}

// 挂到 DSH 会话服务上：
//   - 跟随 sessions.list 的当前会话切换，逐会话订阅事件流（eventSource）；
//   - 事件窗口是追加式的（seq 单调递增），每次通知只从尾部增量扫描上次扫过之后的新增段，
//     不再全量重扫整段历史（长会话下每次事件通知都是 O(窗口全长) 的纯浪费）；
//     重复入库的正确性不依赖这条优化——始终由 localStorage 水位线兜底；
//   - 命中的回答串行排队沉淀，失败不重试、不打断宿主；
//   - 宿主未提供 sessions 服务（单测/独立页）时返回空操作，绝不抛错；
//   - 挂接期间把 sessions 服务登记给「手动沉淀入口」（见 depositLatestAssistantMessage）。
// 返回卸载函数：插件卸载时解除全部订阅。
export function attachKnowledgeDeposition(ctx, { assetProvider } = {}) {
  const sessions = ctx?.sessions
  if (!sessions?.list || typeof sessions?.binding !== 'function') return () => {}
  registerDepositionSessions(sessions)
  let disposeFeed = () => {}
  let boundSessionId = ''
  let queue = Promise.resolve()
  // 本侧已扫过的事件 seq 高位（内存内，随会话绑定重置）：增量扫描的起点。
  // 它只是省扫描的性能水位，不是去重依据——去重唯一依据是 localStorage 处理水位线。
  let scannedSeq = 0

  const drain = eventSource => {
    const windowArg = eventSource.getSnapshot()
    const entries = Array.isArray(windowArg?.entries) ? windowArg.entries : []
    if (!entries.length) return
    // 从尾部向前收集 seq 大于已扫高位的条目，碰到已扫过的就停：
    // 稳定追加流下常见成本是 O(新增条数)，而不是 O(窗口全长)。
    // 若宿主窗口违反「追加且 seq 单调」的约定（整体重放/替换），最坏结果是本侧少扫一段，
    // 而水位线语义与旧的全量扫描完全一致，不会重复入库。
    const fresh = []
    for (let index = entries.length - 1; index >= 0; index--) {
      const seq = Number(entries[index]?.seq)
      if (Number.isFinite(seq) && seq <= scannedSeq) break
      fresh.push(entries[index])
    }
    if (!fresh.length) return
    for (const event of fresh) {
      const seq = Number(event?.seq)
      if (Number.isFinite(seq) && seq > scannedSeq) scannedSeq = seq
    }
    fresh.reverse()
    let cursor = readDepositionCursor(boundSessionId)
    for (const event of fresh) {
      if (!event || event.type !== 'assistant/message') continue
      const seq = Number(event.seq)
      if (!Number.isFinite(seq) || seq <= cursor) continue
      cursor = seq
      const data = event.data || {}
      const text = depositionTextOf(data)
      // interrupted 是被取消的半截回答：不完整，不做提取（需求只提「回答完成」）。
      if (isAutoDepositEnabled() && !data.interrupted && text.length >= MIN_DEPOSITION_MESSAGE_CHARS) {
        const payload = { text, sessionId: boundSessionId, seq, turn: Number(data.turn) || null, at: Number(event.time) || Date.now(), assetProvider }
        queue = queue.then(() => depositAssistantMessage(payload)).catch(() => { /* 单条失败不阻断后续消息 */ })
      }
      writeDepositionCursor(boundSessionId, cursor)
    }
  }

  const rebind = sessionId => {
    if (sessionId === boundSessionId) return
    try { disposeFeed() } catch { /* 旧订阅已失效也继续 */ }
    disposeFeed = () => {}
    boundSessionId = sessionId ? String(sessionId) : ''
    // 换会话后扫描高位从该会话的处理水位线起步：窗口里 seq ≤ 水位线的段落本就不会处理，
    // 不值得为它们付一次全量扫描。
    scannedSeq = readDepositionCursor(boundSessionId)
    if (!boundSessionId) return
    let binding = null
    try { binding = sessions.binding(boundSessionId) } catch { return }
    const eventSource = binding?.eventSource
    if (!eventSource || typeof eventSource.getSnapshot !== 'function' || typeof eventSource.subscribe !== 'function') return
    const handle = () => { try { drain(eventSource) } catch { /* 沉淀环节的任何异常都不允许冒泡到宿主 */ } }
    try { disposeFeed = eventSource.subscribe(handle) } catch { disposeFeed = () => {}; return }
    handle()
  }

  const followCurrentSession = () => {
    let current = ''
    try { current = sessions.list.getSnapshot()?.current || '' } catch { /* 会话列表不可读时保持现状 */ }
    rebind(current ? String(current) : '')
  }

  let disposeList = () => {}
  try { disposeList = sessions.list.subscribe(followCurrentSession) } catch { disposeList = () => {} }
  followCurrentSession()
  return () => {
    registerDepositionSessions(null)
    try { disposeList() } catch { /* 已失效 */ }
    try { disposeFeed() } catch { /* 已失效 */ }
  }
}

// ── 手动沉淀入口 ──────────────────────────────────────────────────────────────
// 图谱页的「沉淀最近回答」：不开自动开关，也能把当前会话最近一条助手回答显式入库。
// attachKnowledgeDeposition 挂接期间登记 sessions 服务、卸载时清除；测试与独立页
// 可通过参数直接注入 sessions 或 entries，不依赖模块状态。

let depositionSessions = null

function registerDepositionSessions(sessions) {
  depositionSessions = sessions?.list && typeof sessions?.binding === 'function' ? sessions : null
}

// 从事件窗口挑出最近一条有正文的助手回答。手动入口不做长度与 interrupted 过滤：
// 用户点名要这条就原样提取（被中断的半截回答由调用方在结果里如实标注）。
// 返回 { text, seq, turn, at, interrupted } 或 null（窗口里没有可沉淀的回答）。
export function latestDepositableMessage(entries) {
  const list = Array.isArray(entries) ? entries : []
  for (let index = list.length - 1; index >= 0; index--) {
    const event = list[index]
    if (!event || event.type !== 'assistant/message') continue
    const data = event.data || {}
    const text = depositionTextOf(data)
    if (!String(text).trim()) continue
    const seq = Number(event.seq)
    return {
      text,
      seq: Number.isFinite(seq) ? seq : null,
      turn: Number(data.turn) || null,
      at: Number(event.time) || 0,
      interrupted: Boolean(data.interrupted),
    }
  }
  return null
}

// 沉淀最近一条助手回答。返回：
//   { error: 'no-sessions' | 'no-session' | 'empty' } — 无法沉淀，视图据此给出提示；
//   { summary, seq, interrupted }                     — 已提交沉淀（summary 见 depositAssistantMessage）。
// 重复点击是安全的：相同内容按稳定 id 走合并路径，来源消息按（会话 + seq）去重，不会翻倍。
export async function depositLatestAssistantMessage({
  entries = null,
  sessions,
  sessionId = '',
  store,
  saveEvidence,
  activeProject,
  assetProvider,
} = {}) {
  let windowEntries = entries
  let sid = String(sessionId || '')
  if (!Array.isArray(windowEntries)) {
    const source = sessions !== undefined ? sessions : depositionSessions
    if (!source?.list || typeof source?.binding !== 'function') return { error: 'no-sessions' }
    let current = ''
    try { current = source.list.getSnapshot()?.current || '' } catch { current = '' }
    if (!current) return { error: 'no-session' }
    let eventSource = null
    try { eventSource = source.binding(String(current))?.eventSource || null } catch { eventSource = null }
    const snapshot = typeof eventSource?.getSnapshot === 'function' ? eventSource.getSnapshot() : null
    windowEntries = Array.isArray(snapshot?.entries) ? snapshot.entries : []
    sid = String(current)
  }
  const found = latestDepositableMessage(windowEntries)
  if (!found) return { error: 'empty' }
  const summary = await depositAssistantMessage({
    text: found.text,
    sessionId: sid,
    seq: found.seq,
    turn: found.turn,
    at: found.at,
    assetProvider,
    store,
    saveEvidence,
    activeProject,
  })
  return { summary, seq: found.seq, interrupted: found.interrupted }
}
