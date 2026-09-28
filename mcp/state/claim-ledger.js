// 科研 Claim 台账：只保存研究者显式登记的短声明、认识论状态和证据 ID。
// 不保存论文全文、检索词或模型原始回答；任何自动检索都不能把状态推进为 verified。
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
  return { statement, state, evidence_ids: evidenceIds, assessed_by: assessedBy, assessment_reason: assessmentReason }
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

export { CLAIM_STATES }
