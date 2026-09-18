
// 证据盘点的只读汇总：research_evidence_review 与 research_run_status 共用，
// 保证两个入口给出的 total / missing_traceability / unverified 口径一致。

import { listEvidence } from './evidence-store.js'
import { gradeEvidence, gradeLabel } from './evidence-grader.js'

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1
    return counts
  }, {})
}

// 只读盘点：不改写证据记录；建议分级来自规则引擎，返回 entries 与 summary 供调用方组装。
async function inventoryEvidence({ project, run_id, limit } = {}) {
  const inventory = await listEvidence({ project, run_id, limit })
  const entries = inventory.entries.map(entry => {
    const assessment = gradeEvidence(entry)
    return {
      id: entry.id,
      title: entry.title,
      identifier_type: entry.identifier_type,
      identifier: entry.identifier,
      url: entry.url,
      status: entry.status || 'unverified',
      stored_grade: entry.grade || 'ungraded',
      suggested_grade: assessment.grade,
      suggested_grade_label: gradeLabel(assessment.grade),
      confidence: assessment.confidence,
      reasoning: assessment.reasoning,
      saved_at: entry.saved_at,
    }
  })
  const missing = entries.filter(entry => entry.suggested_grade === 'missing')
  const unverified = entries.filter(entry => entry.status !== 'verified')
  return {
    project: inventory.project,
    total: inventory.total,
    entries,
    summary: {
      total: inventory.total,
      returned: entries.length,
      stored_grades: countBy(entries.map(entry => entry.stored_grade)),
      suggested_grades: countBy(entries.map(entry => entry.suggested_grade)),
      missing_traceability: missing.length,
      unverified: unverified.length,
    },
    missing,
    unverified,
  }
}

export { inventoryEvidence }
