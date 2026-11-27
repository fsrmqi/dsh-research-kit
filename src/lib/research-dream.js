// 科研梦境引擎（纯函数，无 DOM 依赖）。
//
// 核心设计原则：
//   1. 高信号压缩：不管证据库/知识库积累了多少条，每次梦境最多提炼 Top 5 条最值得看的提案；
//   2. 三种模式可选：巩固梦（去重/冲突/孤立关联/陈旧待核验）、联想梦（跨文献桥接/缺口线索/待核验假说）、完整梦（先巩固再联想）；
//   3. 严格防编造与零静默写入：所有提案只进入 pending 队列，必须引用快照中真实存在的 ID；
//      任何联想假说必须显式标注「梦境推论 · 待核验」；已采纳或忽略的提案按 signature 永久去重，不再重复打扰。

export const DREAM_MODES = [
  { value: 'full', label: '完整梦', hint: '先整理巩固，再做跨文献联想（压缩为 Top 5）' },
  { value: 'consolidation', label: '巩固梦', hint: '去重、冲突预警、孤立线索关联与高优待核验（零 Token 可运行）' },
  { value: 'associative', label: '联想梦', hint: '跨文献弱连接、缺口线索与待核验研究假说发散' },
]

export const DREAM_PROPOSAL_KINDS = [
  'duplicate_evidence',
  'conflict_alert',
  'link_suggestion',
  'stale_review',
  'gap_clue',
  'bridge_insight',
  'hypothesis_draft',
]

export const DREAM_MAX_PROPOSALS = 5
export const DREAM_SNAPSHOT_LIMITS = {
  evidence: 80,
  claims: 50,
  knowledgeNodes: 60,
  knowledgeClaims: 50,
}

const ASSOCIATIVE_KINDS = new Set(['gap_clue', 'bridge_insight', 'hypothesis_draft'])
const CONSOLIDATION_KINDS = new Set(['duplicate_evidence', 'conflict_alert', 'link_suggestion', 'stale_review'])

const STOP_TOKENS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'using', 'based',
  'study', 'analysis', 'effect', 'effects', 'model', 'data', 'method', 'methods',
  'result', 'results', 'paper', 'review', 'research', 'system', 'approach',
  '研究', '分析', '方法', '结果', '模型', '数据', '影响', '机制', '系统', '论文', '文献', '综述', '比较', '验证', '评估',
])

export function normalizeDreamMode(mode) {
  return DREAM_MODES.some(item => item.value === mode) ? mode : 'full'
}

/** 按课题精确匹配。空课题只取未归类记录，命名课题不纳入空课题或其他课题。 */
export function scopeDreamRecords(rows, project = '') {
  const key = String(project || '')
  return (Array.isArray(rows) ? rows : []).filter(row => String(row?.project || '') === key)
}

function clampText(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim()
}

function normalizeIdentifierKey(entry) {
  const id = String(entry?.identifier || '').trim().toLowerCase()
  if (!id) return ''
  const kind = String(entry?.identifierKind || entry?.identifier_type || 'id').trim().toLowerCase()
  return `${kind}:${id}`
}

export function tokenizeDreamText(text) {
  const raw = String(text || '').toLowerCase()
  const tokens = new Set()
  const ascii = raw.match(/[a-z][a-z0-9_-]{2,24}/g) || []
  for (const word of ascii) {
    if (!STOP_TOKENS.has(word)) tokens.add(word)
  }
  const cjk = raw.match(/[\u4e00-\u9fff]{2,8}/g) || []
  for (const phrase of cjk) {
    if (!STOP_TOKENS.has(phrase)) tokens.add(phrase)
    if (phrase.length > 4) {
      for (let i = 0; i <= phrase.length - 2; i += 2) {
        const sub = phrase.slice(i, i + 2)
        if (!STOP_TOKENS.has(sub)) tokens.add(sub)
      }
    }
  }
  return tokens
}

function sharedTokens(aSet, bSet) {
  const shared = []
  for (const token of aSet) {
    if (bSet.has(token)) shared.push(token)
  }
  return shared
}

function makeSignature(kind, refs = {}, extra = '') {
  const parts = [
    kind,
    [...(refs.evidenceIds || [])].sort().join(','),
    [...(refs.claimIds || [])].sort().join(','),
    [...(refs.nodeIds || [])].sort().join(','),
    [...(refs.knowledgeClaimIds || [])].sort().join(','),
    String(extra || '').trim().toLowerCase(),
  ]
  return parts.join('|')
}

