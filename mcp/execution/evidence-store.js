
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const BASE_DIR = path.join(os.homedir(), '.dsh-research-kit', 'evidence')

function projectDir(project) {
  return path.join(BASE_DIR, String(project || 'default').replace(/[\/\\:*?"<>|]/g, '-'))
}

function entriesFile(project) { return path.join(projectDir(project), 'entries.jsonl') }

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function dedupKey(entry) {
  if (entry.identifier_type === 'doi') return `doi:${entry.identifier}`
  if (entry.identifier_type === 'pmid') return `pmid:${entry.identifier}`
  if (entry.identifier_type === 'arxiv') return `arxiv:${entry.identifier}`
  if (entry.identifier_type === 'nct') return `nct:${entry.identifier}`
  if (entry.url) return `url:${entry.url}`
  return `title:${entry.title?.slice(0, 80).toLowerCase()}`
}

async function readEntries(project) {
  const file = entriesFile(project)
  if (!existsSync(file)) return []
  const raw = await readFile(file, 'utf-8')
  return raw.split('\n').filter(line => line.trim()).map(line => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
}

async function appendEntry(project, entry) {
  await mkdir(projectDir(project), { recursive: true })
  const file = entriesFile(project)
  const line = JSON.stringify(entry) + '\n'
  await writeFile(file, line, { flag: 'a' })
}

async function saveEvidence({ identifier_type, identifier, title, url, note, project, grade_hint }) {
  const entry = {
    id: makeId(),
    identifier_type: identifier_type || 'none',
    identifier: identifier || '',
    title: title || '',
    url: url || '',
    note: note || '',
    project: project || 'default',
    grade: grade_hint || 'ungraded',
    status: 'unverified',
    source: 'mcp-agent',
    saved_at: new Date().toISOString(),
  }

  const existing = await readEntries(entry.project)
  const key = dedupKey(entry)
  const duplicate = existing.find(e => dedupKey(e) === key)
  if (duplicate) {
    return { saved: false, id: duplicate.id, dedup_status: 'duplicate', existing_entry: duplicate }
  }

  await appendEntry(entry.project, entry)
  return { saved: true, id: entry.id, dedup_status: 'new' }
}

async function listEvidence({ project, identifier_type, grade, limit } = {}) {
  const projectName = project || 'default'
  let entries = await readEntries(projectName)
  if (identifier_type) entries = entries.filter(e => e.identifier_type === identifier_type)
  if (grade) entries = entries.filter(e => e.grade === grade)
  const max = Math.max(1, Math.min(Number(limit) || 50, 200))
  return { entries: entries.slice(0, max), total: entries.length, project: projectName }
}

async function linkEvidence(evidenceId, assetId, project) {
  const projectName = project || 'default'
  const entries = await readEntries(projectName)
  const entry = entries.find(e => e.id === evidenceId)
  if (!entry) throw new Error(`证据条目 "${evidenceId}" 不存在于项目 "${projectName}"。`)
  entry.linked_assets = [...new Set([...(entry.linked_assets || []), assetId])]
  // Rewrite the file with the updated entry
  await mkdir(projectDir(projectName), { recursive: true })
  const file = entriesFile(projectName)
  const content = entries.map(e => JSON.stringify(e.id === evidenceId ? entry : e)).join('\n') + '\n'
  await writeFile(file, content)
  return { linked: true, evidence_id: evidenceId, asset_id: assetId }
}

export { saveEvidence, listEvidence, linkEvidence }
