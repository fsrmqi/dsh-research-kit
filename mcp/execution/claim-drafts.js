import { extractClaims } from './claim-auditor.js'

function normalizedIdentifier(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/[).,;]+$/, '')
}

function citedSentence(text, index, citationText) {
  const before = text.slice(Math.max(0, index - 400), index)
  const breakAt = Math.max(before.lastIndexOf('。'), before.lastIndexOf('！'), before.lastIndexOf('？'), before.lastIndexOf('\n'), before.lastIndexOf('. '))
  const start = Math.max(0, index - before.length + breakAt + (before.slice(breakAt, breakAt + 2) === '. ' ? 2 : 1))
  const afterIndex = index + citationText.length
  const after = text.slice(afterIndex, afterIndex + 300)
  const ending = after.search(/[。！？\n]|\.\s/)
  const end = ending < 0 ? afterIndex + Math.min(after.length, 160) : afterIndex + ending + 1
  return text.slice(start, end).replace(citationText, ' ').replace(/\s+/g, ' ').replace(/\s+([。！？.,;])/g, '$1').trim().slice(0, 500)
}

export function extractClaimDrafts(text, entries = [], { limit = 20 } = {}) {
  const source = String(text || '')
  if (!source.trim() || source.length > 20_000) throw new Error('研究文本不能为空且不能超过 20000 字符。')
  const saved = new Map(entries.map(entry => [`${entry.identifier_type}:${normalizedIdentifier(entry.identifier)}`, entry.id]))
  const seen = new Set()
  return extractClaims(source).slice(0, Math.min(Math.max(Number(limit) || 20, 1), 50)).flatMap(item => {
    const statement = citedSentence(source, item.index, item.citation_text)
    if (statement.length < 12) return []
    const key = `${statement.toLowerCase()}|${item.citation_type}:${normalizedIdentifier(item.citation)}`
    if (seen.has(key)) return []
    seen.add(key)
    const evidenceId = saved.get(`${item.citation_type}:${normalizedIdentifier(item.citation)}`)
    return [{
      statement,
      state: 'extracted',
      evidence_ids: evidenceId ? [evidenceId] : [],
      source_ref: {
        citation: item.citation,
        citation_type: item.citation_type,
        locator: `char:${item.index}`,
        excerpt: source.slice(Math.max(0, item.index - 100), Math.min(source.length, item.index + item.citation_text.length + 100)).replace(/\s+/g, ' ').trim().slice(0, 300),
      },
      matched_evidence: Boolean(evidenceId),
    }]
  })
}