function proposalIdFromSignature(signature) {
  let hash = 2166136261
  for (let i = 0; i < signature.length; i++) {
    hash ^= signature.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `dream-${(hash >>> 0).toString(36)}`
}

function withRecordFocus(proposal) {
  const action = proposal?.action
  if (!action || action.type !== 'navigate') return proposal
  const refs = proposal.refs || {}
  const evidenceIds = (refs.evidenceIds || []).map(String).filter(Boolean).slice(0, 4)
  const options = { ...(action.options || {}) }
  if (refs.claimIds?.[0]) options.claimId = String(refs.claimIds[0])
  if (evidenceIds.length) {
    options.evidenceId = evidenceIds[0]
    options.evidenceIds = evidenceIds
  }
  if (refs.nodeIds?.[0]) options.nodeId = String(refs.nodeIds[0])
  return { ...proposal, action: { ...action, options } }
}

function selectDreamProposals(items, mode, maxProposals) {
  const sorted = [...items].sort((a, b) => (b.priority || 0) - (a.priority || 0))
  if (mode !== 'full' || sorted.length <= maxProposals) return sorted.slice(0, maxProposals)
  const selected = []
  const take = item => {
    if (selected.length >= maxProposals || selected.includes(item)) return
    selected.push(item)
  }
  const consolidationCount = () => selected.filter(item => item.category === 'consolidation').length
  const pinned = sorted.filter(item => item.kind === 'conflict_alert' || item.kind === 'duplicate_evidence')
  for (const item of pinned) {
    if (consolidationCount() >= 3) break
    take(item)
  }
  for (const item of sorted) {
    if (item.category !== 'consolidation' || consolidationCount() >= 3) continue
    take(item)
  }
  const associativeCount = () => selected.filter(item => item.category === 'associative').length
  for (const item of sorted) {
    if (item.category !== 'associative' || associativeCount() >= 2) continue
    take(item)
  }
  for (const item of sorted) take(item)
  return selected
}

/**
 * 构建有界梦境快照：只携带元数据、短标题与状态，绝不携带论文全文或原始响应。
 */
export function buildDreamSnapshot({
  project = '',
  evidence = [],
  claims = [],
  knowledgeNodes = [],
  knowledgeClaims = [],
  runs = [],
} = {}) {
  const scopedEvidence = (Array.isArray(evidence) ? evidence : [])
    .filter(item => item && item.id)
    .sort((a, b) => (Number(b.updatedAt || b.savedAt || 0) - Number(a.updatedAt || a.savedAt || 0)))
  const scopedClaims = (Array.isArray(claims) ? claims : [])
    .filter(item => item && item.id)
    .sort((a, b) => (Date.parse(b.updated_at || '') || 0) - (Date.parse(a.updated_at || '') || 0))
  const scopedNodes = (Array.isArray(knowledgeNodes) ? knowledgeNodes : [])
    .filter(item => item && item.id)
    .sort((a, b) => (Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)))
  const scopedKnowledgeClaims = (Array.isArray(knowledgeClaims) ? knowledgeClaims : [])
    .filter(item => item && item.id)
    .sort((a, b) => (Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)))

  const evSlice = scopedEvidence.slice(0, DREAM_SNAPSHOT_LIMITS.evidence).map(item => ({
    id: String(item.id),
    title: clampText(item.title, 140),
    identifier: String(item.identifier || '').trim(),
    identifierKind: String(item.identifierKind || item.identifier_type || '').trim(),
    status: String(item.status || 'unverified'),
    grade: String(item.grade || item.strength || 'ungraded'),
    tags: (Array.isArray(item.tags) ? item.tags : []).map(t => clampText(t, 32)).filter(Boolean).slice(0, 6),
    reason: clampText(item.reason, 120),
    note: clampText(item.note, 140),
    savedAt: Number(item.savedAt || Date.parse(item.saved_at || '') || 0),
    updatedAt: Number(item.updatedAt || item.savedAt || Date.parse(item.updated_at || '') || 0),
  }))

  const claimSlice = scopedClaims.slice(0, DREAM_SNAPSHOT_LIMITS.claims).map(item => ({
    id: String(item.id),
    statement: clampText(item.statement, 180),
    state: String(item.state || 'extracted'),
    evidenceIds: Array.isArray(item.evidence_ids)
      ? item.evidence_ids.map(String)
      : (Array.isArray(item.links) ? item.links.map(l => String(l.evidenceId || '')).filter(Boolean) : []),
    links: (Array.isArray(item.links) ? item.links : []).map(l => ({
      evidenceId: String(l.evidenceId || ''),
      stance: String(l.stance || 'unassessed'),
    })).filter(l => l.evidenceId),
    excerpt: clampText(item.source_ref?.excerpt || '', 140),
    updatedAt: Date.parse(item.updated_at || '') || Number(item.updatedAt || 0),
  }))

  const nodeSlice = scopedNodes.slice(0, DREAM_SNAPSHOT_LIMITS.knowledgeNodes).map(item => ({
    id: String(item.id),
    label: clampText(item.label, 80),
    kind: String(item.kind || 'entity'),
    entityKind: String(item.entityKind || ''),
    status: String(item.status || 'to_verify'),
    evidenceIds: (Array.isArray(item.evidenceIds) ? item.evidenceIds : []).map(String).slice(0, 8),
    excerpt: clampText(item.sources?.[0]?.excerpt || '', 120),
    updatedAt: Number(item.updatedAt || item.createdAt || 0),
  }))

  const kcSlice = scopedKnowledgeClaims.slice(0, DREAM_SNAPSHOT_LIMITS.knowledgeClaims).map(item => ({
    id: String(item.id),
    from: String(item.from || ''),
    to: String(item.to || ''),
    relation: clampText(item.relation, 40),
    polarity: String(item.polarity || 'neutral'),
    status: String(item.status || 'to_verify'),
    updatedAt: Number(item.updatedAt || item.createdAt || 0),
  }))

  return {
    project: String(project || ''),
    scannedAt: Date.now(),
    counts: {
      evidence: scopedEvidence.length,
      claims: scopedClaims.length,
      knowledgeNodes: scopedNodes.length,
      knowledgeClaims: scopedKnowledgeClaims.length,
      runs: Array.isArray(runs) ? runs.length : 0,
    },
    evidence: evSlice,
    claims: claimSlice,
    knowledgeNodes: nodeSlice,
    knowledgeClaims: kcSlice,
  }
}

