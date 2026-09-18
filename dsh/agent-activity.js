
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { recordApproval } from '../mcp/state/checkpoint-manager.js'

export const AGENT_ACTIVITY_PATH = '/dsh-research-kit/agent-activity'

const LOG_FILE = path.join(os.homedir(), '.dsh-research-kit', 'logs', 'calls.jsonl')
const CHECKPOINT_DIR = path.join(os.homedir(), '.dsh-research-kit', 'checkpoints')
const MAX_TAIL_BYTES = 512 * 1024
const MAX_CHECKPOINT_FILES = 20

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => {
      data += chunk
      if (data.length > 32 * 1024) {
        reject(new Error('body_too_large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(data)) } catch { reject(new Error('invalid_json')) }
    })
    req.on('error', reject)
  })
}

async function readCallLogs({ limit = 50, since, runId } = {}) {
  if (!existsSync(LOG_FILE)) return []
  let handle
  try {
    handle = await open(LOG_FILE, 'r')
    const info = await handle.stat()
    const size = info.size
    const length = Math.min(size, MAX_TAIL_BYTES)
    const position = size - length
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, position)
    let text = buffer.toString('utf8')
    // 只读文件尾部时，第一行可能是半行；直接丢弃，避免把截断 JSON 当作有效记录。
    if (position > 0 && text.includes('\n')) text = text.slice(text.indexOf('\n') + 1)
    const records = text.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
    const sinceFiltered = since ? records.filter(record => record.at > since) : records
    const filtered = runId ? sinceFiltered.filter(record => record.run_id === runId) : sinceFiltered
    return filtered.slice(-Math.min(limit, 200)).reverse()
  } catch {
    return []
  } finally {
    await handle?.close()
  }
}

async function readCheckpoints(runId) {
  if (!existsSync(CHECKPOINT_DIR)) return []
  try {
    const files = (await readdir(CHECKPOINT_DIR)).filter(file => file.endsWith('.json'))
    const loaded = await Promise.all(files.map(async file => {
      try {
        const full = path.join(CHECKPOINT_DIR, file)
        const [state, info] = await Promise.all([readFile(full, 'utf8'), stat(full)])
        return { state: JSON.parse(state), mtime: info.mtimeMs }
      } catch { return null }
    }))
    return loaded
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_CHECKPOINT_FILES)
      .map(item => item.state)
      .filter(state => !runId || state.run_id === runId)
  } catch {
    return []
  }
}

export function agentActivityRoute({ logger } = {}) {
  return {
    kind: 'exact', path: AGENT_ACTIVITY_PATH,
    async handler(req, res) {
      try {
        if (req.method === 'GET') {
          const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`)
          const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit'), 10) || 50, 200))
          const since = url.searchParams.get('since') || null
          const runId = url.searchParams.get('run_id') || ''
          if (runId && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(runId)) return reply(res, 400, { ok: false, error: 'invalid_run_id' })
          const [calls, checkpoints] = await Promise.all([
            readCallLogs({ limit, since, runId }),
            readCheckpoints(runId),
          ])
          // 产物是调用日志的只读投影，避免为摘要再维护一份可能漂移的存储。
          const artifacts = calls.filter(call => call.ok !== false && call.artifact_kind).map(call => ({
            id: call.id, kind: call.artifact_kind, tool: call.tool, summary: call.result_summary, at: call.at,
          }))
          return reply(res, 200, { ok: true, calls, checkpoints, artifacts })
        }

        if (req.method === 'POST') {
          const body = await readBody(req)
          if (body?.action !== 'research_run_checkpoint_approve') {
            return reply(res, 400, { ok: false, error: 'unsupported_action' })
          }
          const result = await recordApproval(body.run_id, body.stage, { note: body.note })
          return reply(res, 200, { ok: true, result })
        }

        return reply(res, 405, { ok: false, error: 'method_not_allowed' })
      } catch (error) {
        try { logger?.warn?.(`agent-activity error: ${error?.message || error}`) } catch {}
        const status = error?.code === 'CHECKPOINT_NOT_FOUND' ? 404
          : error?.message === 'invalid_json' ? 400
            : error?.message === 'body_too_large' ? 413 : 500
        return reply(res, status, { ok: false, error: error?.message || 'internal_error' })
      }
    },
  }
}
