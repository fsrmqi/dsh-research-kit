import { z } from 'zod/v3'
import { verifyCitation } from '../execution/citation-verifier.js'
import { contract } from '../execution/contract.js'
import { saveEvidenceBatch } from '../execution/evidence-store.js'
import { linkLiterature } from '../execution/literature-linker.js'
import { fetchOpenAlexMetadata } from '../execution/openalex-fetcher.js'
import { querySource } from '../execution/source-querier.js'
import { err } from '../execution/wrapper.js'
import { mergeLiteratureResults } from './shared.js'

export const literatureDiscoveryTools = [
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
        const batch = await saveEvidenceBatch(sources.map(source => ({
          identifier_type: source.identifier_type,
          identifier: source.identifier_type === 'none' ? '' : source.id,
          title: source.title,
          url: source.url,
        })), { project, run_id })
        const itemKey = item => item.identifier_type === 'none'
          ? `title:${String(item.title || '').slice(0, 80).toLowerCase()}`
          : `${item.identifier_type}:${item.identifier}`
        const savedByKey = new Map(batch.saved.map(item => [itemKey(item), item]))
        const duplicateByKey = new Map(batch.duplicates.map(item => [itemKey(item), item]))
        for (const source of sources) {
          const input = { identifier_type: source.identifier_type, identifier: source.identifier_type === 'none' ? '' : source.id, title: source.title }
          const item = savedByKey.get(itemKey(input))
          const duplicate = duplicateByKey.get(itemKey(input))
          saved.push(item
            ? { source_id: source.id, saved: true, id: item.id, dedup_status: 'new' }
            : { source_id: source.id, saved: false, id: duplicate?.existing_id, dedup_status: duplicate ? 'duplicate' : 'invalid' })
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
]

export const literatureLinkTools = [
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
]

export const literatureMetadataTools = [
  {
    name: 'research_metadata_openalex_fetch',
    description: 'Fetch full metadata (title, abstract, authors, journal, citations) from OpenAlex by DOI or search query. Optionally save results to evidence store.',
    inputSchema: {
      dois: z.array(z.string()).optional().describe('Array of DOIs to fetch'),
      query: z.string().optional().describe('Search query (if provided, ignores dois)'),
      limit: z.number().int().min(1).max(50).optional().default(10).describe('Max results for search mode'),
      project: z.string().optional().describe('Project name for evidence saving'),
      save_to_evidence: z.boolean().optional().describe('Save fetched metadata to evidence store'),
      include_references: z.boolean().optional().default(false).describe('Include the full referenced_works array; disabled by default to keep responses compact'),
    },
    async execute({ dois, query, limit, project, save_to_evidence, include_references }) {
      return fetchOpenAlexMetadata({ dois, query, limit, project, save_to_evidence, include_references })
    },
  },
]