export function formatDreamCompressionSummary(counts, proposalCount) {
  const ev = Number(counts?.evidence) || 0
  const cl = Number(counts?.claims) || 0
  const kn = Number(counts?.knowledgeNodes) || 0
  return `已扫描 ${ev} 条证据 · ${cl} 条论断 · ${kn} 个知识节点，提炼出 ${proposalCount} 条高信号提案`
}

function buildRefLabels(refs, snapshot) {
  const evMap = new Map((snapshot.evidence || []).map(item => [item.id, item.title || item.id]))
  const claimMap = new Map((snapshot.claims || []).map(item => [item.id, item.statement || item.id]))
  const nodeMap = new Map((snapshot.knowledgeNodes || []).map(item => [item.id, item.label || item.id]))
  const labels = []
  for (const id of refs.evidenceIds || []) if (evMap.has(id)) labels.push(`证据：${clampText(evMap.get(id), 44)}`)
  for (const id of refs.claimIds || []) if (claimMap.has(id)) labels.push(`论断：${clampText(claimMap.get(id), 44)}`)
  for (const id of refs.nodeIds || []) if (nodeMap.has(id)) labels.push(`节点：${clampText(nodeMap.get(id), 44)}`)
  return labels.slice(0, 4)
}

function generateConsolidationProposals(snapshot, now) {
  const proposals = []
  const evidence = snapshot.evidence || []
  const claims = snapshot.claims || []
  const nodes = snapshot.knowledgeNodes || []
  const kClaims = snapshot.knowledgeClaims || []
  const nodeById = new Map(nodes.map(n => [n.id, n]))

  // 1. 重复或高度相似的证据
  const byIdent = new Map()
  const byTitle = new Map()
  for (const item of evidence) {
    const identKey = normalizeIdentifierKey(item)
    if (identKey) {
      if (!byIdent.has(identKey)) byIdent.set(identKey, [])
      byIdent.get(identKey).push(item)
    }
    const titleKey = normalizeTitleKey(item.title)
    if (titleKey.length >= 8) {
      if (!byTitle.has(titleKey)) byTitle.set(titleKey, [])
      byTitle.get(titleKey).push(item)
    }
  }
  const seenDupPairs = new Set()
  for (const [label, groups] of [['相同标识符', byIdent], ['相同标题', byTitle]]) {
    for (const rows of groups.values()) {
      if (rows.length < 2) continue
      const pair = rows.slice(0, 3)
      const ids = pair.map(r => r.id).sort()
      const pairKey = ids.join(',')
      if (seenDupPairs.has(pairKey)) continue
      seenDupPairs.add(pairKey)
      const refs = { evidenceIds: ids, claimIds: [], nodeIds: [], knowledgeClaimIds: [] }
      const signature = makeSignature('duplicate_evidence', refs)
      proposals.push({
        id: proposalIdFromSignature(signature),
        signature,
        kind: 'duplicate_evidence',
        category: 'consolidation',
        priority: 95,
        title: `发现 ${pair.length} 条疑似重复证据（${label}）`,
        summary: `「${clampText(pair[0].title, 48)}」在当前课题中出现多次，建议在证据库核对并合并笔记，避免统计重复计入。`,
        refs,
        refLabels: buildRefLabels(refs, snapshot),
        action: { type: 'navigate', target: 'vault', options: { tab: 'evidence' }, label: '去证据库核对' },
        status: 'pending',
        unverifiedInference: false,
      })
    }
  }

  // 2. 立场冲突预警（Claim 同时存在 supports 与 refutes，或知识图谱同主宾语正负极性并存）
  for (const claim of claims) {
    const supports = (claim.links || []).filter(l => l.stance === 'supports').map(l => l.evidenceId)
    const refutes = (claim.links || []).filter(l => l.stance === 'refutes').map(l => l.evidenceId)
    if (supports.length && refutes.length) {
      const evIds = [...new Set([...supports, ...refutes])].slice(0, 4)
      const refs = { evidenceIds: evIds, claimIds: [claim.id], nodeIds: [], knowledgeClaimIds: [] }
      const signature = makeSignature('conflict_alert', refs)
      proposals.push({
        id: proposalIdFromSignature(signature),
        signature,
        kind: 'conflict_alert',
        category: 'consolidation',
        priority: 98,
        title: `论断存在正反证据冲突`,
        summary: `「${clampText(claim.statement, 56)}」同时关联了 ${supports.length} 条支持与 ${refutes.length} 条反驳证据，建议优先复核实验条件与适用范围。`,
        refs,
        refLabels: buildRefLabels(refs, snapshot),
        action: { type: 'navigate', target: 'vault', options: { tab: 'claims' }, label: '去核验 Claim' },
        promptDraft: `请对比论断「${claim.statement}」背后的支持与反驳证据，梳理造成结论分歧的实验条件、样本或方法差异，并标注仍需核验的原文位置。`,
        status: 'pending',
        unverifiedInference: false,
      })
    }
  }

  const kcByPair = new Map()
  for (const kc of kClaims) {
    const key = `${kc.from}|${kc.to}`
    if (!kcByPair.has(key)) kcByPair.set(key, [])
    kcByPair.get(key).push(kc)
  }
  for (const rows of kcByPair.values()) {
    const pos = rows.find(r => r.polarity === 'positive')
    const neg = rows.find(r => r.polarity === 'negative')
    if (pos && neg) {
      const fromLabel = nodeById.get(pos.from)?.label || pos.from
      const toLabel = nodeById.get(pos.to)?.label || pos.to
      const refs = { evidenceIds: [], claimIds: [], nodeIds: [pos.from, pos.to].filter(id => nodeById.has(id)), knowledgeClaimIds: [pos.id, neg.id] }
      const signature = makeSignature('conflict_alert', refs)
      proposals.push({
        id: proposalIdFromSignature(signature),
        signature,
        kind: 'conflict_alert',
        category: 'consolidation',
        priority: 92,
        title: `知识图谱存在正负关系冲突：${clampText(fromLabel, 24)} → ${clampText(toLabel, 24)}`,
        summary: `图谱中同时记录了正向关系「${pos.relation}」与负向关系「${neg.relation}」，建议在证据图谱中回溯两条关系的原始出处。`,
        refs,
        refLabels: buildRefLabels(refs, snapshot),
        action: { type: 'navigate', target: 'evidence', options: {}, label: '在图谱中查看' },
        promptDraft: `在当前课题的知识沉淀中，关于「${fromLabel}」与「${toLabel}」同时存在正向（${pos.relation}）和负向（${neg.relation}）记录。请帮我对照已有证据梳理分歧原因。`,
        status: 'pending',
        unverifiedInference: false,
      })
    }
  }

  // 3. 孤立论断或孤立知识节点匹配已有证据（建议关联）
  const evTokens = evidence.map(item => ({
    item,
    tokens: tokenizeDreamText(`${item.title} ${(item.tags || []).join(' ')} ${item.reason}`),
  }))

  for (const claim of claims) {
    if ((claim.evidenceIds || []).length > 0) continue
    const cTokens = tokenizeDreamText(claim.statement)
    if (!cTokens.size) continue
    const matched = evTokens
      .map(entry => ({ item: entry.item, overlap: sharedTokens(cTokens, entry.tokens) }))
      .filter(entry => entry.overlap.length >= 2)
      .sort((a, b) => b.overlap.length - a.overlap.length)
      .slice(0, 2)
    if (!matched.length) continue
    const refs = { evidenceIds: matched.map(m => m.item.id), claimIds: [claim.id], nodeIds: [], knowledgeClaimIds: [] }
    const signature = makeSignature('link_suggestion', refs)
    proposals.push({
      id: proposalIdFromSignature(signature),
      signature,
      kind: 'link_suggestion',
      category: 'consolidation',
      priority: 84,
      title: `未挂证据的论断有 ${matched.length} 条潜在来源可关联`,
      summary: `论断「${clampText(claim.statement, 50)}」尚无关联证据，但与已保存证据共享关键词（${matched[0].overlap.slice(0, 3).join('、')}），建议核对后建立关联。`,
      refs,
      refLabels: buildRefLabels(refs, snapshot),
      action: { type: 'navigate', target: 'vault', options: { tab: 'claims' }, label: '去关联证据' },
      status: 'pending',
      unverifiedInference: false,
    })
  }

  // 4. 积压的待核验核心项（只挑最值得先看的一条，避免刷屏）
  const staleThresholdMs = 3 * 24 * 60 * 60 * 1000
  const unverifiedClaims = claims
    .filter(c => !['verified', 'rejected'].includes(c.state))
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))
  const unverifiedEvidence = evidence
    .filter(e => e.status === 'unverified')
    .sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0))

  if (unverifiedClaims.length >= 2 || (unverifiedClaims.length === 1 && unverifiedClaims[0].updatedAt && now - unverifiedClaims[0].updatedAt > staleThresholdMs)) {
    const target = unverifiedClaims[0]
    const refs = { evidenceIds: (target.evidenceIds || []).slice(0, 2), claimIds: [target.id], nodeIds: [], knowledgeClaimIds: [] }
    const signature = makeSignature('stale_review', refs)
    proposals.push({
      id: proposalIdFromSignature(signature),
      signature,
      kind: 'stale_review',
      category: 'consolidation',
      priority: 72,
      title: `优先清理积压的待核验论断（共 ${unverifiedClaims.length} 条）`,
      summary: `最早一条「${clampText(target.statement, 56)}」仍停留在 ${target.state} 状态，建议先核验这一条再推进后续写作。`,
      refs,
      refLabels: buildRefLabels(refs, snapshot),
      action: { type: 'navigate', target: 'vault', options: { tab: 'claims' }, label: '去核验 Claim' },
      status: 'pending',
      unverifiedInference: false,
    })
  } else if (unverifiedEvidence.length >= 3) {
    const top = unverifiedEvidence.slice(0, 3)
    const refs = { evidenceIds: top.map(e => e.id), claimIds: [], nodeIds: [], knowledgeClaimIds: [] }
    const signature = makeSignature('stale_review', refs)
    proposals.push({
      id: proposalIdFromSignature(signature),
      signature,
      kind: 'stale_review',
      category: 'consolidation',
      priority: 68,
      title: `有 ${unverifiedEvidence.length} 条已保存证据尚未核验`,
      summary: `建议优先复核最早入库的「${clampText(top[0].title, 48)}」等 ${top.length} 条证据，剔除不相关文献以减轻后续阅读负担。`,
      refs,
      refLabels: buildRefLabels(refs, snapshot),
      action: { type: 'navigate', target: 'vault', options: { tab: 'evidence' }, label: '去筛选证据' },
      status: 'pending',
      unverifiedInference: false,
    })
  }

  return proposals
}

