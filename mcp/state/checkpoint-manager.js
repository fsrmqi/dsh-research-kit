
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { dataPath } from '../paths.js'
import { acquireFileLock, releaseFileLock } from '../execution/file-lock.js'
import {
  appendFact,
  digest,
  factsFile,
  makeFact,
  readFacts,
  replayFacts,
} from './checkpoint-facts.js'

const CHECKPOINT_DIR = dataPath('checkpoints')
// 与 Material Passport 的 run_id 契约一致：允许点号，拒绝路径分隔符。
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/
const LOCK_TIMEOUT_MS = 5_000
const LOCK_STALE_MS = 10_000

function assertId(value, label) {
  if (!ID_PATTERN.test(String(value || ''))) throw new Error(`${label} 不合法。`)
}

function stateFile(runId) {
  assertId(runId, 'run_id')
  return path.join(CHECKPOINT_DIR, `${runId}.json`)
}

function lockFile(runId) {
  assertId(runId, 'run_id')
  return path.join(CHECKPOINT_DIR, `${runId}.lock`)
}

async function acquireLock(runId) {
  return acquireFileLock(lockFile(runId), {
    timeoutMs: LOCK_TIMEOUT_MS,
    staleMs: LOCK_STALE_MS,
    emptyGraceMs: 2_000,
    busyMessage: '检查点状态正被其他进程写入，请稍后重试。',
  })
}

async function withRunLock(runId, run) {
  const handle = await acquireLock(runId)
  try { return await run() }
  finally { await releaseFileLock(lockFile(runId), handle) }
}

function emptyState(runId) {
  return { run_id: runId, checkpoints: {}, created_at: new Date().toISOString() }
}

function corruptStateError(runId, detail, cause) {
  const error = new Error(
    `检查点状态已损坏（run ${runId}）：${detail}。为避免人工闸门被绕过，拒绝读写；` +
    `请检查或重建 ${stateFile(runId)}。`,
  )
  error.code = 'CHECKPOINT_STATE_CORRUPT'
  error.cause = cause
  return error
}

async function loadState(runId) {
  const file = stateFile(runId)
  if (!existsSync(file)) return emptyState(runId)
  const raw = await readFile(file, 'utf8')
  let state
  try {
    state = JSON.parse(raw)
  } catch (cause) {
    throw corruptStateError(runId, 'JSON 无法解析', cause)
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw corruptStateError(runId, '顶层不是对象')
  }
  if (state.run_id !== runId) {
    throw corruptStateError(runId, `run_id 不匹配（文件里是 ${JSON.stringify(state.run_id)}）`)
  }
  return { ...emptyState(runId), ...state, checkpoints: state.checkpoints || {} }
}

// 投影文件缺失是合法状态（全新 run，或投影尚未落盘），损坏不是：
// 前者可以按事实重放补出来，后者意味着有人动过文件，继续读下去闸门就可能被绕过。
async function readProjection(runId) {
  const file = stateFile(runId)
  if (!existsSync(file)) return null
  return loadState(runId)
}

async function saveState(state) {
  await mkdir(CHECKPOINT_DIR, { recursive: true })
  const target = stateFile(state.run_id)
  const temp = `${target}.${process.pid}.${Date.now().toString(36)}.tmp`
  await writeFile(temp, JSON.stringify(state, null, 2), 'utf8')
  await rename(temp, target)
}

function conflictError(runId, expected, actual) {
  const error = new Error(
    `检查点状态已被别的写入推进（run ${runId}）：期望 seq ${expected}，实际 ${actual}。` +
    '请重新读取后再提交，不要用旧快照覆盖别人的放行。',
  )
  error.code = 'CHECKPOINT_CONFLICT'
  error.expected_seq = expected
  error.current_seq = actual
  return error
}

function factsBehindError(runId, projectionSeq, factsSeq, detail) {
  const error = new Error(
    `检查点事实日志落后于投影（run ${runId}）：投影 seq ${projectionSeq}，事实 seq ${factsSeq}${detail ? `，${detail}` : ''}。` +
    `事实是权威来源，投影不该领先；拒绝按可能被截断的日志继续，请检查 ${factsFile(runId)}。`,
  )
  error.code = 'CHECKPOINT_FACTS_BEHIND'
  return error
}

