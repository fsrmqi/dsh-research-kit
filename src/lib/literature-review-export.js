import { latestResearchScreening } from './research-ledger.js'
import { serializeBibliography } from './bibliography.js'

export function buildLiteratureReviewExport({ project, entries, claims, ledger, exportedAt = Date.now() }) {
  const decisions = latestResearchScreening(ledger)
  const candidates = entries.map(entry => {
    const { id, title, identifier, identifierKind, url, status, bibliography } = entry
    return {
      id, title, identifier, identifierKind, url, status, bibliography,
      screening: decisions.get(id) || { decision: 'pending', reason: '尚未筛选' },
    }
  })
  const ids = new Set(candidates.map(item => item.id))
  const summary = { candidates: candidates.length, included: 0, excluded: 0, pending: 0 }
  const excludedReasons = new Map()
  for (const candidate of candidates) {
    const { decision, reason } = candidate.screening
    if (decision === 'include') summary.included++
    else if (decision === 'exclude') {
      summary.excluded++
      excludedReasons.set(reason, (excludedReasons.get(reason) || 0) + 1)
    } else summary.pending++
  }
  return {
    kind: 'dsh-literature-review', version: 1, project, exportedAt,
    scope: '当前项目的本地候选集与文件论断台账',
    summary, excludedReasons: Object.fromEntries(excludedReasons), candidates,
    searches: ledger.filter(event => event.kind === 'search'),
    claims: claims.map(claim => ({
      id: claim.id, statement: claim.statement, question: claim.question, state: claim.state,
      runId: claim.run_id, version: claim.version, assessedBy: claim.assessed_by, reason: claim.assessment_reason,
      links: (claim.links || []).map(link => ({ ...link, sourceAvailable: ids.has(link.evidenceId) })),
    })),
    bibtex: serializeBibliography(entries.filter(entry => decisions.get(entry.id)?.decision === 'include'), 'bibtex'),
  }
}
