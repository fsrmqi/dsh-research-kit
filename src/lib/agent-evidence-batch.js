import {
  EVIDENCE_TRACEABILITY, EVIDENCE_STUDY_TYPES, EVIDENCE_CLAIM_SUPPORT, EVIDENCE_STRENGTHS,
} from './evidence-vault-core.js'

const AGENT_MARKER = /^(agent|model)(?::|\/|$)/i
export const AGENT_ASSESSMENT_BATCH_SIZE = 6

// 人工核验与 Agent 判断是两条独立记录；旧数据若缺 assessedBy，也按状态和时间保守识别。
export function isHumanAssessedEvidence(entry) {
  if (!entry || typeof entry !== 'object') return false
  if (entry.status && entry.status !== 'unverified') return true
  const by = String(entry.assessedBy || '').trim()
  if (by && !AGENT_MARKER.test(by)) return true
  return !by && (Number(entry.assessedAt) > 0 || Boolean(String(entry.assessmentReason || '').trim()))
}

export function planAgentEvidenceBatch(entries, { includeHuman = false } = {}) {
  const rows = Array.isArray(entries) ? entries : []
  const eligible = rows.filter(entry => entry?.id && (includeHuman || !isHumanAssessedEvidence(entry)))
  return {
    eligible,
    skippedHuman: includeHuman ? 0 : rows.filter(isHumanAssessedEvidence).length,
    batches: Array.from({ length: Math.ceil(eligible.length / AGENT_ASSESSMENT_BATCH_SIZE) }, (_, index) =>
      eligible.slice(index * AGENT_ASSESSMENT_BATCH_SIZE, (index + 1) * AGENT_ASSESSMENT_BATCH_SIZE)),
  }
}

// 从发起请求到落库期间，人工/其他标签页可能更新条目。只接受仍等于当时快照的结果。
export function evidenceAssessmentFingerprint(entry) {
  return JSON.stringify([
    entry?.title, entry?.identifier, entry?.url, entry?.reason, entry?.note,
    entry?.status, entry?.traceability, entry?.studyType, entry?.claimSupport,
    entry?.strength, entry?.assessedAt, entry?.assessedBy, entry?.assessmentReason,
    entry?.agentAssessment?.at,
  ])
}

export function normalizeAgentEvidenceResult(input, expectedIds, { model = '', at = Date.now() } = {}) {
  const expected = new Set(expectedIds)
  const rows = input?.assessments
  if (!Array.isArray(rows) || rows.length !== expected.size) throw new Error('Agent 返回的条目数量与请求不一致。')
  const seen = new Set()
  return rows.map(row => {
    const id = String(row?.id || '')
    if (!expected.has(id) || seen.has(id)) throw new Error('Agent 返回了未知或重复的证据 ID。')
    seen.add(id)
    if (!EVIDENCE_TRACEABILITY.includes(row.traceability)
      || !EVIDENCE_STUDY_TYPES.includes(row.studyType)
      || !EVIDENCE_CLAIM_SUPPORT.includes(row.claimSupport)
      || !EVIDENCE_STRENGTHS.includes(row.strength)) throw new Error(`Agent 对 ${id} 的判断字段不合法。`)
    const reason = String(row.reason || '').trim().slice(0, 500)
    if (!reason) throw new Error(`Agent 对 ${id} 未提供判断依据。`)
    return {
      id, traceability: row.traceability, studyType: row.studyType,
      claimSupport: row.claimSupport, strength: row.strength, reason,
      confidence: ['low', 'medium', 'high'].includes(row.confidence) ? row.confidence : 'low',
      model: String(model).slice(0, 120), at: Number(at) || Date.now(),
    }
  })
}
