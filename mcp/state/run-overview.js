
// run 总览的状态聚合层：run 列表没有单独的注册表文件，
// 以 passports 与 checkpoints 目录的并集为事实源，mtime 作为活跃度排序。
// 该模块只读，供 research_run_status 工具使用。

import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadPassport } from './material-passport.js'

const PASSPORT_DIR = path.join(os.homedir(), '.dsh-research-kit', 'passports')
const CHECKPOINT_DIR = path.join(os.homedir(), '.dsh-research-kit', 'checkpoints')
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/

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

export { listRecentRuns }
