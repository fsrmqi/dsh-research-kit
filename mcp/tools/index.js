
import { z } from 'zod/v3'
import { searchCatalog, itemById, composeWorkflow } from '../../src/catalog.js'
import { querySource, listAvailableSources } from '../execution/source-querier.js'
import { verifyCitation, detectIdentifierType } from '../execution/citation-verifier.js'
import { saveEvidence, listEvidence, linkEvidence } from '../execution/evidence-store.js'
import { gradeEvidence, gradeLabel } from '../execution/evidence-grader.js'
import { exportPassport, importPassport } from '../state/material-passport.js'
import { wrap, err } from '../execution/wrapper.js'

const tools = [
  {
    name: 'search_workflows',
    description: 'Search the catalog of 317+ research workflows by keyword, category, or tags. Returns workflow summaries with input schemas.',
    inputSchema: {
      query: z.string().optional().describe('Search keyword (matches name, description, tags, category, prompt text)'),
      category: z.string().optional().describe('Filter by category (e.g. 论文与手稿, 文献研究)'),
      type: z.enum(['all', 'workflow', 'skill', 'database']).default('workflow').describe('Filter by item type'),
      limit: z.number().int().min(1).max(50).default(10).describe('Max results'),
    },
    async execute({ query, category, type, limit }) {
      const results = searchCatalog({ query: query || '', type: type || 'workflow' })
      let filtered = results
      if (category) filtered = results.filter(item => item.category === category)
      const items = filtered.slice(0, limit).map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        category: item.category,
        tags: item.tags || [],
        tool_mode: item.tool_mode || 'guided',
        input_schema: item.input_schema || null,
        requires_files: item.requiresFiles || false,
      }))
      return wrap({ workflows: items, total: filtered.length }, { source: 'catalog/workflows', confidence: 'verified' })
    },
  },

  {
    name: 'compose_workflow',
    description: 'Fill in a workflow\'s parameters and generate the final prompt. Returns the composed prompt with missing params, limitations, and suggested skills/sources.',
    inputSchema: {
      workflow_id: z.string().describe('Workflow ID from search_workflows'),
      params: z.record(z.string()).optional().describe('Parameter key-value pairs to fill into the workflow template'),
      skill_ids: z.array(z.string()).optional().describe('Additional skill/guidance module IDs to attach'),
      source_ids: z.array(z.string()).optional().describe('Additional data source IDs to attach'),
    },
    async execute({ workflow_id, params, skill_ids, source_ids }) {
      const workflow = itemById(workflow_id)
      if (!workflow || workflow.type !== 'workflow') return err(`工作流 "${workflow_id}" 不存在。`)
      try {
        const result = composeWorkflow(workflow, params || {}, {
          enforceRequired: false,
          extraSkillIds: skill_ids || [],
          extraDatabaseIds: source_ids || [],
        })
        return wrap({
          prompt: result.prompt,
          missing_params: result.missing,
          limitations: workflow.limitations || [],
          suggested_skills: (workflow.suggestedSkillIds || []).map(id => ({ id, name: itemById(id)?.name || id })),
          suggested_sources: (workflow.suggestedDatabaseIds || []).map(id => ({ id, name: itemById(id)?.name || id })),
          agent_guidance: workflow.agent_guidance || null,
          checkpoints: workflow.checkpoints || [],
        }, { source: `catalog/workflows#${workflow_id}`, confidence: 'verified' })
      } catch (e) {
        return err(e.message)
      }
    },
  },

  {
    name: 'query_source',
    description: 'Query a scientific data source (Crossref, PubMed via EuropePMC, OpenAlex, Semantic Scholar, arXiv, ClinicalTrials.gov). Returns structured results with identifiers.',
    inputSchema: {
      source_id: z.string().describe('Data source ID (e.g. crossref, openalex, semantic-scholar, europe-pmc, arxiv, clinicaltrials)'),
      query: z.string().min(1).describe('Search query'),
      limit: z.number().int().min(1).max(10).default(5).describe('Max results'),
    },
    async execute({ source_id, query, limit }) {
      try {
        const result = await querySource(source_id, query, limit)
        return wrap(result, {
          source: `data-source:${source_id}`,
          confidence: result.cached ? 'cached' : 'api',
          disclaimer: '候选结果需回原文逐条核验；插件不伪造检索结果。',
        })
      } catch (e) {
        return err(`查询 ${source_id} 失败：${e.message}`)
      }
    },
  },

  {
    name: 'verify_citation',
    description: 'Verify a citation exists and optionally check if a claim is supported by the source. Supports DOI, PMID, arXiv ID.',
    inputSchema: {
      identifier: z.string().describe('DOI (10.xxxx/xxx), PMID (number), or arXiv ID (e.g. 2301.00001)'),
      claim: z.string().optional().describe('The claim to verify against the source. If provided, checks if the abstract supports this claim.'),
    },
    async execute({ identifier, claim }) {
      try {
        const result = await verifyCitation(identifier, claim)
        return wrap(result, {
          source: 'citation-verifier',
          confidence: result.claim_supported === undefined ? 'api' : 'api',
          disclaimer: claim ? 'claim 支持性判断基于摘要关键词匹配，不能替代全文核验。' : '存在性判断基于 Crossref/PubMed/arXiv API 实时查询。',
        })
      } catch (e) {
        return err(`验证失败：${e.message}`)
      }
    },
  },

  {
    name: 'save_evidence',
    description: 'Save an evidence entry (paper metadata + user note) to the evidence vault. Only saves metadata, never full text.',
    inputSchema: {
      identifier_type: z.enum(['doi', 'pmid', 'pmcid', 'nct', 'arxiv', 'url', 'none']).describe('Type of stable identifier'),
      identifier: z.string().optional().describe('The identifier value (e.g. DOI string)'),
      title: z.string().min(1).describe('Title of the evidence source'),
      url: z.string().optional().describe('URL link to the source'),
      note: z.string().optional().describe('Your note about this evidence'),
      project: z.string().optional().default('default').describe('Project name for organizing evidence'),
      grade_hint: z.enum(['empirical', 'inference', 'missing', 'ungraded']).optional().describe('Suggested evidence grade'),
    },
    async execute({ identifier_type, identifier, title, url, note, project, grade_hint }) {
      try {
        const result = await saveEvidence({ identifier_type, identifier, title, url, note, project, grade_hint })
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
    name: 'list_evidence',
    description: 'List saved evidence entries, filterable by project, identifier type, and grade.',
    inputSchema: {
      project: z.string().optional().describe('Filter by project name'),
      identifier_type: z.string().optional().describe('Filter by identifier type (doi, pmid, etc.)'),
      grade: z.enum(['empirical', 'inference', 'missing', 'ungraded']).optional().describe('Filter by evidence grade'),
      limit: z.number().int().min(1).max(200).default(50).describe('Max results'),
    },
    async execute({ project, identifier_type, grade, limit }) {
      try {
        const result = await listEvidence({ project, identifier_type, grade, limit })
        return wrap(result, { source: 'evidence-store', confidence: 'verified' })
      } catch (e) {
        return err(`检索失败：${e.message}`)
      }
    },
  },

  {
    name: 'grade_evidence',
    description: 'Grade an evidence entry as empirical, inference, or missing based on source reliability and content analysis.',
    inputSchema: {
      evidence_id: z.string().describe('Evidence entry ID from save_evidence'),
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
    name: 'export_passport',
    description: 'Export a Material Passport (cross-session research state snapshot) as YAML.',
    inputSchema: {
      project: z.string().optional().describe('Project name'),
      current_stage: z.string().describe('Current pipeline stage (e.g. literature_search, evidence_extraction, synthesis)'),
      completed: z.array(z.object({ stage: z.string(), tool: z.string(), summary: z.string() })).optional().describe('Completed steps'),
      pending: z.array(z.object({ stage: z.string(), tool: z.string().optional(), workflow_id: z.string().optional(), note: z.string().optional() })).optional().describe('Remaining steps'),
      constraints: z.array(z.string()).optional().describe('Research constraints to carry forward'),
      evidence_ids: z.array(z.string()).optional().describe('Evidence IDs referenced by this pipeline'),
    },
    async execute(input) {
      try {
        const result = await exportPassport(input)
        return wrap(result, { source: 'material-passport', confidence: 'verified' })
      } catch (e) {
        return err(`导出失败：${e.message}`)
      }
    },
  },

  {
    name: 'import_passport',
    description: 'Import a Material Passport to resume a multi-step research pipeline from a saved state.',
    inputSchema: {
      passport_yaml: z.string().describe('The YAML content of the Material Passport to import'),
    },
    async execute({ passport_yaml }) {
      try {
        const result = await importPassport(passport_yaml)
        return wrap(result, { source: 'material-passport', confidence: 'verified' })
      } catch (e) {
        return err(`导入失败：${e.message}`)
      }
    },
  },
]

export { tools }
