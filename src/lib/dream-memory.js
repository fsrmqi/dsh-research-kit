// 梦境的长期记忆。原文留在证据库、Claim 台账和灵感库；这里只保存可展开的摘要。
//
// 文件形状（schemaVersion 1）：
// {
//   schemaVersion: 1,
//   project: "课题名",
//   cards: [{
//     id, layer: "card", status: "active" | "folded",
//     judgment: "duplicate" | "supports" | "refutes" | "unrelated" | "unresolved",
//     gist, covers: { evidenceIds, claimIds, nodeIds, knowledgeClaimIds, assetIds },
//     sourceProposalId, createdAt, updatedAt
//   }],
//   themes: [{
//     id, layer: "theme", status: "active",
//     gist, openConflicts, gaps, cardIds,
//     covers: { ...同上，外加 cardIds },
//     createdAt, updatedAt
//   }]
// }
// 热记忆 = 主题摘要 + 尚未收进主题的记忆卡。展开某张卡才取回原记录编号。

export const DREAM_MEMORY_PATH = '/dsh-research-kit/dream-memory'
export const DREAM_MEMORY_SCHEMA = 1
export const MEMORY_JUDGMENTS = ['duplicate', 'supports', 'refutes', 'unrelated', 'unresolved']
export const MEMORY_CARD_LIMIT = 200
export const MEMORY_THEME_LIMIT = 40
const COVER_KEYS = ['evidenceIds', 'claimIds', 'nodeIds', 'knowledgeClaimIds', 'assetIds']

const clamp = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)

function cleanIds(value, max = 12) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => String(item || '').trim()).filter(Boolean))].slice(0, max)
}

function cleanCovers(covers = {}) {
  return {
    evidenceIds: cleanIds(covers.evidenceIds),
    claimIds: cleanIds(covers.claimIds),
    nodeIds: cleanIds(covers.nodeIds),
    knowledgeClaimIds: cleanIds(covers.knowledgeClaimIds),
    assetIds: cleanIds(covers.assetIds),
  }
}

function hasCover(covers) {
  return COVER_KEYS.some(key => covers[key].length > 0)
}

export function emptyDreamMemory(project = '') {
  return { schemaVersion: DREAM_MEMORY_SCHEMA, project: String(project || ''), cards: [], themes: [] }
}

export function normalizeDreamMemory(input, project = '') {
  const source = input && typeof input === 'object' ? input : {}
  return {
    schemaVersion: DREAM_MEMORY_SCHEMA,
    project: String(source.project || project || ''),
    cards: (Array.isArray(source.cards) ? source.cards : []).map(row => normalizeMemoryCard(row)).filter(Boolean).slice(0, MEMORY_CARD_LIMIT),
    themes: (Array.isArray(source.themes) ? source.themes : []).map(row => normalizeMemoryTheme(row)).filter(Boolean).slice(0, MEMORY_THEME_LIMIT),
  }
}

export function normalizeMemoryCard(input, now = new Date().toISOString()) {
  if (!input || typeof input !== 'object') return null
  const covers = cleanCovers(input.covers || input.refs || {})
  const gist = clamp(input.gist || input.summary || input.title, 500)
  if (!gist || !hasCover(covers)) return null
  const judgment = MEMORY_JUDGMENTS.includes(input.judgment) ? input.judgment : 'unresolved'
  return {
    id: clamp(input.id, 80) || `memcard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    layer: 'card',
    status: input.status === 'pending' || !(input.confirmed === true || input.sourceProposalId) ? 'pending' : input.status === 'folded' ? 'folded' : 'active',
    confirmed: input.confirmed === true || Boolean(input.sourceProposalId),
    judgment,
    gist,
    covers,
    sourceProposalId: clamp(input.sourceProposalId, 80),
    createdAt: clamp(input.createdAt, 40) || now,
    updatedAt: clamp(input.updatedAt, 40) || now,
  }
}

export function normalizeMemoryTheme(input, now = new Date().toISOString()) {
  if (!input || typeof input !== 'object') return null
  const cardIds = cleanIds(input.cardIds, 24)
  const covers = cleanCovers(input.covers || {})
  const gist = clamp(input.gist, 800)
  if (!gist || cardIds.length < 2) return null
  return {
    id: clamp(input.id, 80) || `memtheme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    layer: 'theme',
    status: input.status === 'pending' ? 'pending' : 'active',
    gist,
    openConflicts: clamp(input.openConflicts, 300),
    gaps: clamp(input.gaps, 300),
    cardIds,
    covers,
    createdAt: clamp(input.createdAt, 40) || now,
    updatedAt: clamp(input.updatedAt, 40) || now,
  }
}

