
import { verifyCitation } from './citation-verifier.js'
import { wrap } from './wrapper.js'

const CITATION_PATTERNS = [
  { regex: /\[(\d+)\]\((?:https?:\/\/doi\.org\/)?(10\.[^\s)]+)\)/g, type: 'doi' },
  { regex: /\[(\d+)\]\((?:https?:\/\/(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\/)?(\d{5,8})\)/g, type: 'pmid' },
  { regex: /\[([^\]]+)\]\((?:https?:\/\/doi\.org\/)?(10\.[^\s)]+)\)/g, type: 'doi' },
  { regex: /(?:doi[:\s]*|https?:\/\/doi\.org\/)(10\.\d{4,9}\/[-._;()/:a-z0-9]+)/gi, type: 'doi' },
  { regex: /(?:PMID[:\s]*|pubmed\.ncbi\.nlm\.nih\.gov\/)(\d{5,8})/gi, type: 'pmid' },
  { regex: /\barxiv:(\d{4}\.\d{4,5}(?:v\d+)?)/gi, type: 'arxiv' },
]

function extractClaims(text) {
  const rawMatches = []
  const raw = String(text || '')
  
  for (const pattern of CITATION_PATTERNS) {
    pattern.regex.lastIndex = 0
    let match
    while ((match = pattern.regex.exec(raw)) !== null) {
      const identifier = match[2] || match[1]
      if (!identifier) continue
      const cleaned = identifier.replace(/[).,;]+$/, '').trim()
      if (!cleaned) continue
      
      // Extract surrounding context: 200 chars before and after the citation match
      const start = Math.max(0, match.index - 200)
      const end = Math.min(raw.length, match.index + match[0].length + 200)
      let context = raw.slice(start, end).replace(/\s+/g, ' ').trim()
      
      // 归一化换行和多余空白
      context = context.replace(/\n+/g, ' ').replace(/\r/g, '').trim()
      
      const claimText = context.replace(match[0], ' ').replace(/\s+/g, ' ').trim()
      if (claimText.length > 10) {
        rawMatches.push({
          claim: claimText.slice(0, 300),
          citation: cleaned,
          citation_type: pattern.type,
          context: context.slice(0, 300),
          index: match.index,
        })
      }
    }
  }
  
  // 按 match.index 排序，确保跨 pattern 的匹配按文档顺序排列
  rawMatches.sort((a, b) => a.index - b.index)
  
  // 跨 pattern 去重：同一 identifier 且位置相近（<200 字符）视为同一引用被不同 pattern 匹配
  const claims = []
  const lastByIdentifier = new Map()
  for (const match of rawMatches) {
    const lowerId = match.citation.toLowerCase()
    const lastIndex = lastByIdentifier.get(lowerId)
    if (lastIndex !== undefined && Math.abs(match.index - lastIndex) < 10) continue
    lastByIdentifier.set(lowerId, match.index)
    claims.push({ claim: match.claim, citation: match.citation, citation_type: match.citation_type, context: match.context })
  }
  
  return claims
}

async function mapWithConcurrency(items, limit, run) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await run(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function auditClaims(text, { max_claims = 20 } = {}) {
  const allClaims = extractClaims(text)
  if (!allClaims.length) {
    return wrap({ claims: [], summary: { total: 0, message: '未在文本中找到带 DOI/PMID/arXiv 引用的 claim。' } }, { source: 'claim-auditor', confidence: 'verified' })
  }

  const selected = allClaims.slice(0, max_claims)
  const results = await mapWithConcurrency(selected, 4, async item => {
    let audit = { exists: false, supported: null, evidence: '', severity: 'unverifiable', category: 'verification-failed' }
    try {
      const result = await verifyCitation(item.citation, item.claim)
      audit = {
        exists: result.exists,
        supported: result.claim_supported ?? null,
        evidence: result.claim_evidence || result.reason || '',
        confidence: result.confidence || 0.5,
        severity: !result.exists ? 'high-warn' : result.claim_supported === false ? 'high-warn' : result.claim_supported === true ? 'ok' : 'advisory',
        category: !result.exists ? 'fabricated-reference' : result.claim_supported === false ? 'claim-not-supported' : result.claim_supported === true ? 'supported' : 'needs-fulltext-review',
      }
    } catch (e) {
      audit.evidence = `验证失败：${e.message}`
      audit.category = 'verification-error'
    }
    return { ...item, ...audit }
  })

  const summary = {
    total: allClaims.length,
    audited: results.length,
    supported: results.filter(r => r.category === 'supported').length,
    not_supported: results.filter(r => r.category === 'claim-not-supported').length,
    fabricated: results.filter(r => r.category === 'fabricated-reference').length,
    needs_review: results.filter(r => r.category === 'needs-fulltext-review').length,
    errors: results.filter(r => r.category === 'verification-error').length,
  }

  return wrap({ claims: results, summary }, {
    source: 'claim-auditor',
    confidence: 'api',
    disclaimer: '关键词重合仅作相关性线索，claim 支持性保持待核验，需人工核验全文。',
  })
}

export { auditClaims, extractClaims }
