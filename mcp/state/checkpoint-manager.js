
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CHECKPOINT_DIR = path.join(os.homedir(), '.dsh-research-kit', 'checkpoints')
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
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

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function acquireLock(runId) {
  const file = lockFile(runId)
  await mkdir(CHECKPOINT_DIR, { recursive: true })
  const startedAt = Date.now()
  for (let attempt = 0; Date.now() - startedAt < LOCK_TIMEOUT_MS; attempt++) {
    try {
      return await open(file, 'wx')
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        const info = await stat(file)
        // 用 rename 接管陈旧锁：只有 rename 成功的进程成为接管者，
        // 避免 stat→unlink→open 之间另一个等待者插入并拿到新锁。
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rename(file, `${file}.stale-${process.pid}-${Date.now().toString(36)}`)
        }
      } catch {}
      await sleep(Math.min(20 + attempt * 10, 80))
    }
  }
  throw new Error('检查点状态正被其他进程写入，请稍后重试。')
}

async function withRunLock(runId, run) {
  const token = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const handle = await acquireLock(runId)
  await handle.writeFile(token)
  await handle.close()
  try {
    return await run()
  } finally {
    // 只删自己那把锁：持锁超时被接管后，不得删掉接管者的锁。
    try {
      if ((await readFile(lockFile(runId), 'utf8')) === token) await unlink(lockFile(runId))
    } catch {}
  }
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

async function saveState(state) {
  await mkdir(CHECKPOINT_DIR, { recursive: true })
  const target = stateFile(state.run_id)
  const temp = `${target}.${process.pid}.${Date.now().toString(36)}.tmp`
  await writeFile(temp, JSON.stringify(state, null, 2), 'utf8')
  await rename(temp, target)
}

function describeState(state) {
  const entries = Object.entries(state.checkpoints)
  return {
    run_id: state.run_id,
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
    const state = await loadState(runId)
    const { pending_checkpoints } = evaluateCheckpoints(workflow, completedStages)
    for (const checkpoint of pending_checkpoints) {
      if (!state.checkpoints[checkpoint.after_stage]) {
        state.checkpoints[checkpoint.after_stage] = {
          approved: false,
          action: checkpoint.action,
          required: checkpoint.required,
          created_at: new Date().toISOString(),
        }
      }
    }
    state.updated_at = new Date().toISOString()
    await saveState(state)
    return describeState(state)
  })
}

async function recordApproval(runId, stage, { approved_by = 'user', note } = {}) {
  assertId(runId, 'run_id')
  assertId(stage, 'stage')
  return withRunLock(runId, async () => {
    const state = await loadState(runId)
    const checkpoint = state.checkpoints[stage]
    if (!checkpoint) {
      const error = new Error(`检查点 "${stage}" 不存在于运行 "${runId}"。`)
      error.code = 'CHECKPOINT_NOT_FOUND'
      throw error
    }
    state.checkpoints[stage] = {
      ...checkpoint,
      approved: true,
      approved_by: String(approved_by || 'user').slice(0, 80),
      note: String(note || '').slice(0, 500),
      approved_at: new Date().toISOString(),
    }
    state.updated_at = new Date().toISOString()
    await saveState(state)
    return { approved: true, stage, run_id: runId }
  })
}

async function getCheckpointState(runId) {
  assertId(runId, 'run_id')
  return describeState(await loadState(runId))
}

export { evaluateCheckpoints, initializeCheckpoints, recordApproval, getCheckpointState }