function generateAssociativeProposals(snapshot) {
  const proposals = []
  const evidence = snapshot.evidence || []
  const claims = snapshot.claims || []
  const nodes = snapshot.knowledgeNodes || []

  const evTokenList = evidence.map(item => ({
    item,
    tokens: tokenizeDreamText(`${item.title} ${(item.tags || []).join(' ')} ${item.reason} ${item.note}`),
  }))

  // 1. 缺口线索：旧的 ambiguous 论断或含「缺口」的节点，在新近证据里出现共同关键词
  const gapTargets = [
    ...claims.filter(c => c.state === 'ambiguous' || /缺口|未提供|待补/.test(c.statement)).map(c => ({
      kind: 'claim',
      id: c.id,
      text: c.statement,
      updatedAt: c.updatedAt || 0,
      linked: new Set(c.evidenceIds || []),
    })),
    ...nodes.filter(n => /缺口|未提供|待补/.test(`${n.label} ${n.excerpt}`)).map(n => ({
      kind: 'node',
      id: n.id,
      text: `${n.label} ${n.excerpt}`,
      updatedAt: n.updatedAt || 0,
      linked: new Set(n.evidenceIds || []),
    })),
  ]

  for (const gap of gapTargets.slice(0, 6)) {
    const gTokens = tokenizeDreamText(gap.text)
    if (!gTokens.size) continue
    const candidates = evTokenList
      .filter(entry => !gap.linked.has(entry.item.id))
      .map(entry => ({ item: entry.item, overlap: sharedTokens(gTokens, entry.tokens) }))
      .filter(entry => entry.overlap.length >= 2)
      .sort((a, b) => b.overlap.length - a.overlap.length)
      .slice(0, 2)
    if (!candidates.length) continue
    const refs = {
      evidenceIds: candidates.map(c => c.item.id),
      claimIds: gap.kind === 'claim' ? [gap.id] : [],
      nodeIds: gap.kind === 'node' ? [gap.id] : [],
      knowledgeClaimIds: [],
    }
    const signature = makeSignature('gap_clue', refs)
    proposals.push({
      id: proposalIdFromSignature(signature),
      signature,
      kind: 'gap_clue',
      category: 'associative',
      priority: 88,
      title: `新证据可能呼应已有研究缺口`,
      summary: `已有待解线索「${clampText(gap.text, 44)}」与未关联证据「${clampText(candidates[0].item.title, 40)}」共享关键概念（${candidates[0].overlap.slice(0, 3).join('、')}），值得交叉核对。`,
      refs,
      refLabels: buildRefLabels(refs, snapshot),
      action: { type: 'insert_prompt', workflowId: 'literature-review', label: '写入继续研究' },
      promptDraft: `请核对证据「${candidates[0].item.title}」是否能够回应或补充当前课题中的研究缺口「${clampText(gap.text, 80)}」。请严格区分原文实测结果与推论，不得编造未给出的实验细节。`,
      status: 'pending',
      unverifiedInference: true,
    })
  }

  // 2. 跨文献弱连接（两篇不同来源/不同标题的证据共享 2+ 核心术语，但尚未共同挂到同一条 Claim）
  const coLinkedPairs = new Set()
  for (const claim of claims) {
    const ids = claim.evidenceIds || []
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        coLinkedPairs.add([ids[i], ids[j]].sort().join('|'))
      }
    }
  }

  const bridges = []
  for (let i = 0; i < Math.min(evTokenList.length, 30); i++) {
    for (let j = i + 1; j < Math.min(evTokenList.length, 30); j++) {
      const a = evTokenList[i]
      const b = evTokenList[j]
      if (normalizeTitleKey(a.item.title) === normalizeTitleKey(b.item.title)) continue
      const pairKey = [a.item.id, b.item.id].sort().join('|')
      if (coLinkedPairs.has(pairKey)) continue
      const overlap = sharedTokens(a.tokens, b.tokens)
      if (overlap.length >= 2) {
        bridges.push({ a: a.item, b: b.item, overlap })
      }
    }
  }
  bridges.sort((x, y) => y.overlap.length - x.overlap.length)
  for (const bridge of bridges.slice(0, 2)) {
    const refs = { evidenceIds: [bridge.a.id, bridge.b.id].sort(), claimIds: [], nodeIds: [], knowledgeClaimIds: [] }
    const signature = makeSignature('bridge_insight', refs)
    proposals.push({
      id: proposalIdFromSignature(signature),
      signature,
      kind: 'bridge_insight',
      category: 'associative',
      priority: 82,
      title: `跨文献桥接线索：${bridge.overlap.slice(0, 3).join(' × ')}`,
      summary: `「${clampText(bridge.a.title, 36)}」与「${clampText(bridge.b.title, 36)}」尚未在同一条论断中对照，但均涉及 ${bridge.overlap.slice(0, 3).join('、')}，可尝试做跨文献机制比较或提出可检验假说。`,
      refs,
      refLabels: buildRefLabels(refs, snapshot),
      action: { type: 'insert_prompt', workflowId: 'hypothesis-generation', label: '写入假说发散草稿' },
      promptDraft: `请对照这两条尚未共同分析的证据：\n1. ${bridge.a.title}${bridge.a.identifier ? ` (${bridge.a.identifier})` : ''}\n2. ${bridge.b.title}${bridge.b.identifier ? ` (${bridge.b.identifier})` : ''}\n围绕共同概念（${bridge.overlap.slice(0, 4).join('、')}），帮我提出 1–2 个可检验的研究假说与验证思路，并明确标注哪些属于待核验推论。`,
      status: 'pending',
      unverifiedInference: true,
    })
  }

  // 3. 知识实体跨节点联想假说（若图谱有多个待核验实体但无直接关系）
  const entities = nodes.filter(n => n.kind === 'entity')
  if (entities.length >= 2 && proposals.length < 2) {
    const first = entities[0]
    const second = entities[1]
    const refs = { evidenceIds: [...new Set([...(first.evidenceIds || []), ...(second.evidenceIds || [])])].slice(0, 2), claimIds: [], nodeIds: [first.id, second.id].sort(), knowledgeClaimIds: [] }
    const signature = makeSignature('hypothesis_draft', refs)
    proposals.push({
      id: proposalIdFromSignature(signature),
      signature,
      kind: 'hypothesis_draft',
      category: 'associative',
      priority: 74,
      title: `待核验假说方向：探索「${clampText(first.label, 20)}」与「${clampText(second.label, 20)}」的潜在关联`,
      summary: `这两个高频沉淀概念目前在课题中尚未建立直接对照，可结合已有证据设计对照分析或补充文献检索来检验二者是否存在上下游或交互关系。`,
      refs,
      refLabels: buildRefLabels(refs, snapshot),
      action: { type: 'insert_prompt', workflowId: 'hypothesis-generation', label: '写入假说发散草稿' },
      promptDraft: `基于当前课题已沉淀的两个核心概念「${first.label}」与「${second.label}」，请帮我设计一个可证伪的研究假说与最小验证方案，并列出需要先补充检索的关键文献方向。`,
      status: 'pending',
      unverifiedInference: true,
    })
  }

  return proposals
}

