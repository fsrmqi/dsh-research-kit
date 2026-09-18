
import { z } from 'zod/v3'
import { searchCatalog, itemById, composeWorkflow } from '../../src/catalog.js'
import { querySource, listAvailableSources } from '../execution/source-querier.js'
import { verifyCitation, detectIdentifierType } from '../execution/citation-verifier.js'
import { saveEvidence, saveEvidenceBatch, listEvidence, linkEvidence } from '../execution/evidence-store.js'
import { gradeEvidence, gradeLabel } from '../execution/evidence-grader.js'
import { exportPassport, importPassport, loadPassport } from '../state/material-passport.js'
import { listRecentRuns, buildRunOverview } from '../state/run-overview.js'
import { inventoryEvidence, applyEvidenceGrades } from '../execution/evidence-inventory.js'
import { readCallLogs } from '../execution/call-logger.js'
import { evaluateCheckpoints, initializeCheckpoints, recordApproval, getCheckpointState } from '../state/checkpoint-manager.js'
import { generateFigure, listFigureStyles } from '../execution/figure-generator.js'
import { auditClaims } from '../execution/claim-auditor.js'
import { linkLiterature } from '../execution/literature-linker.js'
import { detectTextAnomalies } from '../execution/anomaly-detector.js'
import { checkWritingQuality } from '../execution/writing-quality.js'
import { generateDisclosureStatement, listDisclosurePolicies } from '../execution/disclosure-generator.js'
import { checkHedgingPhrases } from '../execution/hedging-phrases.js'
import { fetchOpenAlexMetadata } from '../execution/openalex-fetcher.js'
import { wrap, err } from '../execution/wrapper.js'
import { contract } from '../execution/contract.js'

function sourceIdentity(source) {
  const identifier = String(source?.id || '').trim()
  const identifierType = detectIdentifierType(identifier)
  if (identifierType) return `${identifierType}:${identifier.toLowerCase()}`
  const url = String(source?.url || '').trim().replace(/\/$/, '').toLowerCase()
  if (url) return `url:${url}`
  return `title:${String(source?.title || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 180)}`
}

function mergeLiteratureResults(results) {
  const merged = new Map()
  for (const { sourceId, result } of results) {
    for (const item of result.sources || []) {
      const key = sourceIdentity(item)
      const existing = merged.get(key)
      if (existing) {
        existing.found_in = [...new Set([...existing.found_in, sourceId])]
        continue
      }
      merged.set(key, { ...item, found_in: [sourceId], identifier_type: detectIdentifierType(item.id) || 'none' })
    }
  }
  return [...merged.values()]
}