// 权威状态：有事实就按事实重放，没有事实才退回读投影（旧格式兼容）。
// 投影落后（进程在「事实已落盘、投影未写」之间被强杀）不报错，直接按事实补齐——
// 那是崩溃恢复，不是篡改：投影缺失或更旧都不会让任何一道闸门被放行。
async function loadAuthoritative(runId) {
  const { facts } = await readFacts(runId)
  const projection = await readProjection(runId)
  if (!facts.length) {
    return { state: projection || emptyState(runId), facts, seq: 0, recovered: false }
  }
  const replayed = replayFacts(runId, facts)
  const projectionSeq = Number(projection?.seq || 0)
  if (projectionSeq > replayed.seq) {
    throw factsBehindError(runId, projectionSeq, replayed.seq, '事实日志可能被截断')
  }
  if (!projection || projectionSeq < replayed.seq) {
    return { state: replayed, facts, seq: replayed.seq, recovered: true }
  }
  return { state: projection, facts, seq: projectionSeq, recovered: false }
}

// 升级路径：老版本只写过投影、没有事实。第一次要追加事实前先把既有条目原样补成事实，
// 否则重放会以「事实里有什么」为准，把老版本已放行/已建好的闸门整批丢掉。
async function backfillFromProjection(runId, authoritative) {
  if (authoritative.facts.length) return authoritative
  const entries = Object.entries(authoritative.state.checkpoints || {})
  if (!entries.length) return authoritative
  let current = authoritative
  for (const [stage, value] of entries) {
    const { fact, state } = await commit(runId, current, {
      type: value?.approved ? 'checkpoint.approved' : 'checkpoint.initialized',
      stage,
      attempt: 1,
      data: value,
    })
    current = { ...current, facts: [...current.facts, fact], state, seq: state.seq }
  }
  return current
}

// 一次推进 = 先追加事实（权威），再按全部事实重放写投影（快照）。
// 顺序不能反：投影先写而事实没落盘，会凭空多出一道闸门；事实先写而投影没落盘，只是快照落后。
async function commit(runId, authoritative, { type, stage, data, receiptDigest, attempt }) {
  const at = new Date().toISOString()
  const fact = makeFact({
    runId,
    seq: authoritative.seq + 1,
    type,
    stage,
    data,
    receiptDigest,
    prevDigest: authoritative.facts.at(-1)?.digest || null,
    at,
    attempt,
  })
  await appendFact(runId, fact)
  const state = replayFacts(runId, [...authoritative.facts, fact])
  await saveState(state)
  return { fact, state }
}

function describeState(state) {
  const entries = Object.entries(state.checkpoints)
  return {
    run_id: state.run_id,
    seq: Number(state.seq || 0),
    checkpoints: state.checkpoints,
    pending: entries.filter(([, value]) => !value.approved).map(([stage]) => stage),
    approved: entries.filter(([, value]) => value.approved).map(([stage]) => stage),
  }
}

function evaluateCheckpoints(workflow, completedStages = []) {
  const checkpoints = Array.isArray(workflow?.checkpoints) ? workflow.checkpoints : []
  const completed = new Set(completedStages.map(String))
  const pending = checkpoints.filter(checkpoint =>
    checkpoint?.required !== false && completed.has(String(checkpoint.after_stage))
  )
  return {
    should_pause: pending.length > 0,
    pending_checkpoints: pending.map(checkpoint => ({
      after_stage: String(checkpoint.after_stage),
      action: checkpoint.action || 'human_review',
      required: checkpoint.required !== false,
    })),
  }
}

async function initializeCheckpoints(runId, workflow, completedStages = []) {
  assertId(runId, 'run_id')
  return withRunLock(runId, async () => {
    let authoritative = await backfillFromProjection(runId, await loadAuthoritative(runId))
    const { pending_checkpoints } = evaluateCheckpoints(workflow, completedStages)
    for (const checkpoint of pending_checkpoints) {
      if (authoritative.state.checkpoints[checkpoint.after_stage]) continue
      const at = new Date().toISOString()
      const { fact, state } = await commit(runId, authoritative, {
        type: 'checkpoint.initialized',
        stage: checkpoint.after_stage,
        attempt: 1,
        data: {
          approved: false,
          action: checkpoint.action,
          required: checkpoint.required,
          created_at: at,
        },
      })
      authoritative = { ...authoritative, facts: [...authoritative.facts, fact], state, seq: state.seq }
    }
    // 即使这次没有新增闸门也要落一次投影：run 列表用「检查点文件是否存在」区分
    // 「这个 run 有检查点跟踪」与「不跟踪」（run-overview 里 pending 为 null）。
    authoritative.state.updated_at = new Date().toISOString()
    await saveState(authoritative.state)
    return describeState(authoritative.state)
  })
}

