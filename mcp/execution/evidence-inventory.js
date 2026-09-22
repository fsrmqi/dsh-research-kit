
// 证据盘点的只读汇总：research_evidence_review 与 research_run_status 共用，
// 保证两个入口给出的 total / missing_traceability / unverified 口径一致。

import { listEvidence, readProjectEntries, writeProjectEntries, safeProjectName } from './evidence-store.js'
import { gradeEvidence, gradeLabel } from './evidence-grader.js'

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1
    return counts
  }, {})
}

// 只读盘点：不改写证据记录；建议分级来自规则引擎，返回 entries 与 summary 供调用方组装。
async function inventoryEvidence({ project, run_id, limit, offset } = {}) {
  const inventory = await listEvidence({ project, run_id, limit, offset })
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
    returned: inventory.returned,
    offset: inventory.offset,
    limit: inventory.limit,
    has_more: inventory.has_more,
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

// 受控来源线索写回：绝不自动应用。旧 grade 字段不再由规则引擎写入；
// 唯一可自动发现的是「没有来源线索」，写回目标是 traceability，而非证据强度。
async function applyEvidenceGrades({ project, run_id, evidence_ids, apply = false, limit = 200 } = {}) {
  const projectName = safeProjectName(project)
  const inventory = await listEvidence({ project: projectName, run_id, limit })
  const requested = new Set(Array.isArray(evidence_ids) ? evidence_ids.map(String) : [])
  const plan = []
  for (const entry of inventory.entries) {
    if (requested.size && !requested.has(String(entry.id))) continue
    const assessment = gradeEvidence(entry)
    // 无法自动判断强度时不生成写回计划，保留已有人工分级。
    if (assessment.grade === 'ungraded') continue
    const currentTraceability = entry.traceability || (entry.identifier || entry.url ? 'identified' : 'missing')
    if (currentTraceability === 'missing') continue
    plan.push({
      id: entry.id,
      title: entry.title,
      current_traceability: currentTraceability,
      suggested_traceability: 'missing',
      confidence: assessment.confidence,
      reasoning: assessment.reasoning,
    })
  }
  if (!apply) {
    return { project: projectName, apply: false, changed: 0, plan, preview_only: true }
  }
  const plannedIds = new Set(plan.map(item => item.id))
  const entries = await readProjectEntries(projectName)
  let changed = 0
  const applied = []
  const nextEntries = entries.map(entry => {
    if (!plannedIds.has(entry.id)) return entry
    const item = plan.find(candidate => candidate.id === entry.id)
    changed += 1
    applied.push({ id: entry.id, traceability: item.suggested_traceability })
    return { ...entry, traceability: item.suggested_traceability, traceability_checked_by: 'rule-engine-confirmed', traceability_checked_at: new Date().toISOString() }
  })
  if (changed) await writeProjectEntries(projectName, nextEntries)
  return { project: projectName, apply: true, changed, applied, skipped_confirmed: 0 }
}

export { inventoryEvidence, applyEvidenceGrades }
