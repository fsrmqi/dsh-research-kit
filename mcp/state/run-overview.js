
// run 总览的状态聚合层：run 列表没有单独的注册表文件，
// 以 passports 与 checkpoints 目录的并集为事实源，mtime 作为活跃度排序。
// 该模块只读，供 research_run_status 工具使用。
//
// 阶段状态机（ROADMAP P2-6）：workflow.checkpoints 的 after_stage 只标记「需要暂停的闸门」，
// 完整阶段序列不在目录里声明。这里把 checkpoint 位置翻译成阶段推进语义：
//   current_stage     护照记录的当前阶段
//   completed_stages  checkpoint 已批准的阶段（人工放行即视为该阶段完成）
//   next_stage        第一个未批准闸门的 after_stage（无闸门时为 null，由调用方自定下一步）

import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { dataPath } from '../paths.js'
import { loadPassport } from './material-passport.js'
import { itemById } from '../../src/catalog.js'

const PASSPORT_DIR = dataPath('passports')
const CHECKPOINT_DIR = dataPath('checkpoints')
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/

// 按工作流 checkpoint 顺序推导阶段推进：已批准的闸门即已完成的阶段，
// 第一个未批准闸门的 after_stage 是下一个待执行阶段。
function deriveStageProgress(workflow, checkpointState) {
  const gates = Array.isArray(workflow?.checkpoints) ? workflow.checkpoints : []
  if (!gates.length) return null
  const approved = new Set(checkpointState?.approved || [])
  const pending = (checkpointState?.pending || [])
  const ordered = [...gates].sort((a, b) => String(a.after_stage).localeCompare(String(b.after_stage)))
  const completed = ordered.map(gate => String(gate.after_stage)).filter(stage => approved.has(stage))
  const nextGate = ordered.find(gate => !approved.has(String(gate.after_stage)))
  return {
    completed_stages: completed,
    pending_stage: pending[0] || null,
    next_stage: nextGate ? String(nextGate.after_stage) : null,
    workflow_completed: !nextGate,
  }
}

async function listRunIdsWithMtime(dir, suffix) {
  if (!existsSync(dir)) return []
  const files = (await readdir(dir)).filter(file => file.endsWith(suffix))
  return Promise.all(files.map(async file => {
    const runId = file.slice(0, -suffix.length)
    if (!RUN_ID_PATTERN.test(runId)) return null
    try {
      const info = await stat(path.join(dir, file))
      return { runId, mtimeMs: info.mtimeMs }
    } catch {
      return null
    }
  }))
}

// 最近活跃的 run 摘要列表：护照提供 project/current_stage/workflow_id，
// checkpoint 状态提供 pending 数；两者缺一时优雅降级。
async function listRecentRuns({ limit = 10, runId } = {}) {
  const [passportEntries, checkpointEntries] = await Promise.all([
    listRunIdsWithMtime(PASSPORT_DIR, '.yaml'),
    listRunIdsWithMtime(CHECKPOINT_DIR, '.json'),
  ])
  const byRun = new Map()
  for (const entry of [...passportEntries, ...checkpointEntries]) {
    if (!entry) continue
    if (runId && entry.runId !== runId) continue
    const existing = byRun.get(entry.runId)
    if (!existing || entry.mtimeMs > existing.mtimeMs) byRun.set(entry.runId, entry)
  }
  const ordered = [...byRun.values()].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, Math.min(limit, 50))

  return Promise.all(ordered.map(async ({ runId: id, mtimeMs }) => {
    const [passport, checkpoint] = await Promise.all([
      loadPassport(id).catch(() => null),
      readCheckpointSummary(id).catch(() => null),
    ])
    return {
      run_id: id,
      project: passport?.project || 'unknown',
      current_stage: passport?.current_stage || 'unknown',
      workflow_id: passport?.workflow_id || passport?.pending?.[0]?.workflow_id || '',
      pending_checkpoints: checkpoint ? checkpoint.pending.length : null,
      updated_at: new Date(mtimeMs).toISOString(),
    }
  }))
}

async function readCheckpointSummary(runId) {
  if (!RUN_ID_PATTERN.test(String(runId || ''))) return null
  const file = path.join(CHECKPOINT_DIR, `${runId}.json`)
  if (!existsSync(file)) return null
  const state = JSON.parse(await readFile(file, 'utf8'))
  const entries = Object.entries(state.checkpoints || {})
  return {
    pending: entries.filter(([, value]) => !value?.approved).map(([stage]) => stage),
    approved: entries.filter(([, value]) => value?.approved).map(([stage]) => stage),
  }
}

// 单个 run 的完整状态聚合（ passports + checkpoints + workflow 目录 ），不读日志与证据，
// 供 research_run_status 的 run_id 分支与 UI 概览复用。
async function buildRunOverview(runId) {
  const [passport, checkpoint] = await Promise.all([
    loadPassport(runId).catch(() => null),
    readCheckpointSummary(runId).catch(() => null),
  ])
  const workflowId = passport?.workflow_id || passport?.pending?.[0]?.workflow_id || ''
  const workflow = workflowId ? itemById(workflowId) : null
  const stageProgress = workflow ? deriveStageProgress(workflow, checkpoint) : null
  return {
    run_id: runId,
    passport_found: Boolean(passport),
    project: passport?.project || 'unknown',
    current_stage: passport?.current_stage || 'unknown',
    workflow_id: workflowId || null,
    workflow_name: workflow?.name || null,
    checkpoint_state: checkpoint || { pending: [], approved: [] },
    stage_progress: stageProgress,
    status: checkpoint?.pending?.length ? 'waiting_review' : 'active',
  }
}

export { listRecentRuns, buildRunOverview }
