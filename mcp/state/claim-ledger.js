// 科研 Claim 台账：保存研究者显式登记的短声明、认识论状态、证据 ID 与短引用锚点。
// Agent 的审阅建议独立保存，不覆盖人工状态；不保存论文全文或模型原始回答。
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { dataPath } from '../paths.js'
import { readProjectEntries, safeProjectName } from '../execution/evidence-store.js'
import { workspaceIdForProject } from '../../src/lib/research-workspaces.js'
import { normalizeResearchClaim } from '../../src/lib/research-claims.js'
import { acquireFileLock, releaseFileLock } from '../execution/file-lock.js'

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
  return [...new Set((Array.isArray(value) ? value : []).map(String).map(item => item.trim()).filter(Boolean).slice(0, 50))]
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
  const question = String(input.question ?? existing.question ?? '').trim().slice(0, 500)
  const links = normalizeResearchClaim({ statement, links: input.links ?? existing.links ?? [] }).links
  const evidenceIds = cleanRefs(input.evidence_ids ?? (input.links ? links.map(link => link.evidenceId) : existing.evidence_ids))
  const scopedLinks = links.filter(link => evidenceIds.includes(link.evidenceId))
  for (const id of evidenceIds) if (!scopedLinks.some(link => link.evidenceId === id)) scopedLinks.push({ evidenceId: id, stance: 'unassessed' })
  let assessedBy = String(input.assessed_by ?? existing.assessed_by ?? '').trim().slice(0, 120)
  let assessmentReason = String(input.assessment_reason ?? existing.assessment_reason ?? '').trim().slice(0, 500)
  const contentChanged = existing.id && (statement !== existing.statement
    || JSON.stringify(evidenceIds) !== JSON.stringify(existing.evidence_ids || [])
    || JSON.stringify(cleanSourceRef(input.source_ref ?? existing.source_ref)) !== JSON.stringify(existing.source_ref)
    || question !== (existing.question || '')
    || JSON.stringify(scopedLinks) !== JSON.stringify(existing.links || scopedLinks))
  if (existing.id && (contentChanged || state !== existing.state) && ['verified', 'rejected'].includes(state)
    && (!String(input.assessed_by || '').trim() || !String(input.assessment_reason || '').trim()
      || (state === 'verified' && !cleanRefs(input.evidence_ids).length))) {
    throw new Error('修改已核验 Claim 的内容或证据后，必须重新提供人工评估人、理由和关联证据；也可先改为待核验状态。')
  }
  if (contentChanged && !['verified', 'rejected'].includes(state)) {
    assessedBy = String(input.assessed_by || '').trim().slice(0, 120)
    assessmentReason = String(input.assessment_reason || '').trim().slice(0, 500)
  }
  if (!statement) throw new Error('claim statement 不能为空。')
  if (!CLAIM_STATES.has(state)) throw new Error(`claim state 必须是：${[...CLAIM_STATES].join('、')}。`)
  if (state === 'verified' && (!evidenceIds.length || !assessedBy || !assessmentReason)) {
    throw new Error('verified Claim 必须提供 evidence_ids、assessed_by 与 assessment_reason；自动检索不能直接确认结论。')
  }
  if (state === 'rejected' && !assessmentReason) throw new Error('rejected Claim 必须说明 assessment_reason。')
  return { statement, question, links: scopedLinks, state, evidence_ids: evidenceIds, assessed_by: assessedBy, assessment_reason: assessmentReason,
    source_ref: cleanSourceRef(input.source_ref ?? existing.source_ref) }
}

// 统一到共享实现：原先是最多 50 次退避尝试（约 3.8s），这里用同一时间预算表达。
async function acquireLock(project) {
  return acquireFileLock(lockFor(project), {
    timeoutMs: 4_000,
    staleMs: 5_000,
    busyMessage: 'Claim 台账正被其他进程写入，请稍后重试。',
  })
}