export function judgmentForProposal(proposal = {}) {
  if (proposal.kind === 'duplicate_evidence') return 'duplicate'
  if (proposal.kind === 'conflict_alert') return 'unresolved'
  if (proposal.kind === 'link_suggestion') return 'supports'
  return 'unresolved'
}

export function memoryCardFromProposal(proposal = {}, { project = '' } = {}) {
  return normalizeMemoryCard({
    id: proposal.id ? `memory-${proposal.id}` : undefined,
    project,
    judgment: judgmentForProposal(proposal),
    gist: `${proposal.title || ''}。${proposal.summary || ''}`,
    covers: proposal.refs || {},
    sourceProposalId: proposal.id || '',
  })
}

function activeCards(memory) {
  return (memory?.cards || []).filter(card => card.status === 'active')
}

export function looseMemoryCards(memory) {
  const folded = new Set((memory?.themes || []).filter(theme => theme.status === 'active').flatMap(theme => theme.cardIds))
  return activeCards(memory).filter(card => !folded.has(card.id))
}

export function coverIndex(memory) {
  const index = new Map()
  const stamp = item => {
    const at = Date.parse(item.updatedAt || item.createdAt || '') || 0
    for (const key of COVER_KEYS) {
      for (const id of item.covers?.[key] || []) {
        const previous = index.get(id) || 0
        if (at >= previous) index.set(id, at)
      }
    }
  }
  for (const card of memory?.cards || []) if (card.status === 'active') stamp(card)
  const confirmed = new Map([...(memory?.cards || []), ...(memory?.coveredCards || [])].filter(card => card.status !== 'pending').map(card => [card.id, card]))
  for (const theme of memory?.themes || []) {
    if (theme.status !== 'active') continue
    for (const id of theme.cardIds) {
      const card = confirmed.get(id)
      if (card?.status === 'folded') stamp(card)
    }
  }
  return index
}

export function removeDreamProposalMemory(memory, proposalId) {
  const removed = new Set(memory.cards.filter(card => card.sourceProposalId === proposalId).map(card => card.id))
  const themes = memory.themes.filter(theme => !theme.cardIds.some(id => removed.has(id)))
  const folded = new Set(themes.filter(theme => theme.status === 'active').flatMap(theme => theme.cardIds))
  const cards = memory.cards.filter(card => !removed.has(card.id)).map(card =>
    card.status === 'folded' && !folded.has(card.id) ? { ...card, status: 'active' } : card)
  return { ...memory, themes, cards }
}

export function dreamMemoryRefsExist(refs, records) {
  return COVER_KEYS.every(key => {
    const ids = new Set((records[key] || []).map(record => String(record.id)))
    return (refs[key] || []).every(id => ids.has(id))
  }) && hasCover(cleanCovers(refs))
}

export function isRetiredRecord(row, kind, index) {
  const at = index?.get?.(String(row?.id || ''))
  if (at == null) return false
  const time = kind === 'claims'
    ? Date.parse(row.updated_at || '') || Number(row.updatedAt || 0) || 0
    : Number(row.updatedAt || row.savedAt || row.createdAt || 0) || 0
  return time <= at
}

export function retireCoveredRecords(rows, kind, index) {
  return (Array.isArray(rows) ? rows : []).filter(row => !isRetiredRecord(row, kind, index))
}