const DISCOVERY_ROUTES = [
  {
    id: 'start', label: '启动研究运行', keywords: ['启动', '开始', '项目', '运行', 'run'],
    chain: [
      ['research_catalog_search', '按研究目标查找工作流。'],
      ['research_workflow_compose', '补齐工作流参数并生成可执行 Prompt。'],
      ['research_run_start', '创建可追溯 run、状态护照和人工检查点。'],
    ],
  },
  {
    id: 'literature', label: '发现与检索文献', keywords: ['文献', '检索', '论文', 'doi', '引用', '来源', '保存'],
    chain: [
      ['research_literature_search', '默认多源检索、去重；核验和保存均须显式开启。'],
      ['research_evidence_save_batch', '人工挑选候选后批量显式保存。'],
      ['research_evidence_review', '盘点已保存证据的可追溯性与建议分级。'],
    ],
  },
  {
    id: 'evidence', label: '管理和盘点证据', keywords: ['证据', '分级', '证据库', '追溯'],
    chain: [
      ['research_evidence_review', '只读盘点证据缺口和未核验项。'],
      ['research_evidence_list', '检索已保存的证据条目。'],
      ['research_evidence_save', '仅在确认需要时保存单条来源元数据。'],
      ['research_evidence_grade', '针对单条证据作细粒度建议分级。'],
      ['research_evidence_grade_apply', '预览→确认两段式把建议分级写回；绝不自动应用。'],
    ],
  },
  {
    id: 'review', label: '审阅研究草稿', keywords: ['审阅', '润色', '写作', '草稿', 'claim', '声明'],
    chain: [
      ['research_review_output', '默认聚合引用声明、异常、写作和限制语检查。'],
      ['research_review_claims', '只深挖引用声明对齐时使用。'],
      ['research_review_anomalies', '只深挖冗余、矛盾与缺失要素时使用。'],
      ['research_review_writing', '只深挖写作质量问题时使用。'],
    ],
  },
  {
    id: 'figure', label: '生成论文图表', keywords: ['图表', '作图', '绘图', '可视化', 'figure'],
    chain: [
      ['research_figure_list_styles', '先查看可用的论文图表风格。'],
      ['research_figure_generate', '生成可执行的 matplotlib 脚本。'],
    ],
  },
  {
    id: 'disclosure', label: '处理 AI 使用披露', keywords: ['披露', '合规', '期刊', '会议', 'ai 使用'],
    chain: [
      ['research_disclosure_list_policies', '确认目标期刊或会议的披露规则。'],
      ['research_disclosure_generate', '按具体政策生成披露声明草案。'],
    ],
  },
  {
    id: 'resume', label: '恢复或推进研究运行', keywords: ['恢复', '继续', '检查点', 'checkpoint', '护照', '状态'],
    chain: [
      ['research_run_status', '先看运行总览：阶段、检查点、证据盘点与推荐下一步。'],
      ['research_run_import', '从已有 Material Passport 恢复上下文。'],
      ['research_run_checkpoint_status', '读取当前待审批的人工闸门。'],
      ['research_run_checkpoint_approve', '仅在人工确认后放行指定阶段。'],
      ['research_run_export', '交接前导出可追溯的状态快照。'],
    ],
  },
]

function discoverRoute(goal, routeId) {
  if (routeId && routeId !== 'auto') return DISCOVERY_ROUTES.find(route => route.id === routeId) || null
  const text = String(goal || '').toLowerCase()
  return DISCOVERY_ROUTES.find(route => route.keywords.some(keyword => text.includes(keyword))) || null
}

