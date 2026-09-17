
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CHECKPOINT_DIR = path.join(os.homedir(), '.dsh-research-kit', 'checkpoints')
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function assertId(value, label) {
  if (!ID_PATTERN.test(String(value || ''))) throw new Error(`${label} 不合法。`)
}

function stateFile(runId) {
  assertId(runId, 'run_id')
  return path.join(CHECKPOINT_DIR, `${runId}.json`)
}

function emptyState(runId) {
  return { run_id: runId, checkpoints: {}, created_at: new Date().toISOString() }
}

async function loadState(runId) {
  const file = stateFile(runId)
  if (!existsSync(file)) return emptyState(runId)
  try {
    const state = JSON.parse(await readFile(file, 'utf8'))
    if (!state || typeof state !== 'object' || state.run_id !== runId) return emptyState(runId)
    return { ...emptyState(runId), ...state, checkpoints: state.checkpoints || {} }
  } catch {
    return emptyState(runId)
  }
}

async function saveState(state) {
  await mkdir(CHECKPOINT_DIR, { recursive: true })
  await writeFile(stateFile(state.run_id), JSON.stringify(state, null, 2), 'utf8')
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
  return getCheckpointState(runId)
}

async function recordApproval(runId, stage, { approved_by = 'user', note } = {}) {
  assertId(runId, 'run_id')
  assertId(stage, 'stage')
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
}

async function getCheckpointState(runId) {
  assertId(runId, 'run_id')
  const state = await loadState(runId)
  const entries = Object.entries(state.checkpoints)
  return {
    run_id: state.run_id,
    checkpoints: state.checkpoints,
    pending: entries.filter(([, value]) => !value.approved).map(([stage]) => stage),
    approved: entries.filter(([, value]) => value.approved).map(([stage]) => stage),
  }
}

export { evaluateCheckpoints, initializeCheckpoints, recordApproval, getCheckpointState }
