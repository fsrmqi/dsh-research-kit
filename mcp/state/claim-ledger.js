// 科研 Claim 台账：保存研究者显式登记的短声明、认识论状态、证据 ID 与短引用锚点。
// Agent 的审阅建议独立保存，不覆盖人工状态；不保存论文全文或模型原始回答。
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { dataPath } from '../paths.js'
import { readProjectEntries, safeProjectName } from '../execution/evidence-store.js'

const CLAIMS_DIR = dataPath('claims')
const CLAIM_STATES = new Set(['extracted', 'inferred', 'ambiguous', 'verified', 'rejected'])
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/

function fileFor(project) {
  return path.join(CLAIMS_DIR, safeProjectName(project), 'claims.json')
}

function lockFor(project) {
  return path.join(CLAIMS_DIR, safeProjectName(project), '.lock')
}

function claimId() {
  return `claim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cleanRefs(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).map(item => item.trim()).filter(Boolean).slice(0, 30))]
}

function cleanSourceRef(input) {
  if (!input || typeof input !== 'object') return undefined
  const citation = String(input.citation || '').trim().slice(0, 160)
  if (!citation) return undefined
  return {
    citation, citation_type: ['doi', 'pmid', 'arxiv'].includes(input.citation_type) ? input.citation_type : 'other',
    locator: String(input.locator || '').trim().slice(0, 120),
    excerpt: String(input.excerpt || '').trim().slice(0, 300),
  }
}

function normalizeClaim(input, existing = {}) {
  const statement = String(input.statement ?? existing.statement ?? '').trim().slice(0, 800)
  const state = String(input.state ?? existing.state ?? 'extracted').trim()
  const evidenceIds = cleanRefs(input.evidence_ids ?? existing.evidence_ids)
  const assessedBy = String(input.assessed_by ?? existing.assessed_by ?? '').trim().slice(0, 120)
  const assessmentReason = String(input.assessment_reason ?? existing.assessment_reason ?? '').trim().slice(0, 500)
  if (!statement) throw new Error('claim statement 不能为空。')
  if (!CLAIM_STATES.has(state)) throw new Error(`claim state 必须是：${[...CLAIM_STATES].join('、')}。`)
  if (state === 'verified' && (!evidenceIds.length || !assessedBy || !assessmentReason)) {
    throw new Error('verified Claim 必须提供 evidence_ids、assessed_by 与 assessment_reason；自动检索不能直接确认结论。')
  }
  if (state === 'rejected' && !assessmentReason) throw new Error('rejected Claim 必须说明 assessment_reason。')
  return { statement, state, evidence_ids: evidenceIds, assessed_by: assessedBy, assessment_reason: assessmentReason,
    source_ref: cleanSourceRef(input.source_ref ?? existing.source_ref) }
}

async function acquireLock(project) {
  const file = lockFor(project)
  await mkdir(path.dirname(file), { recursive: true })
  for (let attempt = 0; attempt < 50; attempt++) {
    try { return await open(file, 'wx') } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        const info = await stat(file)
        if (Date.now() - info.mtimeMs > 5_000) await unlink(file)
      } catch {}
      await new Promise(resolve => setTimeout(resolve, Math.min(20 + attempt * 10, 80)))
    }
  }
  throw new Error('Claim 台账正被其他进程写入，请稍后重试。')
}

async function withLock(project, run) {
  const handle = await acquireLock(project)
  try { return await run() } finally {
    await handle.close()
    try { await unlink(lockFor(project)) } catch {}
  }
}

async function readClaimsUnlocked(project) {
  const file = fileFor(project)
  if (!existsSync(file)) return []
  const parsed = JSON.parse(await readFile(file, 'utf8'))
  if (!Array.isArray(parsed?.claims)) throw new Error('Claim 台账格式无效；为避免丢失研究结论，拒绝覆盖。')
  return parsed.claims.filter(item => item && typeof item === 'object')
}

async function writeClaimsUnlocked(project, claims) {
  const file = fileFor(project)
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  await writeFile(temp, JSON.stringify({ schema_version: 1, claims }, null, 2) + '\n', 'utf8')
  await rename(temp, file)
}

export async function recordResearchClaim({ project = 'default', run_id = '', claim_id = '', ...input }) {
  const normalizedProject = safeProjectName(project)
  if (run_id && !ID_PATTERN.test(String(run_id))) throw new Error('run_id 不合法。')
  return withLock(normalizedProject, async () => {
    const claims = await readClaimsUnlocked(normalizedProject)
    const index = claim_id ? claims.findIndex(item => item.id === claim_id) : -1
    if (claim_id && index < 0) throw new Error(`Claim "${claim_id}" 不存在。`)
    const previous = index >= 0 ? claims[index] : {}
    const now = new Date().toISOString()
    const normalized = normalizeClaim(input, previous)
    if (normalized.state === 'verified') {
      const availableEvidence = new Set((await readProjectEntries(normalizedProject)).map(entry => entry.id))
      const missingEvidence = normalized.evidence_ids.filter(id => !availableEvidence.has(id))
      if (missingEvidence.length) {
        throw new Error(`verified Claim 引用了当前项目不存在的 evidence_ids：${missingEvidence.join('、')}。`)
      }
    }
    const claim = {
      ...previous,
      ...normalized,
      id: previous.id || claimId(),
      revision: (Number(previous.revision) || 0) + 1,
      project: normalizedProject,
      run_id: String(run_id || previous.run_id || '').slice(0, 120),
      created_at: previous.created_at || now,
      updated_at: now,
    }
    if (index >= 0) claims[index] = claim
    else claims.push(claim)
    await writeClaimsUnlocked(normalizedProject, claims)
    return { recorded: true, updated: index >= 0, claim }
  })
}

export async function listResearchClaims({ project = 'default', run_id = '', limit = 50 } = {}) {
  const claims = await readClaimsUnlocked(safeProjectName(project))
  const scoped = claims.filter(item => !run_id || item.run_id === run_id)
  return scoped.slice(-Math.min(Math.max(Number(limit) || 50, 1), 200)).reverse()
}

export async function recordClaimDrafts({ project = 'default', run_id = '', drafts = [] } = {}) {
  const normalizedProject = safeProjectName(project)
  if (run_id && !ID_PATTERN.test(String(run_id))) throw new Error('run_id 不合法。')
  if (!Array.isArray(drafts) || !drafts.length || drafts.length > 20) throw new Error('Claim 草稿数量必须为 1 至 20 条。')
  return withLock(normalizedProject, async () => {
    const claims = await readClaimsUnlocked(normalizedProject)
    const availableEvidence = new Set((await readProjectEntries(normalizedProject)).map(entry => entry.id))
    const known = new Set(claims.map(item => `${item.run_id}|${item.statement}|${item.source_ref?.citation || ''}`))
    const saved = [], duplicates = []
    for (const draft of drafts) {
      const normalized = normalizeClaim({ ...draft, state: 'extracted', assessed_by: '', assessment_reason: '' })
      if (normalized.evidence_ids.some(id => !availableEvidence.has(id))) throw new Error('草稿引用了当前课题不存在的证据。')
      const key = `${run_id}|${normalized.statement}|${normalized.source_ref?.citation || ''}`
      if (known.has(key)) { duplicates.push(normalized.statement); continue }
      known.add(key)
      const now = new Date().toISOString()
      const claim = { ...normalized, id: claimId(), revision: 1, project: normalizedProject, run_id: String(run_id || ''), created_at: now, updated_at: now }
      claims.push(claim)
      saved.push(claim)
    }
    if (saved.length) await writeClaimsUnlocked(normalizedProject, claims)
    return { saved, duplicates }
  })
}

export async function recordAgentClaimReviews({ project = 'default', assessments = [] } = {}) {
  const normalizedProject = safeProjectName(project)
  if (!Array.isArray(assessments) || !assessments.length || assessments.length > 6) throw new Error('Agent 审阅数量必须为 1 至 6 条。')
  return withLock(normalizedProject, async () => {
    const claims = await readClaimsUnlocked(normalizedProject)
    const byId = new Map(claims.map((claim, index) => [claim.id, index]))
    const updated = []
    for (const item of assessments) {
      const index = byId.get(item.id)
      if (index === undefined || claims[index].updated_at !== item.expected_updated_at
        || (Number(claims[index].revision) || 0) !== item.expected_revision) throw new Error('Claim 已变化，请刷新后重新运行 Agent 审阅。')
      if (['verified', 'rejected'].includes(claims[index].state)) throw new Error('已人工确认或驳回的 Claim 不接受自动覆盖。')
      if (!['ambiguous', 'inferred', 'rejected'].includes(item.suggested_state)) throw new Error('Agent 建议状态不合法。')
      const now = new Date().toISOString()
      claims[index] = { ...claims[index], agent_review: {
        suggested_state: item.suggested_state,
        reason: String(item.reason || '').trim().slice(0, 500),
        confidence: ['low', 'medium', 'high'].includes(item.confidence) ? item.confidence : 'low',
        model: String(item.model || '').slice(0, 120), at: now,
        evidence_ids: claims[index].evidence_ids || [], scope: 'metadata_and_excerpt_only',
      }, revision: (Number(claims[index].revision) || 0) + 1, updated_at: now }
      if (!claims[index].agent_review.reason) throw new Error('Agent 审阅缺少理由。')
      updated.push(claims[index])
    }
    await writeClaimsUnlocked(normalizedProject, claims)
    return updated
  })
}

export { CLAIM_STATES }