export function themeFromCards(cards, { gist = '' } = {}) {
  const rows = (Array.isArray(cards) ? cards : []).filter(card => card && card.id).slice(0, 8)
  if (rows.length < 3) return null
  const covers = cleanCovers(rows.reduce((all, card) => {
    for (const key of COVER_KEYS) all[key] = [...(all[key] || []), ...(card.covers?.[key] || [])]
    return all
  }, {}))
  const unresolved = rows.filter(card => card.judgment === 'unresolved' || card.judgment === 'refutes')
  return normalizeMemoryTheme({
    gist: gist || rows.map(card => card.gist).join(' '),
    openConflicts: unresolved.map(card => card.gist).join(' '),
    gaps: rows.filter(card => card.judgment === 'unresolved').map(card => card.gist).join(' '),
    cardIds: rows.map(card => card.id),
    covers,
  })
}

export function foldCardsIntoTheme(memory, theme) {
  const next = normalizeDreamMemory(memory, memory?.project)
  const normalized = normalizeMemoryTheme(theme)
  if (!normalized) return next
  const known = new Set(next.cards.map(card => card.id))
  if (normalized.cardIds.some(id => !known.has(id))) return next
  if (normalized.status === 'active' && next.cards.some(card => normalized.cardIds.includes(card.id) && card.status === 'pending')) return next
  next.themes = [normalized, ...next.themes.filter(item => item.id !== normalized.id)].slice(0, MEMORY_THEME_LIMIT)
  if (normalized.status === 'pending') return next
  const folded = new Set(normalized.cardIds)
  next.cards = next.cards.map(card => folded.has(card.id) ? { ...card, status: 'folded' } : card)
  return next
}

export function addMemoryCard(memory, card) {
  const next = normalizeDreamMemory(memory, memory?.project)
  const normalized = normalizeMemoryCard(card)
  if (!normalized) return next
  next.cards = [normalized, ...next.cards.filter(item => item.id !== normalized.id)].slice(0, MEMORY_CARD_LIMIT)
  return next
}

function publicCard(card) {
  return {
    id: card.id,
    layer: 'card',
    status: card.status,
    judgment: card.judgment,
    gist: card.gist,
    covers: card.covers,
    sourceProposalId: card.sourceProposalId,
    updatedAt: card.updatedAt,
  }
}

function publicTheme(theme) {
  return {
    id: theme.id,
    layer: 'theme',
    status: theme.status,
    gist: theme.gist,
    openConflicts: theme.openConflicts,
    gaps: theme.gaps,
    cardIds: theme.cardIds,
    covers: theme.covers,
    updatedAt: theme.updatedAt,
  }
}

export function hotDreamMemory(memory) {
  const normalized = normalizeDreamMemory(memory)
  const themes = normalized.themes.filter(theme => theme.status === 'active').map(publicTheme)
  const cards = looseMemoryCards(normalized).map(publicCard)
  const index = coverIndex(normalized)
  return {
    schemaVersion: DREAM_MEMORY_SCHEMA,
    project: normalized.project,
    themes,
    cards,
    coveredCards: normalized.cards.filter(card => card.status === 'folded').map(publicCard),
    pending: [...normalized.cards.filter(card => card.status === 'pending').map(publicCard), ...normalized.themes.filter(theme => theme.status === 'pending').map(publicTheme)],
    foldedCardCount: normalized.cards.filter(card => card.status === 'folded').length,
    coveredCount: index.size,
    note: '热记忆只含主题摘要和尚未收进主题的记忆卡。展开某张卡可取回原记录编号；原文仍在证据库和 Claim 台账，这里不删除它们。',
  }
}

export function expandDreamMemory(memory, id) {
  const normalized = normalizeDreamMemory(memory)
  const key = String(id || '')
  const theme = normalized.themes.find(item => item.id === key)
  if (theme) {
    const cards = normalized.cards.filter(card => theme.cardIds.includes(card.id)).map(publicCard)
    return { layer: 'theme', theme: publicTheme(theme), cards }
  }
  const card = normalized.cards.find(item => item.id === key)
  if (!card) return null
  return { layer: 'card', card: publicCard(card) }
}
