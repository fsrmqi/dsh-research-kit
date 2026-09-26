// 论断与来源之间是逐边评估：同一论文可支持一个论断、反驳另一个论断。
import { workspaceIdForProject } from './research-workspaces.js'
export const RESEARCH_EVIDENCE_STANCES = ['unassessed', 'supports', 'refutes', 'insufficient']

const short = (value, max) => String(value || '').trim().slice(0, max)

export function normalizeResearchClaim(input = {}, now = Date.now()) {
  const statement = short(input.statement, 500)
  if (!statement) throw new Error('研究论断不能为空。')
  const links = [...new Map((Array.isArray(input.links) ? input.links : []).map(item => {
    const evidenceId = short(item?.evidenceId, 120)
    if (!evidenceId) return ['', null]
    return [evidenceId, {
      evidenceId,
      stance: RESEARCH_EVIDENCE_STANCES.includes(item.stance) ? item.stance : 'unassessed',
      locator: short(item.locator, 240),
      studyDesign: short(item.studyDesign, 240),
      sample: short(item.sample, 240),
      result: short(item.result, 500),
      limitations: short(item.limitations, 500),
      assessedBy: short(item.assessedBy, 120),
      assessedAt: Number(item.assessedAt) || 0,
    }]
  }).filter(([id]) => id))].map(([, item]) => item).slice(0, 50)
  if (links.some(item => ['supports', 'refutes'].includes(item.stance) && (!item.locator || !item.assessedBy))) {
    throw new Error('判断支持或反驳时，必须填写来源位置并注明评估者。')
  }
  return {
    id: short(input.id, 120) || `research-claim-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    project: short(input.project, 120),
    workspaceId: workspaceIdForProject(short(input.project, 120)),
    question: short(input.question, 500),
    statement,
    links,
    createdAt: Number(input.createdAt) || now,
    updatedAt: now,
  }
}
