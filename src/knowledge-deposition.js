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
  const applied = await store.applyExtraction({ nodes: extraction.nodes, claims: extraction.claims, source: origin, now })
  summary.addedNodes = applied.addedNodes
  summary.mergedNodes = applied.mergedNodes
  summary.addedClaims = applied.addedClaims
  summary.mergedClaims = applied.mergedClaims

  const project = activeProject !== undefined ? activeProject : getActiveProject()
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

  // 发现/假设/问题/方法 → 灵感资产：按标题去重（同一结论不重复建卡），全部为「待验证」。
  let knownTitles = new Set()
  if (typeof assetProvider?.list === 'function') {
    try { knownTitles = new Set(((await assetProvider.list()) || []).map(item => normalizeTitleForDedupe(item?.title)).filter(Boolean)) } catch { knownTitles = new Set() }
  }
  for (const node of applied.nodes) {
    if (!DEPOSIT_ASSET_KINDS.includes(node.kind)) continue
    if (!touchedByThisMessage(node)) continue
    const body = node.sources?.[0]?.excerpt || node.label
    if (!body.trim() || typeof assetProvider?.save !== 'function' || knownTitles.has(normalizeTitleForDedupe(node.label))) { summary.skippedAssets++; continue }
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
        knownTitles.add(normalizeTitleForDedupe(node.label))
        summary.savedAssets++
      } else { summary.skippedAssets++ }
    } catch { summary.skippedAssets++ }
  }

  publishKnowledge()
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
//   - 每次事件流通知都扫一遍新 assistant/message（seq 大于水位线），
//     串行排队沉淀，失败不重试、不打断宿主；
//   - 宿主未提供 sessions 服务（单测/独立页）时返回空操作，绝不抛错。
// 返回卸载函数：插件卸载时解除全部订阅。
export function attachKnowledgeDeposition(ctx, { assetProvider } = {}) {
  const sessions = ctx?.sessions
  if (!sessions?.list || typeof sessions?.binding !== 'function') return () => {}
  let disposeFeed = () => {}
  let boundSessionId = ''
  let queue = Promise.resolve()

  const drain = eventSource => {
    const windowArg = eventSource.getSnapshot()
    const entries = Array.isArray(windowArg?.entries) ? windowArg.entries : []
    let cursor = readDepositionCursor(boundSessionId)
    for (const event of entries) {
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
    try { disposeList() } catch { /* 已失效 */ }
    try { disposeFeed() } catch { /* 已失效 */ }
  }
}
