import { crossrefUrl } from './http-client.js'

export function cleanSourceText(value, limit = 280) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function makeSourceRecord(id, title, url, meta = '', summary = '') {
  return {
    id: String(id || url),
    title: cleanSourceText(title, 220) || '未命名记录',
    url: String(url || ''),
    meta: cleanSourceText(meta, 180),
    summary: cleanSourceText(summary, 420),
  }
}

// 上游把字段从数组改成对象、或返回 null 包体时，`.map` 会抛 TypeError。
// 统一先收敛成「对象数组」，避免上游怪形状把正常查询升级成插件故障。
export function adapterRows(value) {
  return (Array.isArray(value) ? value : []).filter(item => item && typeof item === 'object')
}

// DSH 直查路由与 MCP source-querier 共用的 5 个公开学术/临床数据源适配器：
// URL 构造与防御性解析只维护一份，避免两端漂移。
export const SHARED_SOURCE_ADAPTERS = {
  crossref: {
    url: (q, n) => crossrefUrl(`https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${n}&select=DOI,title,author,published-print,published-online,container-title,URL,abstract`),
    parse: data => adapterRows(data?.message?.items).map(item => makeSourceRecord(
      item.DOI,
      item.title?.[0],
      item.URL || `https://doi.org/${item.DOI}`,
      [item.author?.[0]?.family, item['container-title']?.[0], item['published-print']?.['date-parts']?.[0]?.[0] || item['published-online']?.['date-parts']?.[0]?.[0]].filter(Boolean).join(' · '),
      typeof item.abstract === 'string' ? item.abstract.replace(/<[^>]+>/g, '').slice(0, 420) : '',
    )),
  },
  openalex: {
    auth_query: 'api_key',
    url: (q, n) => `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${n}`,
    parse: data => adapterRows(data?.results).map(item => makeSourceRecord(
      item.id,
      item.title,
      item.doi || item.id,
      [item.publication_year, item.primary_location?.source?.display_name, item.cited_by_count ? `被引 ${item.cited_by_count}` : ''].filter(Boolean).join(' · '),
      item.abstract_inverted_index ? 'OpenAlex 已返回摘要索引；请打开原文或来源核验细节。' : '',
    )),
  },
  'semantic-scholar': {
    auth_header: 'x-api-key',
    url: (q, n) => `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=${n}&fields=title,year,authors,venue,abstract,url,citationCount,externalIds`,
    parse: data => adapterRows(data?.data).map(item => makeSourceRecord(
      item.paperId || item.externalIds?.DOI,
      item.title,
      item.url || (item.externalIds?.DOI ? `https://doi.org/${item.externalIds.DOI}` : ''),
      [item.year, item.venue, item.citationCount ? `被引 ${item.citationCount}` : ''].filter(Boolean).join(' · '),
      item.abstract || '',
    )),
  },
  'europe-pmc': {
    auth_query: 'apiKey',
    url: (q, n) => `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=${n}&query=${encodeURIComponent(q)}`,
    parse: data => adapterRows(data?.resultList?.result).map(item => makeSourceRecord(
      item.pmid || item.id,
      item.title,
      item.pmid ? `https://europepmc.org/article/MED/${item.pmid}` : `https://europepmc.org/article/${item.source || 'MED'}/${item.id}`,
      [item.authorString, item.journalTitle, item.pubYear].filter(Boolean).join(' · '),
      item.abstractText || '',
    )),
  },
  clinicaltrials: {
    url: (q, n) => `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(q)}&pageSize=${n}&format=json`,
    parse: data => adapterRows(data?.studies).map(item => {
      const p = item.protocolSection || {}
      const id = p.identificationModule?.nctId
      return makeSourceRecord(
        id,
        p.identificationModule?.briefTitle,
        id ? `https://clinicaltrials.gov/study/${id}` : '',
        [p.statusModule?.overallStatus, p.designModule?.studyType].filter(Boolean).join(' · '),
        p.descriptionModule?.briefSummary || '',
      )
    }),
  },
}