/**
 * 纯本地规则引擎（零 Token）：根据所选模式生成并压缩为 Top N 高信号提案。
 */
export function runLocalDream({
  snapshot,
  mode = 'full',
  handledSignatures = [],
  maxProposals = DREAM_MAX_PROPOSALS,
  now = Date.now(),
} = {}) {
  const safeMode = normalizeDreamMode(mode)
  const handled = new Set(Array.isArray(handledSignatures) ? handledSignatures : [])
  const raw = []
  if (safeMode === 'consolidation' || safeMode === 'full') {
    raw.push(...generateConsolidationProposals(snapshot, now))
  }
  if (safeMode === 'associative' || safeMode === 'full') {
    raw.push(...generateAssociativeProposals(snapshot))
  }
  const deduped = []
  const seen = new Set()
  for (const item of raw) {
    if (handled.has(item.signature) || seen.has(item.signature)) continue
    seen.add(item.signature)
    deduped.push(item)
  }
  const selected = selectDreamProposals(deduped, safeMode, maxProposals).map(withRecordFocus)

  return {
    mode: safeMode,
    engine: 'local-rules',
    model: '',
    createdAt: now,
    counts: snapshot?.counts || { evidence: 0, claims: 0, knowledgeNodes: 0, knowledgeClaims: 0, runs: 0 },
    digest: formatDreamCompressionSummary(snapshot?.counts, selected.length),
    proposals: selected,
  }
}

