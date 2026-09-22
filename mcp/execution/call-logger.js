
import { appendFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { setImmediate as waitForBatch } from 'node:timers/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { dataPath } from '../paths.js'
import { artifactKindOf } from '../tool-registry.js'

const LOG_DIR = dataPath('logs')
const LOG_FILE = path.join(LOG_DIR, 'calls.jsonl')
const ROTATED_FILE = `${LOG_FILE}.1`
const MAX_LOG_SIZE = 5 * 1024 * 1024

let writeQueue = Promise.resolve()
let ensuredDir
let knownLogSize = null
let flushScheduled = false
let pendingLines = []
const parsedLogCache = new Map()

// 只允许结构化、非敏感字段落盘。新增参数默认不记录，避免口令或研究内容因漏加黑名单而泄露。
const LOGGABLE_PARAM_KEYS = new Set([
  'workflow_id', 'route', 'include_all_routes', 'category', 'type', 'limit', 'source_id', 'source_ids',
  'per_source_limit', 'verify_identifiers', 'save_to_evidence', 'project', 'run_id', 'identifier_type',
  'grade', 'offset', 'mode', 'fields', 'evidence_id', 'asset_id', 'style', 'dpi', 'apa_style', 'layout',
  'stage', 'max_claims', 'max_lookups', 'target_journal', 'tool_name', 'include_references',
])

async function ensureDir() {
  ensuredDir ||= existsSync(LOG_DIR) ? Promise.resolve() : mkdir(LOG_DIR, { recursive: true })
  await ensuredDir
}

function summarizeParams(params) {
  if (!params || typeof params !== 'object') return null
  const safe = {}
  for (const [key, value] of Object.entries(params).slice(0, 20)) {
    if (!LOGGABLE_PARAM_KEYS.has(key)) continue
    if (Array.isArray(value)) {
      safe[key] = `[${value.length} items]`
    } else if (value && typeof value === 'object') {
      safe[key] = '[object]'
    } else {
      safe[key] = String(value).slice(0, 120)
    }
  }
  return JSON.stringify(safe).slice(0, 500)
}

async function appendLogLine(line) {
  await ensureDir()
  const lineSize = Buffer.byteLength(line)
  if (knownLogSize === null) {
    try { knownLogSize = (await stat(LOG_FILE)).size } catch { knownLogSize = 0 }
  }
  try {
    if (knownLogSize + lineSize > MAX_LOG_SIZE) {
      try { await unlink(ROTATED_FILE) } catch {}
      await rename(LOG_FILE, ROTATED_FILE)
      knownLogSize = 0
      parsedLogCache.delete(ROTATED_FILE)
    }
  } catch {}
  await appendFile(LOG_FILE, line, 'utf8')
  knownLogSize += lineSize
  parsedLogCache.delete(LOG_FILE)
}

function enqueueLogLine(line) {
  pendingLines.push(line)
  if (flushScheduled) return
  flushScheduled = true
  writeQueue = writeQueue.then(async () => {
    await waitForBatch()
    const batch = pendingLines.join('')
    pendingLines = []
    flushScheduled = false
    if (batch) await appendLogLine(batch)
  }).catch(() => { flushScheduled = false })
}

function logCall({ tool, params, result, duration_ms, error }) {
  const entry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    tool: String(tool || 'unknown'),
    artifact_kind: artifactKindOf(tool),
    // 运行标识是关联键，不是研究内容；单列保存，活动路由不需要解析已脱敏的 params。
    run_id: typeof params?.run_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(params.run_id) ? params.run_id : '',
    params: summarizeParams(params),
    ok: !error,
    error: error ? String(error).slice(0, 300) : null,
    result_summary: summarizeResult(result),
    duration_ms: duration_ms || 0,
    at: new Date().toISOString(),
  }
  enqueueLogLine(JSON.stringify(entry) + '\n')
}

function summarizeResult(result) {
  if (!result) return null
  try {
    const data = result?.data ?? result
    if (Array.isArray(data?.sources)) return `${data.sources.length} results`
    if (data?.saved !== undefined) return data.saved ? `saved:${data.id}` : `dedup:${data.id}`
    if (data?.workflows) return `${data.workflows.length} workflows`
    if (data?.prompt) return `prompt:${String(data.prompt).length} chars`
    if (data?.exists !== undefined) return `exists:${data.exists}${data.claim_supported !== undefined ? `,supported:${data.claim_supported}` : ''}`
    if (data?.grade) return `grade:${data.grade}`
    if (data?.script) return `script:${String(data.script).length} chars`
    if (data?.entries) return `${data.entries.length} entries`
    if (data?.run_id) return `passport:${data.run_id}`
    if (data?.styles) return `${data.styles.length} styles`
    if (data?.approved) return `approved:${data.stage}`
    if (data?.checkpoints) return `checkpoints:${Object.keys(data.checkpoints).length}`
    return 'ok'
  } catch {
    return 'ok'
  }
}

async function parseLogRecords(file) {
  if (!existsSync(file)) return []
  try {
    const info = await stat(file)
    const cached = parsedLogCache.get(file)
    if (cached?.size === info.size && cached?.mtimeMs === info.mtimeMs) return cached.records
    const raw = await readFile(file, 'utf8')
    const records = raw.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
    parsedLogCache.set(file, { size: info.size, mtimeMs: info.mtimeMs, records })
    return records
  } catch {
    return []
  }
}

async function readCallLogs({ limit = 50, tool, since, runId } = {}) {
  await writeQueue
  const rotated = await parseLogRecords(ROTATED_FILE)
  const current = await parseLogRecords(LOG_FILE)
  let records = [...rotated, ...current]
  if (tool) records = records.filter(record => record.tool === tool)
  if (since) records = records.filter(record => record.at > since)
  if (runId) records = records.filter(record => record.run_id === runId)
  return records.slice(-Math.min(limit, 200)).reverse()
}

export { logCall, readCallLogs }
