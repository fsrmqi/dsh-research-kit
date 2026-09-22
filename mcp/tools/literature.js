import { z } from 'zod/v3'
import { verifyCitation } from '../execution/citation-verifier.js'
import { querySource } from '../execution/source-querier.js'
import { err, wrap } from '../execution/wrapper.js'

export const literatureTools = [
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
        return wrap(result, { source: `data-source:${source_id}`, confidence: result.cached ? 'cached' : 'api', disclaimer: '候选结果需回原文逐条核验；插件不伪造检索结果。' })
      } catch (e) { return err(`查询 ${source_id} 失败：${e.message}`) }
    },
  },
  {
    name: 'research_citation_verify',
    description: '核验 DOI、PMID、arXiv 来源是否存在；提供声明时仅返回关键词线索，支持性保持待人工核验。',
    inputSchema: {
      identifier: z.string().describe('DOI (10.xxxx/xxx), PMID (number), or arXiv ID (e.g. 2301.00001)'),
      claim: z.string().optional().describe('待核验声明；仅提供标题与摘要关键词线索，不自动判断支持或反驳。'),
    },
    async execute({ identifier, claim }) {
      try {
        const result = await verifyCitation(identifier, claim)
        return wrap(result, { source: 'citation-verifier', confidence: 'api', disclaimer: claim ? '关键词重合仅作相关性线索，claim 支持性保持待核验，需人工核验全文。' : '存在性判断基于 Crossref/PubMed/arXiv API 实时查询。' })
      } catch (e) { return err(`验证失败：${e.message}`) }
    },
  },
]
