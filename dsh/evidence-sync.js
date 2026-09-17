
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const EVIDENCE_SYNC_PATH = '/dsh-research-kit/evidence-sync'

const EVIDENCE_DIR = path.join(os.homedir(), '.dsh-research-kit', 'evidence')

function projectDir(project) {
  return path.join(EVIDENCE_DIR, String(project || 'default').replace(/[\/\\:*?"<>|]/g, '-'))
}

function entriesFile(project) { return path.join(projectDir(project), 'entries.jsonl') }

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk; if (data.length > 1_048_576) { reject(new Error('body_too_large')); req.destroy() } })
    req.on('end', () => { try { resolve(JSON.parse(data)) } catch { reject(new Error('invalid_json')) } })
    req.on('error', reject)
  })
}

async function readProjectEntries(project) {
  const file = entriesFile(project)
  if (!existsSync(file)) return []
  const raw = await readFile(file, 'utf-8')
  return raw.split('\n').filter(line => line.trim()).map(line => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
}

async function writeProjectEntries(project, entries) {
  await mkdir(projectDir(project), { recursive: true })
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n'
  await writeFile(entriesFile(project), content)
}

export function evidenceSyncRoute({ logger } = {}) {
  return {
    kind: 'exact', path: EVIDENCE_SYNC_PATH,
    async handler(req, res) {
      try {
        if (req.method === 'GET') {
          const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`)
          const project = url.searchParams.get('project') || 'default'
          const entries = await readProjectEntries(project)
          return reply(res, 200, { ok: true, project, entries, count: entries.length })
        }
        if (req.method === 'POST') {
          const body = await readBody(req)
          const project = String(body.project || 'default')
          const incoming = Array.isArray(body.entries) ? body.entries : []
          if (!incoming.length) return reply(res, 400, { ok: false, error: 'no_entries' })
          const existing = await readProjectEntries(project)
          const seen = new Set(existing.map(e => `${e.identifier_type}:${e.identifier}:${e.title?.slice(0, 60)}`))
          const newEntries = incoming.filter(e => {
            const key = `${e.identifier_type}:${e.identifier}:${e.title?.slice(0, 60)}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          if (newEntries.length) {
            await writeProjectEntries(project, [...existing, ...newEntries])
          }
          return reply(res, 200, { ok: true, project, added: newEntries.length, skipped: incoming.length - newEntries.length })
        }
        if (req.method === 'DELETE') {
          const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`)
          const project = url.searchParams.get('project') || 'default'
          const entryId = url.searchParams.get('id')
          if (!entryId) return reply(res, 400, { ok: false, error: 'missing_id' })
          const entries = await readProjectEntries(project)
          const filtered = entries.filter(e => e.id !== entryId)
          if (filtered.length === entries.length) return reply(res, 404, { ok: false, error: 'not_found' })
          await writeProjectEntries(project, filtered)
          return reply(res, 200, { ok: true, project, deleted: entryId })
        }
        return reply(res, 405, { ok: false, error: 'method_not_allowed' })
      } catch (error) {
        try { logger?.warn?.(`evidence-sync error: ${error?.message || error}`) } catch {}
        const status = error?.message === 'invalid_json' ? 400 : error?.message === 'body_too_large' ? 413 : 500
        return reply(res, status, { ok: false, error: error?.message || 'internal_error' })
      }
    },
  }
}
