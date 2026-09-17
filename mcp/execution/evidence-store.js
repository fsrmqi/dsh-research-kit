
import { appendFile, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const BASE_DIR = path.join(os.homedir(), '.dsh-research-kit', 'evidence')
const LOCK_TIMEOUT_MS = 2_000
const LOCK_STALE_MS = 5_000

function invalidProject(message) {
  const error = new Error(message)
  error.code = 'INVALID_PROJECT'
  return error
}

export function safeProjectName(project) {
  const raw = String(project || 'default').trim()
  if (!raw || raw === '.' || raw === '..') throw invalidProject('项目名不能为空、"." 或 ".."。')
  if (raw.length > 100) throw invalidProject('项目名不能超过 100 个字符。')
  const normalized = raw.replace(/[\/\\:*?"<>|\u0000]/g, '-').replace(/\.lock$/i, '-lock')
  if (normalized === '.' || normalized === '..') throw invalidProject('项目名不合法。')
  return normalized
}

function projectDir(project) {
  const name = safeProjectName(project)
  const dir = path.join(BASE_DIR, name)
  if (!dir.startsWith(`${BASE_DIR}${path.sep}`)) throw invalidProject('项目路径越界。')
  return dir
}

function entriesFile(project) { return path.join(projectDir(project), 'entries.jsonl') }
function lockFile(project) { return path.join(projectDir(project), '.lock') }

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function acquireLock(project) {
  const file = lockFile(project)
  await mkdir(path.dirname(file), { recursive: true })
  const startedAt = Date.now()
  for (let attempt = 0; Date.now() - startedAt < LOCK_TIMEOUT_MS; attempt++) {
    try {
      return await open(file, 'wx')
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        const info = await stat(file)
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) await unlink(file)
      } catch {}
      await sleep(Math.min(20 + attempt * 10, 80))
    }
  }
  throw new Error('证据存储正被其他进程写入，请稍后重试。')
}

async function withProjectLock(project, run) {
  const handle = await acquireLock(project)
  try {
    return await run()
  } finally {
    await handle.close()
    try { await unlink(lockFile(project)) } catch {}
  }
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function dedupKey(entry) {
  if (entry.identifier_type === 'doi') return `doi:${String(entry.identifier || '').toLowerCase()}`
  if (entry.identifier_type === 'pmid') return `pmid:${String(entry.identifier || '').toLowerCase()}`
  if (entry.identifier_type === 'arxiv') return `arxiv:${String(entry.identifier || '').toLowerCase()}`
  if (entry.identifier_type === 'nct') return `nct:${String(entry.identifier || '').toLowerCase()}`
  if (entry.url) return `url:${String(entry.url).replace(/\/$/, '').toLowerCase()}`
  return `title:${String(entry.title || '').slice(0, 80).toLowerCase()}`
}

async function readEntriesUnlocked(project) {
  const file = entriesFile(project)
  if (!existsSync(file)) return []
  const raw = await readFile(file, 'utf-8')
  return raw.split('\n').filter(line => line.trim()).map(line => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
}

async function writeEntriesUnlocked(project, entries) {
  const dir = projectDir(project)
  await mkdir(dir, { recursive: true })
  const target = path.join(dir, 'entries.jsonl')
  const temp = path.join(dir, `.entries-${process.pid}-${Date.now().toString(36)}.tmp`)
  await writeFile(temp, entries.map(entry => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : ''), 'utf8')
  await rename(temp, target)
}

export async function readProjectEntries(project) {
  return withProjectLock(project, () => readEntriesUnlocked(project))
}

export async function listAllProjectEntries() {
  if (!existsSync(BASE_DIR)) return []
  const names = (await readdir(BASE_DIR, { withFileTypes: true }))
    .filter(item => item.isDirectory())
    .map(item => item.name)
  const entries = []
  for (const name of names) {
    const rows = await readProjectEntries(name)
    entries.push(...rows)
  }
  return entries
}

export async function mergeProjectEntries(project, incoming = []) {
  if (!Array.isArray(incoming)) throw new Error('incoming 必须是数组。')
  return withProjectLock(project, async () => {
    const existing = await readEntriesUnlocked(project)
    const seen = new Map(existing.map(entry => [dedupKey(entry), entry]))
    const added = []
    const skipped = []
    for (const entry of incoming) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        skipped.push(entry)
        continue
      }
      const key = dedupKey(entry)
      if (seen.has(key)) {
        skipped.push(seen.get(key))
        continue
      }
      seen.set(key, entry)
      added.push(entry)
    }
    if (added.length) await appendFile(entriesFile(project), added.map(entry => JSON.stringify(entry)).join('\n') + '\n', 'utf8')
    return { entries: [...existing, ...added], added: added.length, skipped: skipped.length }
  })
}

export async function writeProjectEntries(project, entries = []) {
  if (!Array.isArray(entries)) throw new Error('entries 必须是数组。')
  return withProjectLock(project, async () => writeEntriesUnlocked(project, entries))
}

export async function deleteProjectEntry(project, entryId) {
  return withProjectLock(project, async () => {
    const entries = await readEntriesUnlocked(project)
    const filtered = entries.filter(entry => entry.id !== entryId)
    if (filtered.length === entries.length) return { deleted: false }
    await writeEntriesUnlocked(project, filtered)
    return { deleted: true }
  })
}

async function saveEvidence({ identifier_type, identifier, title, url, note, project, grade_hint }) {
  const entry = {
    id: makeId(),
    identifier_type: identifier_type || 'none',
    identifier: identifier || '',
    title: title || '',
    url: url || '',
    note: note || '',
    project: safeProjectName(project),
    grade: grade_hint || 'ungraded',
    status: 'unverified',
    source: 'mcp-agent',
    saved_at: new Date().toISOString(),
  }

  const result = await mergeProjectEntries(entry.project, [entry])
  if (!result.added) {
    const duplicate = result.skipped.find(item => item && typeof item === 'object' && dedupKey(item) === dedupKey(entry))
    return { saved: false, id: duplicate?.id, dedup_status: 'duplicate', existing_entry: duplicate || null }
  }
  return { saved: true, id: entry.id, dedup_status: 'new' }
}

async function listEvidence({ project, identifier_type, grade, limit } = {}) {
  const projectName = safeProjectName(project)
  let entries = await readProjectEntries(projectName)
  if (identifier_type) entries = entries.filter(entry => entry.identifier_type === identifier_type)
  if (grade) entries = entries.filter(entry => entry.grade === grade)
  const max = Math.max(1, Math.min(Number(limit) || 50, 200))
  return { entries: entries.slice(0, max), total: entries.length, project: projectName }
}

async function linkEvidence(evidenceId, assetId, project) {
  const projectName = safeProjectName(project)
  return withProjectLock(projectName, async () => {
    const entries = await readEntriesUnlocked(projectName)
    const entry = entries.find(item => item.id === evidenceId)
    if (!entry) throw new Error(`证据条目 "${evidenceId}" 不存在于项目 "${projectName}"。`)
    entry.linked_assets = [...new Set([...(entry.linked_assets || []), String(assetId)])]
    await writeEntriesUnlocked(projectName, entries.map(item => item.id === evidenceId ? entry : item))
    return { linked: true, evidence_id: evidenceId, asset_id: String(assetId) }
  })
}

export { saveEvidence, listEvidence, linkEvidence, dedupKey, safeProjectName }