const tools = [
  {
    name: 'research_help',
    description: 'Discover the right Research Kit MCP tools for a goal. Returns a short recommended call chain and explains when to use lower-level tools. This tool is read-only and performs no research action.',
    inputSchema: {
      goal: z.string().max(500).optional().describe('Plain-language research goal, for example “帮我找文献” or “审阅这篇草稿”'),
      route: z.enum(['auto', 'start', 'literature', 'evidence', 'review', 'figure', 'disclosure', 'resume']).optional().default('auto').describe('Optional explicit task route; auto infers it from goal.'),
      include_all_routes: z.boolean().optional().default(false).describe('Include the complete route directory instead of only the best match.'),
    },
    async execute({ goal, route, include_all_routes }) {
      const selected = discoverRoute(goal, route)
      const serialize = item => ({
        id: item.id,
        label: item.label,
        recommended_chain: item.chain.map(([tool, reason], index) => ({ step: index + 1, tool, reason })),
      })
      return contract({
        ...(selected ? { recommended: serialize(selected) } : {}),
        ...(selected ? {} : { guidance: '请描述目标，或在 route 中指定任务类别；也可先从“启动研究运行”开始。' }),
        ...(include_all_routes ? { routes: DISCOVERY_ROUTES.map(serialize) } : {}),
        available_routes: DISCOVERY_ROUTES.map(item => ({ id: item.id, label: item.label })),
      }, {
        source: 'research-tool-discovery',
        confidence: 'verified',
        disclaimer: '此工具只推荐调用路径；不会代表你执行检索、写入、审批或外部请求。',
        summary: {
          route: selected?.id || null,
          routes_available: DISCOVERY_ROUTES.length,
        },
        next_actions: selected
          ? selected.chain.map(([tool, reason]) => `${tool}：${reason}`)
          : ['补充目标描述后重试，或从 include_all_routes=true 查看完整路由目录。'],
      })
    },
  },

  {
    name: 'research_catalog_search',
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
    name: 'research_workflow_compose',
    description: 'Fill in a workflow\'s parameters and generate the final prompt. Returns the composed prompt with missing params, limitations, and suggested skills/sources.',
    inputSchema: {
      workflow_id: z.string().describe('Workflow ID from research_catalog_search'),
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
    name: 'research_source_query',
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
    name: 'research_citation_verify',
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
    name: 'research_literature_search',
    description: 'Search multiple scholarly sources in one call, merge duplicate records, and optionally verify stable identifiers or save the resulting metadata as evidence. Use this as the default literature-discovery entry point; research_source_query remains available for one-source control.',
    inputSchema: {
      query: z.string().min(1).max(300).describe('Literature search query'),
      source_ids: z.array(z.string()).min(1).max(6).optional().default(['crossref', 'openalex', 'semantic-scholar']).describe('Source IDs to query; defaults to three complementary scholarly indexes.'),
      per_source_limit: z.number().int().min(1).max(10).optional().default(5).describe('Maximum records requested from each source'),
      verify_identifiers: z.boolean().optional().default(false).describe('Verify up to 10 stable identifiers after retrieval; disabled by default to avoid unnecessary API calls.'),
      save_to_evidence: z.boolean().optional().default(false).describe('Explicitly save retrieved metadata to the evidence vault; disabled by default.'),
      project: z.string().optional().default('default').describe('Project used only when save_to_evidence is true'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID for evidence and activity traceability.'),
    },
    async execute({ query, source_ids, per_source_limit, verify_identifiers, save_to_evidence, project, run_id }) {
      const settled = await Promise.allSettled(source_ids.map(async sourceId => ({ sourceId, result: await querySource(sourceId, query, per_source_limit) })))
      const successes = settled.filter(item => item.status === 'fulfilled').map(item => item.value)
      const failures = settled.flatMap((item, index) => item.status === 'rejected'
        ? [{ source_id: source_ids[index], error: item.reason?.message || '查询失败' }]
        : [])
      const sources = mergeLiteratureResults(successes)

      if (verify_identifiers) {
        await Promise.all(sources.slice(0, 10).map(async source => {
          if (source.identifier_type === 'none') return
          try {
            const verification = await verifyCitation(source.id)
            source.verification = { exists: verification.exists, confidence: verification.confidence ?? null }
          } catch (e) {
            source.verification = { exists: null, error: e.message }
          }
        }))
      }

      const saved = []
      if (save_to_evidence) {
        for (const source of sources) {
          try {
            const result = await saveEvidence({
              identifier_type: source.identifier_type,
              identifier: source.identifier_type === 'none' ? '' : source.id,
              title: source.title,
              url: source.url,
              project,
              run_id,
            })
            saved.push({ source_id: source.id, ...result })
          } catch (e) {
            saved.push({ source_id: source.id, saved: false, error: e.message })
          }
        }
      }

      return contract({
        query,
        sources,
        total: sources.length,
        searched_sources: successes.map(({ sourceId, result }) => ({ source_id: sourceId, returned: result.total || 0, availability: result.availability })),
        failed_sources: failures,
        ...(save_to_evidence ? {
          evidence_save: {
            requested: true,
            saved: saved.filter(item => item.saved).length,
            duplicates: saved.filter(item => item.dedup_status === 'duplicate').length,
            results: saved,
          },
        } : {}),
      }, {
        source: 'literature-search',
        confidence: failures.length ? 'partial' : 'api',
        disclaimer: '检索结果是候选记录；去重与标识符存在性核验均不能替代原文、全文与纳入标准审查。',
        run_id,
        summary: {
          total: sources.length,
          searched: successes.length,
          failed: failures.length,
          saved: save_to_evidence ? saved.filter(item => item.saved).length : 0,
        },
        next_actions: [
          ...(sources.length ? ['从候选来源中挑选需要长期追溯的条目；用 research_evidence_save_batch 批量显式保存。'] : ['本次检索无结果；更换检索词或增补 source_ids 后重试。']),
          ...(sources.some(source => source.identifier_type === 'none') ? ['部分候选缺少稳定标识符；保存前先回原文补齐 DOI/PMID。'] : []),
          '结果仅供筛选；纳入标准与原文核验需人工完成。',
        ],
        warnings: [
          ...(failures.length ? [`${failures.length} 个数据源查询失败：${failures.map(f => f.source_id).join('、')}。`] : []),
          ...(!sources.length && !failures.length ? ['所有数据源均返回 0 条结果。'] : []),
        ],
      })
    },
  },

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
    },
    async execute({ project, identifier_type, grade, run_id, limit }) {
      try {
        const result = await listEvidence({ project, identifier_type, grade, run_id, limit })
        return wrap(result, { source: 'evidence-store', confidence: 'verified' })
      } catch (e) {
        return err(`检索失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_evidence_grade',
    description: 'Grade an evidence entry as empirical, inference, or missing based on source reliability and content analysis.',
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
    name: 'research_evidence_review',
    description: 'Review the evidence inventory for a project or run in one read-only pass. Summarizes stored grades, proposes rule-based grades, and identifies entries with missing traceability or unverified status. Does not modify evidence records.',
    inputSchema: {
      project: z.string().optional().default('default').describe('Project name to review'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID to review only evidence linked to that run.'),
      limit: z.number().int().min(1).max(200).optional().default(100).describe('Maximum evidence entries to include in the review'),
    },
    async execute({ project, run_id, limit }) {
      try {
        const inventory = await inventoryEvidence({ project, run_id, limit })
        const { entries, summary, missing, unverified } = inventory
        return contract({
          project: inventory.project,
          entries,
          next_actions: [
            ...(missing.length ? [`补齐 ${missing.length} 条缺少稳定标识符或链接的证据来源。`] : []),
            ...(unverified.length ? [`人工核验 ${unverified.length} 条尚未核验的证据；自动建议不等同于确认。`] : []),
            ...(!entries.length ? ['当前范围没有证据条目；先使用 research_literature_search 或 research_evidence_save 添加可追溯来源。'] : []),
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
    description: 'Apply rule-suggested grades to evidence entries behind a preview-then-confirm gate. Default returns a preview plan without writing anything; set apply=true (after human confirmation) to write the suggested grades. Entries are only processed when their ids are explicitly listed.',
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
            ? '写回的分级仍来自规则引擎，人工确认的是「应用」这个动作本身；如需修正请用人工复核覆盖。'
            : '当前为预览模式，未写入任何数据；确认后需以 apply=true 再次调用才会写回。',
          run_id,
          summary: {
            apply: Boolean(result.apply),
            changed: result.changed,
            planned: result.plan?.length ?? 0,
          },
          next_actions: apply
            ? ['分级已写回；使用 research_evidence_review 复核最新盘点结果。']
            : (result.plan?.length
                ? ['人工核对上方计划后，以 apply=true 与相同的 evidence_ids 再次调用才会写回。', '预览不会修改任何条目；可以直接放弃。']
                : ['当前范围内没有建议分级与已存分级不同的条目；无需应用。']),
          warnings: apply ? [] : ['本次调用是预览：未写回任何分级。'],
        })
      } catch (e) {
        return err(`分级应用失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_usage_stats',
    description: 'Read-only aggregated tool-usage observability: per-tool call counts, failure rates, help-route demand, and where research chains commonly break. Only sanitized metadata is counted — query terms, goals, note text and paper content are never stored or returned.',
    inputSchema: {
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID to scope the statistics'),
      limit: z.number().int().min(10).max(200).optional().default(200).describe('Max recent call-log entries analyzed'),
    },
    async execute({ run_id, limit }) {
      try {
        const logs = await readCallLogs({ limit, ...(run_id ? { runId: run_id } : {}) })
        const byTool = new Map()
        for (const call of logs) {
          const bucket = byTool.get(call.tool) || { tool: call.tool, calls: 0, failed: 0 }
          bucket.calls += 1
          if (call.ok === false) bucket.failed += 1
          byTool.set(call.tool, bucket)
        }
        const tools = [...byTool.values()].map(bucket => ({
          ...bucket,
          failure_rate: bucket.calls ? Number((bucket.failed / bucket.calls).toFixed(3)) : 0,
        })).sort((a, b) => b.calls - a.calls)
        // 帮助路由需求量：research_help 的调用次数是「不知道该用什么」的直接信号。
        const helpCalls = byTool.get('research_help')?.calls || 0
        // 链路中断探测：run_start 之后没有任何 literature/evidence 类调用，说明链路在启动后断了。
        const startedRuns = new Set(logs.filter(call => call.tool === 'research_run_start' && call.run_id).map(call => call.run_id))
        const advancedRuns = new Set(logs.filter(call => call.run_id && startedRuns.has(call.run_id) && call.tool !== 'research_run_start').map(call => call.run_id))
        const stalledRuns = [...startedRuns].filter(id => !advancedRuns.has(id))
        return contract({
          scope: run_id ? { run_id } : { window: `last ${logs.length} calls` },
          window_entries: logs.length,
          tools,
          observability: {
            help_calls: helpCalls,
            runs_started: startedRuns.size,
            runs_stalled_after_start: stalledRuns.length,
            stalled_run_ids: stalledRuns.slice(0, 5),
          },
        }, {
          source: 'usage-stats',
          confidence: 'cached',
          disclaimer: '统计只基于脱敏调用元数据；查询词、目标描述与论文正文从不落盘，也无法从这里还原。',
          summary: {
            entries_analyzed: logs.length,
            distinct_tools: tools.length,
            total_failures: tools.reduce((sum, tool) => sum + tool.failed, 0),
          },
          next_actions: [
            ...(tools.some(tool => tool.failure_rate >= 0.5 && tool.calls >= 2) ? ['存在失败率过高的工具；优先检查其前置依赖（如宿主 MCP 数据源配置）。'] : []),
            ...(helpCalls > logs.length * 0.3 && logs.length >= 10 ? ['research_help 占比过高；可在提示词里固化常用调用链。'] : []),
            ...(stalledRuns.length ? [`${stalledRuns.length} 个 run 启动后没有后续工具调用；用 research_run_status 查看它们停在哪一步。`] : []),
            '统计仅供改进工具体验；不构成对研究质量的评价。',
          ],
        })
      } catch (e) {
        return err(`用量统计失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_run_start',
    description: 'Start a traceable research run from a catalog workflow. Creates the Material Passport and initializes its human checkpoints in one call. Use this as the default run entry point; research_run_export remains for explicit state snapshots later in the workflow.',
    inputSchema: {
      workflow_id: z.string().describe('Catalog workflow ID to run'),
      project: z.string().optional().default('default').describe('Project name for this research run'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional caller-chosen run ID; generated when omitted.'),
      current_stage: z.string().optional().default('research_planning').describe('Initial workflow stage'),
      constraints: z.array(z.string()).optional().describe('Research constraints to carry in the new passport'),
    },
    async execute({ workflow_id, project, run_id, current_stage, constraints }) {
      const workflow = itemById(workflow_id)
      if (!workflow || workflow.type !== 'workflow') return err(`工作流 "${workflow_id}" 不存在。`)
      try {
        const passport = await exportPassport({
          run_id,
          project,
          current_stage,
          constraints,
          workflow_id: workflow.id,
          pending: [{ stage: current_stage, workflow_id, note: `已启动工作流：${workflow.name}` }],
        })
        const checkpoint_state = await initializeCheckpoints(passport.run_id, workflow, [])
        return contract({
          current_stage,
          workflow: { id: workflow.id, name: workflow.name, category: workflow.category },
          checkpoint_state,
          passport: { yaml: passport.passport_yaml, hash: passport.hash },
        }, {
          source: 'research-run-starter',
          confidence: 'verified',
          disclaimer: '创建运行和检查点不代表研究步骤已经执行；每项研究结论仍需人工核验。',
          run_id: passport.run_id,
          summary: {
            workflow_id: workflow.id,
            workflow_name: workflow.name,
            current_stage,
            pending_checkpoints: (checkpoint_state.pending || []).length,
          },
          next_actions: [
            '使用 research_run_status 查看运行总览、证据盘点与推荐下一步。',
            '使用 research_workflow_compose 生成当前阶段的可执行 Prompt。',
            '检索与保存请走 research_literature_search；核验与保存均须显式开启。',
          ],
        })
      } catch (e) {
        return err(`启动研究运行失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_run_status',
    description: 'Read-only overview of a research run: current workflow stage, pending human checkpoints, evidence inventory (totals, missing traceability, unverified), recent artifacts, and recommended next actions. Without run_id, lists the most recently active runs. Never executes research steps or writes any state.',
    inputSchema: {
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Research run ID to inspect; omit to list recent runs.'),
      project: z.string().optional().describe('Project name for the evidence inventory; defaults to the run\'s passport project or "default".'),
      limit: z.number().int().min(1).max(200).optional().default(100).describe('Max evidence entries included in the inventory'),
      recent_limit: z.number().int().min(1).max(50).optional().default(10).describe('Max runs listed when run_id is omitted'),
    },
    async execute({ run_id, project, limit, recent_limit }) {
      try {
        if (!run_id) {
          const runs = await listRecentRuns({ limit: recent_limit })
          return contract({
            runs,
          }, {
            source: 'research-run-status',
            confidence: 'cached',
            disclaimer: '运行列表来自护照与检查点文件；创建运行不代表研究步骤已经执行。',
            summary: {
              runs_listed: runs.length,
              waiting_review: runs.filter(run => run.pending_checkpoints > 0).length,
            },
            next_actions: [
              ...(runs.length ? ['选择一个 run_id 再次调用，查看该运行的总览与推荐下一步。'] : []),
              ...(!runs.length ? ['当前没有已启动的运行；使用 research_run_start 从目录工作流创建。'] : []),
            ],
          })
        }

        const overview = await buildRunOverview(run_id)
        const workflow = overview.workflow_id ? itemById(overview.workflow_id) : null
        const evidence = await inventoryEvidence({
          project: project || overview.project === 'unknown' ? (project || 'default') : (project || overview.project),
          run_id,
          limit,
        })
        const logs = await readCallLogs({ limit: 200, runId: run_id })
        const artifacts = logs.filter(call => call.ok !== false && call.artifact_kind).slice(0, 10)
          .map(call => ({ kind: call.artifact_kind, tool: call.tool, summary: call.result_summary, at: call.at }))
        const pending = overview.checkpoint_state.pending || []
        const { missing_traceability: missing, unverified } = evidence.summary
        return contract({
          project: evidence.project,
          current_stage: overview.current_stage,
          workflow: overview.workflow_id ? { id: overview.workflow_id, ...(overview.workflow_name ? { name: overview.workflow_name } : {}) } : null,
          status: overview.status,
          checkpoints: { pending, approved: overview.checkpoint_state.approved || [] },
          stage_progress: overview.stage_progress,
          evidence: evidence.summary,
        }, {
          source: 'research-run-status',
          confidence: 'cached',
          disclaimer: '状态汇总为只读投影，不代表研究步骤已被执行或核验；每项结论仍需人工确认。',
          run_id,
          summary: {
            current_stage: overview.current_stage,
            status: overview.status,
            workflow_completed: overview.stage_progress?.workflow_completed ?? null,
            pending_checkpoints: pending.length,
            evidence_total: evidence.summary.total,
            missing_traceability: missing,
            unverified,
          },
          next_actions: [
            ...(pending.length ? [`人工审批 ${pending.length} 个待放行检查点：${pending.join('、')}；使用 research_run_checkpoint_approve 并由人工确认。`] : []),
            ...(missing ? [`补齐 ${missing} 条缺少稳定标识符或链接的证据来源。`] : []),
            ...(unverified ? [`人工核验 ${unverified} 条尚未核验的证据；自动建议不等同于确认。`] : []),
            ...(!evidence.entries.length ? ['该 run 还没有证据条目；使用 research_literature_search 检索并显式保存可追溯来源。'] : []),
            ...(!pending.length && evidence.entries.length && !artifacts.length ? ['证据已就绪；使用 research_review_output 审阅研究草稿，或 research_run_export 导出护照交接。'] : []),
            ...(!pending.length && artifacts.length ? ['使用 research_run_export 导出护照交接，或 research_review_output 继续审阅草稿。'] : []),
          ],
          artifacts,
        })
      } catch (e) {
        return err(`运行状态查询失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_run_export',
    description: 'Export a Material Passport (cross-session research state snapshot) as YAML.',
    inputSchema: {
      project: z.string().optional().describe('Project name'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Reuse an existing Research Kit run ID; otherwise a new ID is generated.'),
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
    name: 'research_run_import',
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

  {
    name: 'research_figure_generate',
    description: 'Generate a publication-quality matplotlib script using a pre-built paper style. Returns the Python script to execute.',
    inputSchema: {
      style: z.string().optional().describe('Style name (required for single figure; optional when panels is provided)'),
      data: z.record(z.any()).optional().describe('Data object (required for single figure; optional when panels is provided)'),
      title: z.string().optional().describe('Figure title'),
      xlabel: z.string().optional().describe('X-axis label'),
      ylabel: z.string().optional().describe('Y-axis label'),
      figsize: z.array(z.number()).length(2).optional().describe('Figure size [width, height] in inches'),
      dpi: z.number().int().optional().default(300).describe('Output DPI'),
      apa_style: z.boolean().optional().describe('Apply APA 7.0 formatting: colorblind-safe Okabe-Ito palette, sans-serif fonts, APA font sizes'),
      panels: z.array(z.object({
        style: z.string(),
        data: z.record(z.any()),
        title: z.string().optional(),
      })).optional().describe('Multi-panel mode: array of {style, data, title?} objects. When provided, ignores single style/data.'),
      layout: z.object({
        rows: z.number().int().optional(),
        cols: z.number().int().optional(),
      }).optional().describe('Subplot grid layout (default: auto)'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID for activity traceability.'),
    },
    async execute({ style, data, title, xlabel, ylabel, figsize, dpi, apa_style, panels, layout }) {
      return generateFigure(style, data, { title, xlabel, ylabel, figsize, dpi, apa_style, panels, layout })
    },
  },

  {
    name: 'research_figure_list_styles',
    description: 'List all available paper figure styles with their type and color palettes.',
    inputSchema: {},
    async execute() {
      const styles = listFigureStyles()
      return wrap({ styles }, { source: 'figure-styles', confidence: 'verified' })
    },
  },

  {
    name: 'research_run_checkpoint_status',
    description: 'Get the checkpoint state for a research pipeline run.',
    inputSchema: {
      run_id: z.string().describe('Run ID from research_run_export'),
    },
    async execute({ run_id }) {
      const state = await getCheckpointState(run_id)
      return wrap(state, { source: 'checkpoint-manager', confidence: 'verified' })
    },
  },

  {
    name: 'research_run_checkpoint_approve',
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
    name: 'research_review_output',
    description: 'Review a research draft in one pass: citation-claim alignment, textual anomalies, academic writing quality, and protected hedging. Use this as the default draft-review entry point; the individual research_review_* tools remain available for focused follow-up.',
    inputSchema: {
      text: z.string().min(100).describe('The draft, section, or review text to assess'),
      max_claims: z.number().int().min(1).max(50).optional().default(20).describe('Max cited claims to audit'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID for activity traceability.'),
    },
    async execute({ text, max_claims, run_id }) {
      const [claims, anomalies, writing, hedging] = await Promise.all([
        auditClaims(text, { max_claims }),
        detectTextAnomalies(text),
        checkWritingQuality(text),
        checkHedgingPhrases(text),
      ])
      return contract({
        claims: claims.data,
        anomalies: anomalies.data,
        writing: writing.data,
        hedging: hedging.data,
      }, {
        source: 'research-output-review',
        confidence: 'mixed',
        disclaimer: '汇总审阅包含 API 核验与规则检查；所有建议均需研究者人工确认。',
        run_id,
        summary: {
          claims_audited: claims.data?.claims?.length ?? claims.data?.total ?? 0,
          anomalies: anomalies.data?.summary?.contradictions ?? anomalies.data?.findings?.length ?? 0,
          quality_flags: writing.data?.summary?.total ?? writing.data?.issues?.length ?? 0,
          hedging_phrases: hedging.data?.total ?? hedging.data?.phrases?.length ?? 0,
        },
        next_actions: [
          '优先修复未找到或不支持的引用声明，再复核全文。',
          '逐条确认高风险矛盾与缺失要素，避免将模式信号直接当作结论。',
          '修改表述时保留保护性限制语；删除它们会改变声明强度。',
        ],
      })
    },
  },

  {
    name: 'research_review_claims',
    description: 'Audit all unique claim-citation pairs in a text. Verifies each cited reference exists and whether the abstract supports the specific claim. Same DOI with different claims is audited separately.',
    inputSchema: {
      text: z.string().min(20).describe('The text to audit (paper draft, review, etc.)'),
      max_claims: z.number().int().min(1).max(50).optional().default(20).describe('Max claims to audit'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID for activity traceability.'),
    },
    async execute({ text, max_claims }) {
      return auditClaims(text, { max_claims })
    },
  },

  {
    name: 'research_literature_link',
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
    name: 'research_review_anomalies',
    description: 'Detect textual anomalies: redundant patterns, contradictions, silence zones (missing elements like limitations or sample size). Based on literature-review methodology.',
    inputSchema: {
      text: z.string().min(50).describe('The text to analyze (paper draft, review, abstract, etc.)'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID for activity traceability.'),
    },
    async execute({ text }) {
      return detectTextAnomalies(text)
    },
  },

  {
    name: 'research_review_writing',
    description: 'Check academic writing quality: flagged terms, throat-clearing openers, punctuation patterns, sentence length. Not a humanizer.',
    inputSchema: {
      text: z.string().min(100).describe('The text to check (paper draft, section, paragraph)'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID for activity traceability.'),
    },
    async execute({ text }) {
      return checkWritingQuality(text)
    },
  },

  {
    name: 'research_disclosure_generate',
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
    name: 'research_disclosure_list_policies',
    description: 'List all supported journal/conference AI disclosure policies with their placement requirements.',
    inputSchema: {},
    async execute() {
      const policies = listDisclosurePolicies()
      return wrap({ policies }, { source: 'disclosure-generator', confidence: 'verified' })
    },
  },

  {
    name: 'research_review_hedging',
    description: 'Detect protected hedging phrases (may/might/suggests/初步/可能) that must not be silently removed during revision. Deleting them changes the paper\'s epistemic stance.',
    inputSchema: {
      text: z.string().min(20).describe('The text to check (abstract, section, revision)'),
    },
    async execute({ text }) {
      return checkHedgingPhrases(text)
    },
  },

  {
    name: 'research_metadata_openalex_fetch',
    description: 'Fetch full metadata (title, abstract, authors, journal, citations) from OpenAlex by DOI or search query. Optionally save results to evidence store.',
    inputSchema: {
      dois: z.array(z.string()).optional().describe('Array of DOIs to fetch'),
      query: z.string().optional().describe('Search query (if provided, ignores dois)'),
      limit: z.number().int().min(1).max(50).optional().default(10).describe('Max results for search mode'),
      project: z.string().optional().describe('Project name for evidence saving'),
      save_to_evidence: z.boolean().optional().describe('Save fetched metadata to evidence store'),
    },
    async execute({ dois, query, limit, project, save_to_evidence }) {
      return fetchOpenAlexMetadata({ dois, query, limit, project, save_to_evidence })
    },
  },
]

export { tools, DISCOVERY_ROUTES }
