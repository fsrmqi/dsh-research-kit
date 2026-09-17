
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CHECKPOINT_DIR = path.join(os.homedir(), '.dsh-research-kit', 'checkpoints')

function stateFile(runId) { return path.join(CHECKPOINT_DIR, `${runId}.json`) }

function loadState(runId) {
  const file = stateFile(runId)
  if (!existsSync(file)) return { run_id: runId, checkpoints: {}, created_at: new Date().toISOString() }
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return { run_id: runId, checkpoints: {}, created_at: new Date().toISOString() } }
}

async function saveState(state) {
  await mkdir(CHECKPOINT_DIR, { recursive: true })
  await writeFile(stateFile(state.run_id), JSON.stringify(state, null, 2))
}

function evaluateCheckpoints(workflow, completedStages) {
  const checkpoints = workflow.checkpoints || []
  if (!checkpoints.length) return { should_pause: false, pending_checkpoints: [] }

  const pending = []
  for (const cp of checkpoints) {
    if (cp.required && completedStages.includes(cp.after_stage) && !pending.some(p => p.after_stage === cp.after_stage)) {
      pending.push(cp)
    }
  }
  return {
    should_pause: pending.length > 0,
    pending_checkpoints: pending.map(cp => ({
      after_stage: cp.after_stage,
      action: cp.action || 'human_review',
      required: cp.required !== false,
    })),
  }
}

async function recordApproval(runId, stage, { approved_by = 'user', note } = {}) {
  const state = loadState(runId)
  state.checkpoints[stage] = {
    approved: true,
    approved_by,
    note: note || '',
    approved_at: new Date().toISOString(),
  }
  await saveState(state)
  return { approved: true, stage, run_id: runId }
}

async function getCheckpointState(runId) {
  const state = loadState(runId)
  return {
    run_id: state.run_id,
    checkpoints: state.checkpoints,
    pending: Object.entries(state.checkpoints).filter(([, v]) => !v.approved).map(([stage]) => stage),
    approved: Object.entries(state.checkpoints).filter(([, v]) => v.approved).map(([stage]) => stage),
  }
}

export { evaluateCheckpoints, recordApproval, getCheckpointState }
