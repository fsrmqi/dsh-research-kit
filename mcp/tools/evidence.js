import { z } from 'zod/v3'
import { assessEvidence, linkEvidence, listEvidence, saveEvidence, saveEvidenceBatch } from '../execution/evidence-store.js'
import { gradeEvidence, gradeLabel } from '../execution/evidence-grader.js'
import { applyEvidenceGrades, inventoryEvidence } from '../execution/evidence-inventory.js'
import { contract } from '../execution/contract.js'
import { err, wrap } from '../execution/wrapper.js'
import { EVIDENCE_FIELDS, INVENTORY_FIELDS, evidenceProjection, inventoryProjection } from './shared.js'

export const evidenceTools = [
  {
    name: 'research_evidence_save',
    description: 'Save an evidence entry (paper metadata + user note) to the evidence vault. Only saves metadata, never full text.',
    inputSchema: {
      identifier_type: z.enum(['doi', 'pmid', 'pmcid', 'nct', 'arxiv', 'url', 'none']).describe('Type of stable identifier'),
      identifier: z.string().optional().describe('The identifier value (e.g. DOI string)'),
      title: z.string().min(1).describe('Title of the evidence source'),
      url: z.string().optional().describe('URL link to the source'),
      note: z.string().optional().describe('Your note about this evidence'),
      project: z.string().optional().default('default').describe('Project name for organizing evidence'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID; links this evidence to a run without changing deduplication.'),
      grade_hint: z.enum(['empirical', 'inference', 'missing', 'ungraded']).optional().describe('Suggested evidence grade'),
    },
    async execute({ identifier_type, identifier, title, url, note, project, run_id, grade_hint }) {
      try {
        const result = await saveEvidence({ identifier_type, identifier, title, url, note, project, run_id, grade_hint })
        return wrap(result, {
          source: 'evidence-store',
          confidence: 'verified',
          disclaimer: '证据条目保存为「未核验」状态；分级为建议值，需人工确认。',
        })
      } catch (e) {
        return err(`保存失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_evidence_list',
    description: 'List saved evidence entries, filterable by project, identifier type, and grade.',
    inputSchema: {
      project: z.string().optional().describe('Filter by project name'),
      identifier_type: z.string().optional().describe('Filter by identifier type (doi, pmid, etc.)'),
      grade: z.enum(['empirical', 'inference', 'missing', 'ungraded']).optional().describe('Filter by evidence grade'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Filter evidence linked to one research run.'),
      limit: z.number().int().min(1).max(200).default(50).describe('Max results'),
      offset: z.number().int().min(0).max(100_000).optional().default(0).describe('Zero-based page offset, sorted by newest evidence first'),
      mode: z.enum(['summary', 'full']).optional().default('summary').describe('summary keeps responses compact; full returns every stored field'),
      fields: z.array(z.enum(EVIDENCE_FIELDS)).max(EVIDENCE_FIELDS.length).optional().describe('Return only selected fields; overrides mode'),
    },
    async execute({ project, identifier_type, grade, run_id, limit, offset, mode, fields }) {
      try {
        const result = await listEvidence({ project, identifier_type, grade, run_id, limit, offset })
        return wrap({
          ...result,
          entries: result.entries.map(entry => evidenceProjection(entry, { mode, fields })),
          output_mode: Array.isArray(fields) && fields.length ? 'fields' : mode,
          ...(Array.isArray(fields) && fields.length ? { fields } : {}),
        }, { source: 'evidence-store', confidence: 'verified' })
      } catch (e) {
        return err(`检索失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_evidence_grade',
    description: '检查证据是否提供来源线索：缺少标识符及链接时返回 missing，否则返回 ungraded；实证或推论等级需人工核验原文。',
    inputSchema: {
      evidence_id: z.string().describe('Evidence entry ID from research_evidence_save'),
      project: z.string().optional().describe('Project name'),
    },
    async execute({ evidence_id, project }) {
      try {
        const { entries } = await listEvidence({ project })
        const entry = entries.find(e => e.id === evidence_id)
        if (!entry) return err(`证据条目 "${evidence_id}" 不存在。`)
        const assessment = gradeEvidence(entry)
        return wrap({
          evidence_id,
          grade: assessment.grade,
          grade_label: gradeLabel(assessment.grade),
          confidence: assessment.confidence,
          reasoning: assessment.reasoning,
        }, {
          source: 'evidence-grader',
          confidence: 'cached',
          disclaimer: '分级基于规则引擎自动判定，为建议值，需人工确认。',
        })
      } catch (e) {
        return err(`分级失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_evidence_assess',
    description: '人工记录证据的来源可追溯性、来源核验状态、研究类型、声明支持程度与证据强度；不会从标识符或关键词自动推断。',
    inputSchema: {
      evidence_id: z.string().describe('Evidence entry ID from research_evidence_save'),
      project: z.string().optional().default('default').describe('Project name'),
      traceability: z.enum(['missing', 'identified']).optional().describe('Whether a traceable identifier or URL is available'),
      source_verification: z.enum(['unverified', 'verified', 'disputed', 'stale']).optional().describe('Manual source verification status'),
      study_type: z.enum(['unknown', 'primary-study', 'systematic-review', 'protocol', 'preprint', 'dataset', 'other']).optional().describe('Manual study type'),
      claim_support: z.enum(['unassessed', 'supported', 'not-supported', 'mixed', 'not-applicable']).optional().describe('Manual assessment of one stated claim'),
      strength: z.enum(['ungraded', 'empirical', 'inference']).optional().describe('Manual evidence-strength classification'),
      assessed_by: z.string().max(120).optional().describe('Reviewer name or role'),
      assessment_reason: z.string().max(500).optional().describe('Brief basis for the manual assessment'),
    },
    async execute({ evidence_id, project, ...assessment }) {
      try {
        const entry = await assessEvidence(evidence_id, project, assessment)
        return wrap({ evidence_id, entry }, {
          source: 'evidence-assessment', confidence: 'verified',
          disclaimer: '这是人工记录，不代表工具已核验全文或替研究者作出科学结论。',
        })
      } catch (e) { return err(`人工评估失败：${e.message}`) }
    },
  },

  {
    name: 'research_evidence_review',
    description: 'Review the evidence inventory for a project or run in one read-only pass. Summarizes stored grades, proposes rule-based grades, and identifies entries with missing traceability or unverified status. Does not modify evidence records.',
    inputSchema: {
      project: z.string().optional().default('default').describe('Project name to review'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID to review only evidence linked to that run.'),
      limit: z.number().int().min(1).max(200).optional().default(100).describe('Maximum evidence entries to include in the review'),
      offset: z.number().int().min(0).max(100_000).optional().default(0).describe('Zero-based page offset, sorted by newest evidence first'),
      mode: z.enum(['summary', 'full']).optional().default('summary').describe('summary keeps responses compact; full includes grading reasoning and timestamps'),
      fields: z.array(z.enum(INVENTORY_FIELDS)).max(INVENTORY_FIELDS.length).optional().describe('Return only selected fields; overrides mode'),
    },
    async execute({ project, run_id, limit, offset, mode, fields }) {
      try {
        const inventory = await inventoryEvidence({ project, run_id, limit, offset })
        const { entries, summary, missing, unverified } = inventory
        return contract({
          project: inventory.project,
          entries: entries.map(entry => inventoryProjection(entry, { mode, fields })),
          pagination: {
            offset: inventory.offset,
            limit: inventory.limit,
            returned: inventory.returned,
            total: inventory.total,
            has_more: inventory.has_more,
          },
          output_mode: Array.isArray(fields) && fields.length ? 'fields' : mode,
          ...(Array.isArray(fields) && fields.length ? { fields } : {}),
          next_actions: [
            ...(missing.length ? [`补齐 ${missing.length} 条缺少稳定标识符或链接的证据来源。`] : []),
            ...(unverified.length ? [`人工核验 ${unverified.length} 条尚未核验的证据；自动建议不等同于确认。`] : []),
            ...(!entries.length ? ['当前范围没有证据条目；先使用 research_literature_search 或 research_evidence_save 添加可追溯来源。'] : []),
            ...(inventory.has_more ? [`还有 ${inventory.total - (inventory.offset + inventory.returned)} 条未显示；用 offset=${inventory.offset + inventory.returned} 继续盘点。`] : []),
            ...(unverified.length ? ['如需按建议分级写回证据库，使用 research_evidence_grade_apply（preview=true 预览，显式确认后应用）。'] : []),
          ],
        }, {
          source: 'evidence-review',
          confidence: 'cached',
          disclaimer: '建议分级来自规则引擎且未写回证据库；研究者需核验原文与证据质量。',
          summary,
          run_id,
          warnings: [
            ...(missing.length ? [`${missing.length} 条证据无法追溯原文。`] : []),
          ],
        })
      } catch (e) {
        return err(`证据盘点失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_evidence_save_batch',
    description: 'Explicitly save multiple selected literature candidates as evidence entries in one call (metadata only, all marked unverified). Use after research_literature_search to persist only the candidates a human or agent has chosen; never saves automatically.',
    inputSchema: {
      entries: z.array(z.object({
        identifier_type: z.enum(['doi', 'pmid', 'pmcid', 'nct', 'arxiv', 'url', 'none']).optional().describe('Type of stable identifier'),
        identifier: z.string().optional().describe('Identifier value (e.g. DOI string)'),
        title: z.string().optional().describe('Title of the source'),
        url: z.string().optional().describe('URL link to the source'),
        note: z.string().optional().describe('Optional note about this candidate'),
        grade_hint: z.enum(['empirical', 'inference', 'missing', 'ungraded']).optional().describe('Suggested grade'),
      })).min(1).max(50).describe('Selected candidates to save (from research_literature_search sources)'),
      project: z.string().optional().default('default').describe('Project name for organizing evidence'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID to link all saved entries to'),
    },
    async execute({ entries, project, run_id }) {
      try {
        const result = await saveEvidenceBatch(entries, { project, run_id })
        return contract(result, {
          source: 'evidence-store',
          confidence: 'verified',
          disclaimer: '批量保存的条目全部为「未核验」状态；来源可靠性与纳入标准仍需人工逐条确认。',
          run_id,
          summary: {
            requested: result.requested,
            saved: result.saved.length,
            duplicates: result.duplicates.length,
            invalid: result.invalid.length,
          },
          next_actions: [
            ...(result.saved.length ? ['使用 research_evidence_review 盘点本次保存的证据缺口与未核验项。'] : []),
            ...(result.duplicates.length ? [`${result.duplicates.length} 条候选与已有证据重复，已跳过；如需补充信息请用 research_evidence_save 更新单条。`] : []),
            ...(result.invalid.length ? [`${result.invalid.length} 条候选缺少 title 与 identifier，未保存；请补齐后重试。`] : []),
            ...(!result.saved.length && !result.duplicates.length ? ['没有可保存的候选；先通过 research_literature_search 获取来源。'] : []),
          ],
          warnings: [
            ...(result.invalid.length ? [`${result.invalid.length} 条候选格式不合法被拒绝。`] : []),
          ],
        })
      } catch (e) {
        return err(`批量保存失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_evidence_grade_apply',
    description: '在预览与确认后写入规则发现的来源线索缺失；不会自动写入证据强度或声明支持程度。',
    inputSchema: {
      project: z.string().optional().default('default').describe('Project name'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID to scope the plan'),
      evidence_ids: z.array(z.string()).max(200).optional().describe('Explicit evidence entry IDs to process; omit to preview all differing entries in scope'),
      apply: z.boolean().optional().default(false).describe('Set true only after the preview has been reviewed and confirmed by a human'),
      limit: z.number().int().min(1).max(200).optional().default(200).describe('Max evidence entries scanned for the plan'),
    },
    async execute({ project, run_id, evidence_ids, apply, limit }) {
      try {
        const result = await applyEvidenceGrades({ project, run_id, evidence_ids, apply, limit })
        return contract(result, {
          source: 'evidence-inventory',
          confidence: apply ? 'verified' : 'cached',
          disclaimer: apply
            ? '写回仅更新来源可追溯性；证据强度与声明支持程度必须由人工评估。'
            : '当前为预览模式，未写入任何数据；确认后需以 apply=true 再次调用才会写回。',
          run_id,
          summary: {
            apply: Boolean(result.apply),
            changed: result.changed,
            planned: result.plan?.length ?? 0,
          },
          next_actions: apply
            ? ['来源线索状态已写回；使用 research_evidence_review 复核最新盘点结果。']
            : (result.plan?.length
                ? ['人工核对上方计划后，以 apply=true 与相同的 evidence_ids 再次调用才会写回来源线索状态。', '预览不会修改任何条目；可以直接放弃。']
                : ['当前范围内没有可自动应用的来源线索建议；证据强度与声明支持程度需人工核验。']),
          warnings: apply ? [] : ['本次调用是预览：未写回任何分级。'],
        })
      } catch (e) {
        return err(`分级应用失败：${e.message}`)
      }
    },
  },
]

export const evidenceLinkTools = [
  {
    name: 'research_evidence_link',
    description: 'Link an evidence entry to a research asset for traceability.',
    inputSchema: {
      evidence_id: z.string().describe('Evidence entry ID'),
      asset_id: z.string().describe('Research asset ID to link'),
      project: z.string().optional().describe('Project name'),
    },
    async execute({ evidence_id, asset_id, project }) {
      try {
        const result = await linkEvidence(evidence_id, asset_id, project)
        return wrap(result, { source: 'evidence-store', confidence: 'verified' })
      } catch (e) {
        return err(`关联失败：${e.message}`)
      }
    },
  },
]
