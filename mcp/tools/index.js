
import { z } from 'zod/v3'
import { searchCatalog, itemById, composeWorkflow } from '../../src/catalog.js'
import { querySource, listAvailableSources } from '../execution/source-querier.js'
import { verifyCitation, detectIdentifierType } from '../execution/citation-verifier.js'
import { saveEvidence, listEvidence, linkEvidence } from '../execution/evidence-store.js'
import { gradeEvidence, gradeLabel } from '../execution/evidence-grader.js'
import { exportPassport, importPassport } from '../state/material-passport.js'
import { evaluateCheckpoints, initializeCheckpoints, recordApproval, getCheckpointState } from '../state/checkpoint-manager.js'
import { generateFigure, listFigureStyles } from '../execution/figure-generator.js'
import { auditClaims } from '../execution/claim-auditor.js'
import { linkLiterature } from '../execution/literature-linker.js'
import { detectTextAnomalies } from '../execution/anomaly-detector.js'
import { checkWritingQuality } from '../execution/writing-quality.js'
import { generateDisclosureStatement, listDisclosurePolicies } from '../execution/disclosure-generator.js'
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
      workflow_id: z.string().optional().describe('Workflow ID; used to initialize required checkpoints'),
      current_stage: z.string().describe('Current pipeline stage (e.g. literature_search, evidence_extraction, synthesis)'),
      completed: z.array(z.object({ stage: z.string(), tool: z.string(), summary: z.string() })).optional().describe('Completed steps'),
      pending: z.array(z.object({ stage: z.string(), tool: z.string().optional(), workflow_id: z.string().optional(), note: z.string().optional() })).optional().describe('Remaining steps'),
      constraints: z.array(z.string()).optional().describe('Research constraints to carry forward'),
      evidence_ids: z.array(z.string()).optional().describe('Evidence IDs referenced by this pipeline'),
    },
    async execute(input) {
      try {
        const result = await exportPassport(input)
        if (input.workflow_id) {
          const workflow = itemById(input.workflow_id)
          if (!workflow || workflow.type !== 'workflow') return err(`工作流 "${input.workflow_id}" 不存在。`)
          const completedStages = (input.completed || []).map(step => step.stage)
          result.checkpoint_state = await initializeCheckpoints(result.run_id, workflow, completedStages)
        }
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

  {
    name: 'link_evidence',
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

  {
    name: 'generate_figure',
    description: 'Generate a publication-quality matplotlib script using a pre-built paper style. Returns the Python script to execute.',
    inputSchema: {
      style: z.string().describe('Style name (use list_figure_styles to see options)'),
      data: z.record(z.any()).describe('Data object: { categories, series, clusters, ... } depending on figure type'),
      title: z.string().optional().describe('Figure title'),
      xlabel: z.string().optional().describe('X-axis label'),
      ylabel: z.string().optional().describe('Y-axis label'),
      figsize: z.array(z.number()).length(2).optional().describe('Figure size [width, height] in inches'),
      dpi: z.number().int().optional().default(300).describe('Output DPI'),
      apa_style: z.boolean().optional().describe('Apply APA 7.0 formatting: colorblind-safe Okabe-Ito palette, sans-serif fonts, APA font sizes'),
    },
    async execute({ style, data, title, xlabel, ylabel, figsize, dpi, apa_style }) {
      return generateFigure(style, data, { title, xlabel, ylabel, figsize, dpi, apa_style })
    },
  },

  {
    name: 'list_figure_styles',
    description: 'List all available paper figure styles with their type and color palettes.',
    inputSchema: {},
    async execute() {
      const styles = listFigureStyles()
      return wrap({ styles }, { source: 'figure-styles', confidence: 'verified' })
    },
  },

  {
    name: 'checkpoint_status',
    description: 'Get the checkpoint state for a research pipeline run.',
    inputSchema: {
      run_id: z.string().describe('Run ID from export_passport'),
    },
    async execute({ run_id }) {
      const state = await getCheckpointState(run_id)
      return wrap(state, { source: 'checkpoint-manager', confidence: 'verified' })
    },
  },

  {
    name: 'approve_checkpoint',
    description: 'Approve a checkpoint to allow the agent to continue to the next stage.',
    inputSchema: {
      run_id: z.string().describe('Run ID'),
      stage: z.string().describe('Stage name to approve'),
      note: z.string().optional().describe('Optional note about the approval'),
    },
    async execute({ run_id, stage, note }) {
      try {
        const result = await recordApproval(run_id, stage, { approved_by: 'user', note })
        return wrap(result, { source: 'checkpoint-manager', confidence: 'verified' })
      } catch (e) {
        return err(e.message)
      }
    },
  },

  {
    name: 'claim_audit',
    description: 'Audit all claims with citations (DOI/PMID/arXiv) in a text. Verifies each citation exists and whether the abstract supports the claim.',
    inputSchema: {
      text: z.string().min(20).describe('The text to audit (paper draft, review, etc.)'),
      max_claims: z.number().int().min(1).max(50).optional().default(20).describe('Max claims to audit'),
    },
    async execute({ text, max_claims }) {
      return auditClaims(text, { max_claims })
    },
  },

  {
    name: 'link_literature',
    description: 'Discover citation relationships between saved evidence entries using the OpenAlex reference graph.',
    inputSchema: {
      project: z.string().optional().describe('Project name'),
      max_lookups: z.number().int().min(1).max(20).optional().default(10).describe('Max DOI lookups'),
    },
    async execute({ project, max_lookups }) {
      try {
        return await linkLiterature({ project, max_lookups })
      } catch (e) {
        return err(`文献互引分析失败：${e.message}`)
      }
    },
  },

  {
    name: 'anomaly_detect',
    description: 'Detect textual anomalies: redundant patterns, contradictions, silence zones (missing elements like limitations or sample size). Based on literature-review methodology.',
    inputSchema: {
      text: z.string().min(50).describe('The text to analyze (paper draft, review, abstract, etc.)'),
    },
    async execute({ text }) {
      return detectTextAnomalies(text)
    },
  },

  {
    name: 'check_writing_quality',
    description: 'Check academic writing quality: flagged terms, throat-clearing openers, punctuation patterns, sentence length. Not a humanizer.',
    inputSchema: {
      text: z.string().min(100).describe('The text to check (paper draft, section, paragraph)'),
    },
    async execute({ text }) {
      return checkWritingQuality(text)
    },
  },

  {
    name: 'generate_disclosure',
    description: 'Generate a venue-specific AI use disclosure statement. Supports 15 journal/conference policies (Nature, ICLR, ACL, Science, NEJM, etc.).',
    inputSchema: {
      target_journal: z.string().describe('Target journal or conference name'),
      ai_use_description: z.string().describe('What AI was used for (e.g. "literature search and language editing")'),
      tool_name: z.string().optional().describe('Name of the AI tool used (e.g. "ChatGPT-4")'),
    },
    async execute({ target_journal, ai_use_description, tool_name }) {
      return generateDisclosureStatement({ target_journal, ai_use_description, tool_name })
    },
  },

  {
    name: 'list_disclosure_policies',
    description: 'List all supported journal/conference AI disclosure policies with their placement requirements.',
    inputSchema: {},
    async execute() {
      const policies = listDisclosurePolicies()
      return wrap({ policies }, { source: 'disclosure-generator', confidence: 'verified' })
    },
  },
]

export { tools }