/**
 * 合并本地规则与宿主模型提案：按类型和引用去重，完整梦保留冲突与重复证据名额。
 * 同一引用上的冲突或重复以本地规则为准，避免模型改写已发现的事实。
 */
export function mergeDreamProposals({
  local = [],
  host = [],
  mode = 'full',
  maxProposals = DREAM_MAX_PROPOSALS,
} = {}) {
  const safeMode = normalizeDreamMode(mode)
  const byKey = new Map()
  const consider = (item, source) => {
    if (!item?.kind || !item.signature) return
    const key = makeSignature(item.kind, item.refs || {})
    const previous = byKey.get(key)
    if (!previous) {
      byKey.set(key, item)
      return
    }
    const factual = item.kind === 'conflict_alert' || item.kind === 'duplicate_evidence'
    if (factual && source === 'host') return
    if (factual && source === 'local') {
      byKey.set(key, item)
      return
    }
    if ((item.priority || 0) >= (previous.priority || 0)) byKey.set(key, item)
  }
  for (const item of local) consider(item, 'local')
  for (const item of host) consider(item, 'host')
  return selectDreamProposals([...byKey.values()], safeMode, maxProposals).map(withRecordFocus)
}

/**
 * 校验并标准化宿主 LLM 返回的梦境提案：
 * - 每条提案至少锚定 1 个快照中真实存在的 ID；任一声明的引用无效则整条拒绝；
 * - 强制为联想类提案标记 unverifiedInference = true；
 * - 过滤掉已处理的 signature，并硬截断至 DREAM_MAX_PROPOSALS。
 */
