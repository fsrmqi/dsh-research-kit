import { z } from 'zod/v3'
import { itemById, composeWorkflow, searchCatalog } from '../../src/catalog.js'
import { err, wrap } from '../execution/wrapper.js'

export const catalogTools = [
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
      const filtered = category ? results.filter(item => item.category === category) : results
      const items = filtered.slice(0, limit).map(item => ({
        id: item.id, name: item.name, description: item.description, category: item.category,
        tags: item.tags || [], tool_mode: item.tool_mode || 'guided', input_schema: item.input_schema || null,
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
          enforceRequired: false, extraSkillIds: skill_ids || [], extraDatabaseIds: source_ids || [],
        })
        return wrap({
          prompt: result.prompt, missing_params: result.missing, limitations: workflow.limitations || [],
          suggested_skills: (workflow.suggestedSkillIds || []).map(id => ({ id, name: itemById(id)?.name || id })),
          suggested_sources: (workflow.suggestedDatabaseIds || []).map(id => ({ id, name: itemById(id)?.name || id })),
          agent_guidance: workflow.agent_guidance || null, checkpoints: workflow.checkpoints || [],
        }, { source: `catalog/workflows#${workflow_id}`, confidence: 'verified' })
      } catch (e) { return err(e.message) }
    },
  },
]
