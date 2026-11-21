import { clampKnowledgeLabel, extractCitations, extractKnowledge, hashKey, normalizeKnowledgeLabel, MAX_NODES_PER_MESSAGE } from './knowledge-extract.js'

const ANSWER_ANNOTATION = /【(依据|缺口)[：:]([^】\n]+)】/g

export function researchCitationHref(citation) {
  if (citation.identifierKind === 'doi') return `https://doi.org/${citation.identifier.split('/').map(encodeURIComponent).join('/')}`
  if (citation.identifierKind === 'pmid') return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(citation.identifier)}/`
  if (citation.identifierKind === 'pmcid') return `https://pmc.ncbi.nlm.nih.gov/articles/${encodeURIComponent(citation.identifier)}/`
  if (citation.identifierKind === 'arxiv') return `https://arxiv.org/abs/${citation.identifier.split('/').map(encodeURIComponent).join('/')}`
  try {
    const url = new URL(citation.url)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : ''
  } catch { return '' }
}

function answerCitationKey(citation) {
  return citation.identifier
    ? `${citation.identifierKind}:${citation.identifier.toLowerCase()}`
    : `url:${citation.url}`
}

export function extractAnswerEvidence(text, project) {
  const extracted = extractKnowledge(text)
  const indexes = new Map(extracted.citations.map((citation, index) => [answerCitationKey(citation), index]))
  const rows = new Map()
  const gaps = new Map()
  for (const line of String(text || '').split(/\r?\n/)) {
    const annotations = [...line.matchAll(ANSWER_ANNOTATION)]
    if (!annotations.length || /^\s*\|/.test(line)) continue
    const statement = normalizeKnowledgeLabel(line.replace(ANSWER_ANNOTATION, '').trim()
      .replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/, ''))
    const nodeKey = `finding:answer:${hashKey(JSON.stringify([project || '', statement]))}`
    const missing = annotations.filter(match => match[1] === '缺口').map(match => match[2].trim().slice(0, 200))
    if (missing.length && gaps.size < 4) gaps.set(nodeKey, { nodeKey, statement, references: [], unlinked: [], gaps: [...new Set(missing)].slice(0, 4) })
    if (statement.length < 4 || !annotations.some(match => match[1] === '依据')) continue
    if (!rows.has(nodeKey)) {
      if (rows.size === 8) continue
      rows.set(nodeKey, { nodeKey, statement, references: [], unlinked: [] })
    }
    const row = rows.get(nodeKey)
    for (const [, kind, annotation] of annotations) {
      if (kind === '缺口') continue
      const nextReference = /[；;]\s*(?=[^；;｜|]+[｜|])/u
      for (const item of annotation.split(nextReference).slice(0, 8)) {
        const fields = item.split(/[｜|]/).map(field => field.trim())
        if (![2, 3].includes(fields.length) || fields.some(field => !field)) continue
        const [paper, identifier, locator] = fields.length === 2 ? [fields[0], fields[0], fields[1]] : fields
        const cited = extractCitations(identifier).map(answerCitationKey)
        const named = fields.length === 3 ? extractCitations(paper).map(answerCitationKey) : []
        const agrees = named.every(key => key === cited[0])
        const index = agrees && cited.length === 1 ? indexes.get(cited[0]) : undefined
        const target = index === undefined ? row.unlinked : row.references
        const ref = { index, paper: paper.slice(0, 100), locator: locator.slice(0, 100) }
        if (target.length < 8 && !target.some(prior => prior.index === ref.index && prior.paper === ref.paper && prior.locator === ref.locator)) target.push(ref)
      }
    }
  }
  const ordered = [...rows.values()].map(row => ({ ...row, gaps: gaps.get(row.nodeKey)?.gaps || [] }))
  ordered.push(...[...gaps.values()].filter(row => !rows.has(row.nodeKey)))
  const findings = ordered.filter(row => row.statement.length >= 4 && row.references.length)
  const statements = new Set(findings.map(row => clampKnowledgeLabel(row.statement)))
  const nodes = [
    ...findings.map(row => ({ key: row.nodeKey, kind: 'finding', label: clampKnowledgeLabel(row.statement), excerpt: row.statement })),
    ...extracted.nodes.filter(node => node.kind !== 'finding' || !statements.has(node.label)),
  ].slice(0, MAX_NODES_PER_MESSAGE)
  return { ...extracted, nodes, rows: ordered }
}