export function parseDreamLlmProposals(parsed, snapshot, {
  mode = 'full',
  handledSignatures = [],
  maxProposals = DREAM_MAX_PROPOSALS,
} = {}) {
  const safeMode = normalizeDreamMode(mode)
  const handled = new Set(Array.isArray(handledSignatures) ? handledSignatures : [])
  const validEvidence = new Set((snapshot?.evidence || []).map(item => item.id))
  const validClaims = new Set((snapshot?.claims || []).map(item => item.id))
  const validNodes = new Set((snapshot?.knowledgeNodes || []).map(item => item.id))
  const validKClaims = new Set((snapshot?.knowledgeClaims || []).map(item => item.id))

  const rows = Array.isArray(parsed?.proposals) ? parsed.proposals : []
  const out = []
  const seen = new Set()

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const kind = DREAM_PROPOSAL_KINDS.includes(row.kind) ? row.kind : ''
    if (!kind) continue
    if (safeMode === 'consolidation' && !CONSOLIDATION_KINDS.has(kind)) continue
    if (safeMode === 'associative' && !ASSOCIATIVE_KINDS.has(kind)) continue

    const title = clampText(row.title, 80)
    const summary = clampText(row.summary, 240)
    if (!title || !summary) continue

    const rawRefs = row.refs && typeof row.refs === 'object' ? row.refs : {}
    const declaredIds = list => (Array.isArray(list) ? list : []).map(id => String(id || '').trim()).filter(Boolean)
    const evidenceDeclared = declaredIds(rawRefs.evidenceIds)
    const claimDeclared = declaredIds(rawRefs.claimIds)
    const nodeDeclared = declaredIds(rawRefs.nodeIds)
    const knowledgeDeclared = declaredIds(rawRefs.knowledgeClaimIds)
    const everyAnchored = (ids, valid) => ids.every(id => valid.has(id))
    if (!everyAnchored(evidenceDeclared, validEvidence)
      || !everyAnchored(claimDeclared, validClaims)
      || !everyAnchored(nodeDeclared, validNodes)
      || !everyAnchored(knowledgeDeclared, validKClaims)) continue

    const evidenceIds = [...new Set(evidenceDeclared)].slice(0, 4)
    const claimIds = [...new Set(claimDeclared)].slice(0, 4)
    const nodeIds = [...new Set(nodeDeclared)].slice(0, 4)
    const knowledgeClaimIds = [...new Set(knowledgeDeclared)].slice(0, 4)
    if (evidenceIds.length + claimIds.length + nodeIds.length + knowledgeClaimIds.length === 0) continue

    const refs = { evidenceIds, claimIds, nodeIds, knowledgeClaimIds }
    const signature = makeSignature(kind, refs, title.slice(0, 24))
    if (handled.has(signature) || seen.has(signature)) continue
    seen.add(signature)

    const category = ASSOCIATIVE_KINDS.has(kind) ? 'associative' : 'consolidation'
    const promptDraft = clampText(row.promptDraft || '', 420)
    const action = category === 'associative'
      ? { type: 'insert_prompt', workflowId: 'hypothesis-generation', label: '写入继续研究' }
      : (claimIds.length
        ? { type: 'navigate', target: 'vault', options: { tab: 'claims' }, label: '去核验 Claim' }
        : nodeIds.length && !evidenceIds.length
          ? { type: 'navigate', target: 'evidence', options: {}, label: '在图谱中查看' }
          : { type: 'navigate', target: 'vault', options: { tab: 'evidence' }, label: '去证据库核对' })

    out.push(withRecordFocus({
      id: proposalIdFromSignature(signature),
      signature,
      kind,
      category,
      priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 80,
      title,
      summary,
      refs,
      refLabels: buildRefLabels(refs, snapshot),
      action,
      promptDraft: promptDraft || (category === 'associative' ? `围绕「${title}」核对已有证据并补充验证：${summary}` : ''),
      status: 'pending',
      unverifiedInference: category === 'associative',
    }))
    if (out.length >= maxProposals) break
  }

  return out
}
