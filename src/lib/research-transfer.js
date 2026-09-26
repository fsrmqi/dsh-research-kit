import { parseEvidenceBackup, mergeEntries } from './evidence-vault-core.js'
import { parseKnowledgeBackup } from '../knowledge-store.js'

export const RESEARCH_TRANSFER_KIND = 'dsh-research-kit-app-transfer'
export const RESEARCH_TRANSFER_VERSION = 1

async function transferDigest(payload) {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持安全校验，无法迁移研究数据。')
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('')
}

export async function serializeResearchTransfer(payload) {
  const checksum = await transferDigest(payload)
  return JSON.stringify({ kind: RESEARCH_TRANSFER_KIND, version: RESEARCH_TRANSFER_VERSION,
    exportedAt: Date.now(), checksum, payload }, null, 2) + '\n'
}

export async function parseResearchTransfer(text) {
  let input
  try { input = JSON.parse(String(text || '')) } catch { throw new Error('迁移文件不是合法 JSON。') }
  if (input?.kind !== RESEARCH_TRANSFER_KIND || input?.version !== RESEARCH_TRANSFER_VERSION) {
    throw new Error('迁移文件类型或版本不受支持。')
  }
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new Error('迁移文件缺少数据。')
  if (!/^[0-9a-f]{64}$/.test(input.checksum || '') || await transferDigest(input.payload) !== input.checksum) {
    throw new Error('迁移文件校验失败；请从原 Web 端重新导出。')
  }
  const { evidence, knowledge, assets, runs } = input.payload
  if (!evidence || !knowledge) throw new Error('迁移文件缺少证据库或知识库。')
  const parsedEvidence = parseEvidenceBackup(JSON.stringify(evidence))
  const parsedKnowledge = parseKnowledgeBackup(JSON.stringify(knowledge))
  if (!Array.isArray(assets) || !Array.isArray(runs)) throw new Error('迁移文件缺少灵感资产或研究运行。')
  if (assets.some(item => !item || typeof item.id !== 'string' || !item.id || typeof item.body !== 'string' || !item.body.trim())
    || runs.some(item => !item || typeof item.id !== 'string' || !item.id)) {
    throw new Error('迁移文件包含无效的资产或研究运行。')
  }
  return { evidence: parsedEvidence, knowledge: parsedKnowledge, assets, runs }
}

export function previewResearchTransfer(incoming, current) {
  const summarize = (rows, existing, key = 'id') => {
    const known = new Set(existing.map(item => item[key]))
    return { total: rows.length, add: rows.filter(item => !known.has(item[key])).length,
      existing: rows.filter(item => known.has(item[key])).length }
  }
  const evidenceMerge = mergeEntries(current.evidence.entries, incoming.evidence.entries)
  return {
    evidence: { total: incoming.evidence.entries.length, add: evidenceMerge.added,
      existing: evidenceMerge.skipped, invalid: evidenceMerge.invalid },
    claims: summarize(incoming.evidence.claims, current.evidence.claims),
    links: summarize(incoming.evidence.links, current.evidence.links),
    ledger: summarize(incoming.evidence.ledger, current.evidence.ledger),
    workspaces: summarize(incoming.evidence.workspaces, current.evidence.workspaces, 'projectKey'),
    knowledgeNodes: summarize(incoming.knowledge.nodes, current.knowledge.nodes, 'key'),
    knowledgeClaims: summarize(incoming.knowledge.claims, current.knowledge.claims, 'id'),
    assets: summarize(incoming.assets, current.assets),
    runs: summarize(incoming.runs, current.runs),
  }
}