async function withLock(project, run) {
  const handle = await acquireLock(project)
  try { return await run() } finally {
    await releaseFileLock(lockFor(project), handle)
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
    if (input.expected_revision !== undefined && Number(input.expected_revision) !== (Number(previous.revision) || 0)) {
      const error = new Error('Claim 已被更新，请刷新后重试。'); error.code = 'CLAIM_CONFLICT'; throw error
    }
    const now = new Date().toISOString()
    const normalized = normalizeClaim(input, previous)
    if (normalized.state === 'verified' || input.links) {
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
    // 自动建议只适用于产生它的内容版本，不能随改写后的结论继续展示。
    if (previous.statement && (previous.statement !== claim.statement
      || JSON.stringify(previous.evidence_ids) !== JSON.stringify(claim.evidence_ids)
      || JSON.stringify(previous.source_ref) !== JSON.stringify(claim.source_ref)
      || previous.question !== claim.question || JSON.stringify(previous.links) !== JSON.stringify(claim.links))) delete claim.agent_review
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

// 浏览器采用可分页的完整台账；旧 MCP 的 200 条上限接口保持不变。
export async function researchClaimPage({ project = 'default', offset = 0, limit = 200 } = {}) {
  const rows = (await readClaimsUnlocked(safeProjectName(project))).slice().reverse()
  const start = Math.max(0, Math.floor(Number(offset) || 0))
  const size = Math.min(200, Math.max(1, Math.floor(Number(limit) || 200)))
  return { claims: rows.slice(start, start + size), total: rows.length, next_offset: start + size < rows.length ? start + size : null }
}

// 旧本地论断幂等迁移，只补缺失 ID，绝不覆盖台账里的人工判断。
export async function importLocalResearchClaims({ project = 'default', claims: incoming = [] } = {}) {
  const normalizedProject = safeProjectName(project)
  if (!Array.isArray(incoming) || incoming.length > 50) throw new Error('invalid_claim_batch')
  return withLock(normalizedProject, async () => {
    const claims = await readClaimsUnlocked(normalizedProject)
    const known = new Set(claims.map(item => item.id))
    const available = new Set((await readProjectEntries(normalizedProject)).map(item => item.id))
    let added = 0
    for (const raw of incoming) {
      if (!ID_PATTERN.test(String(raw?.id || ''))) throw new Error('invalid_claim_id')
      if (known.has(raw.id)) continue
      if (raw.links !== undefined && (!Array.isArray(raw.links) || raw.links.length > 50)) throw new Error('invalid_claim_links')
      const normalized = normalizeClaim({ statement: raw.statement, question: raw.question, links: raw.links,
        evidence_ids: (raw.links || []).map(link => link.evidenceId), state: 'extracted' })
      if (normalized.evidence_ids.some(id => !available.has(id))) throw new Error('迁移论断关联的证据不存在，请先同步证据库。')
      const now = new Date().toISOString()
      claims.push({ ...normalized, id: raw.id, project: normalizedProject, workspace_id: workspaceIdForProject(raw.project || ''), revision: 1, run_id: '',
        created_at: now, updated_at: now, origin: 'local-migration' })
      known.add(raw.id); added++
    }
    if (added) await writeClaimsUnlocked(normalizedProject, claims)
    return { added }
  })
}

export async function listClaimProjects() {
  if (!existsSync(CLAIMS_DIR)) return []
  return (await readdir(CLAIMS_DIR, { withFileTypes: true })).filter(row => row.isDirectory()).map(row => row.name)
}

// 项目整理与 Claim 写入遵循相同锁序：先 Claim，再证据，避免互等。
export async function withClaimProjectLocks(projects, run) {
  const names = [...new Set(projects.map(safeProjectName))].sort()
  const walk = async index => index === names.length ? run() : withLock(names[index], () => walk(index + 1))
  return walk(0)
}
export async function readClaimProjectSnapshot(project) { return readClaimsUnlocked(project) }
export async function writeClaimProjectSnapshot(project, claims) { return writeClaimsUnlocked(project, claims) }