async function recordApproval(runId, stage, { approved_by = 'user', note, evidence_ids, validation_summary, expected_seq } = {}) {
  assertId(runId, 'run_id')
  assertId(stage, 'stage')
  return withRunLock(runId, async () => {
    const authoritative = await backfillFromProjection(runId, await loadAuthoritative(runId))
    if (expected_seq !== undefined && Number(expected_seq) !== authoritative.seq) {
      throw conflictError(runId, expected_seq, authoritative.seq)
    }
    const state = authoritative.state
    const checkpoint = state.checkpoints[stage]
    if (!checkpoint) {
      const error = new Error(`检查点 "${stage}" 不存在于运行 "${runId}"。`)
      error.code = 'CHECKPOINT_NOT_FOUND'
      throw error
    }
    const evidenceIds = [...new Set((Array.isArray(evidence_ids) ? evidence_ids : [])
      .map(String).map(value => value.trim()).filter(Boolean).slice(0, 30))]
    const summary = String(validation_summary || '').trim().slice(0, 500)
    const approvalDigest = digest({
      run_id: runId,
      stage: String(stage),
      approved_by: String(approved_by || 'user').slice(0, 80),
      note: String(note || '').slice(0, 500),
      evidence_ids: evidenceIds,
      validation_summary: summary,
    })
    const previous = [...authoritative.facts].reverse()
      .find(fact => fact.type === 'checkpoint.approved' && fact.stage === String(stage))
    // 同内容重试（客户端超时后重发）不追加事实：追加会让「放行过几次」这条审计信息失真。
    if (previous && previous.receipt_digest === approvalDigest) {
      return {
        approved: true,
        stage,
        run_id: runId,
        idempotent: true,
        seq: authoritative.seq,
        ...(checkpoint.validation_receipt ? { validation_receipt: checkpoint.validation_receipt } : {}),
      }
    }
    const at = new Date().toISOString()
    const receipt = evidenceIds.length || summary
      ? {
          schema_version: 1,
          receipt_id: `research-checkpoint:${runId}:${stage}:${Date.now().toString(36)}`,
          status: 'approved',
          evidence_ids: evidenceIds,
          validation_summary: summary,
          approved_by: String(approved_by || 'user').slice(0, 80),
          recorded_at: at,
        }
      : undefined
    const attempt = authoritative.facts.filter(fact =>
      fact.type === 'checkpoint.approved' && fact.stage === String(stage)).length + 1
    const { fact, state: next } = await commit(runId, authoritative, {
      type: 'checkpoint.approved',
      stage,
      receiptDigest: approvalDigest,
      attempt,
      data: {
        approved: true,
        approved_by: String(approved_by || 'user').slice(0, 80),
        note: String(note || '').slice(0, 500),
        approved_at: at,
        ...(receipt ? { validation_receipt: receipt } : {}),
      },
    })
    return {
      approved: true,
      stage,
      run_id: runId,
      seq: next.seq,
      attempt,
      fact_seq: fact.seq,
      ...(receipt ? { validation_receipt: receipt } : {}),
    }
  })
}

async function getCheckpointState(runId) {
  assertId(runId, 'run_id')
  return describeState((await loadAuthoritative(runId)).state)
}

// run-why：把「这次为什么停在这里」变成一条可读时间线。
// 只读，不加锁也不写盘：出问题时正是靠它解释状态，它自己不能有副作用。
async function explainRun(runId) {
  assertId(runId, 'run_id')
  const { facts, truncated, exists } = await readFacts(runId)
  let projection = null
  let projectionError = null
  try {
    projection = await readProjection(runId)
  } catch (error) {
    projectionError = error.code || 'CHECKPOINT_STATE_CORRUPT'
  }
  const replayed = facts.length ? replayFacts(runId, facts) : null
  const projectionSeq = Number(projection?.seq || 0)
  return {
    run_id: runId,
    facts_file: factsFile(runId),
    facts_exists: exists,
    fact_count: facts.length,
    facts_truncated: truncated,
    seq: replayed?.seq || 0,
    projection_seq: projectionSeq,
    consistent: !projectionError && (!replayed || projectionSeq === replayed.seq),
    ...(projectionError ? { projection_error: projectionError } : {}),
    events: facts.map(fact => ({
      seq: fact.seq,
      type: fact.type,
      stage: fact.stage,
      at: fact.at,
      attempt: fact.attempt,
      receipt_digest: fact.receipt_digest,
      digest: fact.digest,
    })),
  }
}

export { evaluateCheckpoints, explainRun, initializeCheckpoints, recordApproval, getCheckpointState }
