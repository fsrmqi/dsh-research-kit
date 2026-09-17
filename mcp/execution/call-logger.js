
import { appendFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const LOG_DIR = path.join(os.homedir(), '.dsh-research-kit', 'logs')
const LOG_FILE = path.join(LOG_DIR, 'calls.jsonl')
const ROTATED_FILE = `${LOG_FILE}.1`
const MAX_LOG_SIZE = 5 * 1024 * 1024

let writeQueue = Promise.resolve()

const SENSITIVE_PARAM_KEYS = new Set(['text', 'claim', 'note', 'passport_yaml', 'params'])

async function ensureDir() {
  if (!existsSync(LOG_DIR)) await mkdir(LOG_DIR, { recursive: true })
}

function summarizeParams(params) {
  if (!params || typeof params !== 'object') return null
  const safe = {}
  for (const [key, value] of Object.entries(params).slice(0, 20)) {
    if (SENSITIVE_PARAM_KEYS.has(key)) {
      safe[key] = '[redacted]'
    } else if (Array.isArray(value)) {
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
  try {
    const info = await stat(LOG_FILE)
    if (info.size + Buffer.byteLength(line) > MAX_LOG_SIZE) {
      try { await unlink(ROTATED_FILE) } catch {}
      await rename(LOG_FILE, ROTATED_FILE)
    }
  } catch {}
  await appendFile(LOG_FILE, line, 'utf8')
}

function enqueueLogLine(line) {
  writeQueue = writeQueue.then(() => appendLogLine(line)).catch(() => {})
  return writeQueue
}

async function logCall({ tool, params, result, duration_ms, error }) {
  const entry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    tool: String(tool || 'unknown'),
    params: summarizeParams(params),
    ok: !error,
    error: error ? String(error).slice(0, 300) : null,
    result_summary: summarizeResult(result),
    duration_ms: duration_ms || 0,
    at: new Date().toISOString(),
  }
  await enqueueLogLine(JSON.stringify(entry) + '\n')
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

async function readCallLogs({ limit = 50, tool, since } = {}) {
  if (!existsSync(LOG_FILE)) return []
  try {
    const raw = await readFile(LOG_FILE, 'utf8')
    let records = raw.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
    if (tool) records = records.filter(record => record.tool === tool)
    if (since) records = records.filter(record => record.at > since)
    return records.slice(-Math.min(limit, 200)).reverse()
  } catch {
    return []
  }
}

export { logCall, readCallLogs }
