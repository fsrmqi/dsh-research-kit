import { z } from 'zod/v3'
import { contract } from '../execution/contract.js'
import { err } from '../execution/wrapper.js'
import { dreamMemoryView, recordDreamMemoryCard, recordDreamMemoryTheme } from '../state/dream-memory.js'
import { MEMORY_JUDGMENTS } from '../../src/lib/dream-memory.js'

const coversSchema = z.object({
  evidenceIds: z.array(z.string().max(120)).max(12).optional(),
  claimIds: z.array(z.string().max(120)).max(12).optional(),
  nodeIds: z.array(z.string().max(120)).max(12).optional(),
  knowledgeClaimIds: z.array(z.string().max(120)).max(12).optional(),
  assetIds: z.array(z.string().max(120)).max(12).optional(),
}).optional()

export const dreamMemoryTools = [
  {
    name: 'research_dream_memory',
    description: 'Read the project dream memory: theme summaries and memory cards that stand in for cold history. Pass id to expand one card or theme back to the original record IDs. Does not delete or rewrite evidence, claims, or assets.',
    inputSchema: {
      project: z.string().optional().default('default').describe('Project name'),
      id: z.string().max(80).optional().describe('Memory card or theme id to expand into covered record IDs'),
    },
    async execute(input) {
      try {
        const view = await dreamMemoryView(input.project, { id: input.id || '' })
        return contract(view, {
          source: 'research-dream-memory',
          confidence: 'cached',
          disclaimer: '梦境记忆是已确认的摘要。展开后的编号指向原文；摘要本身不是已核实结论。',
        })
      } catch (error) { return err(`读取梦境记忆失败：${error.message}`) }
    },
  },
  {
    name: 'research_dream_memory_record',
    description: 'Record an accepted dream memory card or fold existing cards into a theme summary. Stores only a short gist and source IDs. Never deletes the underlying evidence, claims, nodes, or assets.',
    inputSchema: {
      project: z.string().optional().default('default').describe('Project name'),
      layer: z.enum(['card', 'theme']).describe('card stores one accepted gist; theme folds existing cards'),
      gist: z.string().min(1).max(800).describe('Short gist that can stand in for the covered records'),
      judgment: z.enum(MEMORY_JUDGMENTS).optional().describe('duplicate, supports, refutes, unrelated, or unresolved'),
      covers: coversSchema.describe('Original record IDs this memory covers'),
      card_ids: z.array(z.string().max(80)).max(24).optional().describe('Existing memory card ids to fold into a theme'),
      open_conflicts: z.string().max(300).optional().describe('Conflicts that remain open inside a theme'),
      gaps: z.string().max(300).optional().describe('Gaps that remain inside a theme'),
    },
    async execute(input) {
      try {
        const memory = input.layer === 'theme'
          ? await recordDreamMemoryTheme(input.project, {
            gist: input.gist,
            cardIds: input.card_ids || [],
            covers: input.covers || {},
            openConflicts: input.open_conflicts || '',
            gaps: input.gaps || '',
          })
          : await recordDreamMemoryCard(input.project, {
            gist: input.gist,
            judgment: input.judgment || 'unresolved',
            covers: input.covers || {},
          })
        return contract({ project: memory.project, cards: memory.cards.length, themes: memory.themes.length }, {
          source: 'research-dream-memory',
          confidence: 'unverified',
          disclaimer: '写入的是摘要和编号，不是对原文的核实或删除。',
        })
      } catch (error) { return err(`写入梦境记忆失败：${error.message}`) }
    },
  },
]
