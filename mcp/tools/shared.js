import { detectIdentifierType } from '../execution/citation-verifier.js'
import { stableIdentifier } from '../execution/identifiers.js'

export const EVIDENCE_FIELDS = [
  'id', 'title', 'identifier_type', 'identifier', 'url', 'status', 'grade',
  'saved_at', 'run_id', 'note', 'project', 'source', 'linked_assets',
  'graded_by', 'graded_at',
  'traceability', 'source_verification', 'study_type', 'claim_support', 'strength',
  'assessed_by', 'assessed_at', 'assessment_reason',
]

export const INVENTORY_FIELDS = [
  'id', 'title', 'identifier_type', 'identifier', 'url', 'status', 'stored_grade',
  'suggested_grade', 'suggested_grade_label', 'confidence', 'reasoning', 'saved_at',
]

function projectFields(item, fields) {
  return Object.fromEntries(fields.map(field => [field, item[field]]))
}

export function evidenceProjection(entry, { mode, fields } = {}) {
  if (Array.isArray(fields) && fields.length) return projectFields(entry, fields)
  if (mode === 'full') return entry
  const { id, title, identifier_type, identifier, url, status, grade, saved_at, run_id } = entry
  return { id, title, identifier_type, identifier, url, status, grade, saved_at, run_id }
}

export function inventoryProjection(entry, { mode, fields } = {}) {
  if (Array.isArray(fields) && fields.length) return projectFields(entry, fields)
  if (mode === 'full') return entry
  const { id, title, identifier_type, identifier, url, status, stored_grade, suggested_grade, suggested_grade_label } = entry
  return { id, title, identifier_type, identifier, url, status, stored_grade, suggested_grade, suggested_grade_label }
}

function sourceIdentity(source) {
  const stable = stableIdentifier(source?.id, source?.url)
  if (stable) return stable.key
  const url = String(source?.url || '').trim().replace(/\/$/, '').toLowerCase()
  if (url) return `url:${url}`
  return `title:${String(source?.title || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 180)}`
}

export function mergeLiteratureResults(results) {
  const merged = new Map()
  for (const { sourceId, result } of results) {
    for (const item of result.sources || []) {
      const key = sourceIdentity(item)
      const stable = stableIdentifier(item.id, item.url)
      const existing = merged.get(key)
      if (existing) {
        existing.found_in = [...new Set([...existing.found_in, sourceId])]
        continue
      }
      merged.set(key, {
        ...item,
        id: stable?.value || item.id,
        found_in: [sourceId],
        identifier_type: stable?.type || detectIdentifierType(item.id) || 'none',
      })
    }
  }
  return [...merged.values()]
}
