
import { appendFile, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { dataPath } from '../paths.js'
import { workspaceIdForProject } from '../../src/lib/research-workspaces.js'

const BASE_DIR = dataPath('evidence')
const LOCK_TIMEOUT_MS = 2_000
const LOCK_STALE_MS = 5_000
const entryCache = new Map()
const sortedEntryCache = new Map()

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
  if (entry.identifier_type === 'pmcid') return `pmcid:${String(entry.identifier || '').toLowerCase()}`
  if (entry.identifier_type === 'arxiv') return `arxiv:${String(entry.identifier || '').toLowerCase()}`
  if (entry.identifier_type === 'nct') return `nct:${String(entry.identifier || '').toLowerCase()}`
  if (entry.url) return `url:${String(entry.url).replace(/\/$/, '').toLowerCase()}`
  if (entry.identifier_type === 'none' && entry.identifier) return `identifier:${String(entry.identifier).toLowerCase()}`
  return `title:${String(entry.title || '').slice(0, 80).toLowerCase()}`
}

async function readEntriesUnlocked(project) {
  const file = entriesFile(project)
  if (!existsSync(file)) return []
  const info = await stat(file)
  const cached = entryCache.get(file)
  if (cached?.size === info.size && cached?.mtimeMs === info.mtimeMs) return cached.entries
  const raw = await readFile(file, 'utf-8')
  const entries = raw.split('\n').filter(line => line.trim()).map(line => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
  entryCache.set(file, { size: info.size, mtimeMs: info.mtimeMs, entries })
  return entries
}

async function readEntriesStrict(project) {
  const file = entriesFile(project)
  if (!existsSync(file)) return []
  const raw = await readFile(file, 'utf8')
  return raw.split('\n').filter(line => line.trim()).map(line => {
    try { return JSON.parse(line) } catch { throw new Error(`项目「${project}」的证据文件含无效 JSON；请先修复，整理已取消。`) }
  })
}

function invalidateEntryCache(project) {
  entryCache.delete(entriesFile(project))
  sortedEntryCache.delete(safeProjectName(project))
}

async function writeEntriesUnlocked(project, entries) {
  const dir = projectDir(project)
  await mkdir(dir, { recursive: true })
  const target = path.join(dir, 'entries.jsonl')
  const temp = path.join(dir, `.entries-${process.pid}-${Date.now().toString(36)}.tmp`)
  await writeFile(temp, entries.map(entry => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : ''), 'utf8')
  await rename(temp, target)
  invalidateEntryCache(project)
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
    if (added.length) {
      await appendFile(entriesFile(project), added.map(entry => JSON.stringify(entry)).join('\n') + '\n', 'utf8')
      invalidateEntryCache(project)
    }
    return { entries: [...existing, ...added], added: added.length, skipped }
  })
}

export async function writeProjectEntries(project, entries = []) {
  if (!Array.isArray(entries)) throw new Error('entries 必须是数组。')
  return withProjectLock(project, async () => writeEntriesUnlocked(project, entries))
}

// 按稳定 ID 更新现有条目；不允许用来源去重键猜测目标，避免把另一位研究者的
// 笔记或核验状态覆盖掉。新条目仍走 mergeProjectEntries 的追加契约。
export async function replaceProjectEntry(project, incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || !incoming.id) {
    throw new Error('更新证据必须提供稳定 ID。')
  }
  return withProjectLock(project, async () => {
    const entries = await readEntriesUnlocked(project)
    const index = entries.findIndex(item => item.id === incoming.id)
    if (index < 0) return { updated: false, reason: 'not_found' }
    const previous = entries[index]
    if (incoming.project && safeProjectName(incoming.project) !== safeProjectName(project)) {
      throw invalidProject('更新条目的项目与目标项目不一致。')
    }
    const projectName = safeProjectName(project)
    const workspaceId = projectName === 'default' && incoming.workspace_id === 'workspace:unassigned'
      ? 'workspace:unassigned' : workspaceIdForProject(projectName)
    entries[index] = { ...previous, ...incoming, id: previous.id, project: projectName, workspace_id: workspaceId }
    await writeEntriesUnlocked(project, entries)
    return { updated: true, entry: entries[index] }
  })
}

const ORGANIZER_JOURNAL = dataPath('evidence-organizer-last.json')

async function withProjectLocks(projects, run) {
  const names = [...new Set(projects.map(safeProjectName))].sort()
  const walk = async index => index === names.length ? run() : withProjectLock(names[index], () => walk(index + 1))
  return walk(0)
}

function validateProjectMoves(moves) {
  if (!Array.isArray(moves) || !moves.length || moves.length > 50) throw new Error('项目整理需要 1–50 条映射。')
  const rows = moves.map(item => {
    if (!String(item?.from || '').trim() || !String(item?.to || '').trim()) throw new Error('项目整理不能使用空项目名。')
    return { from: safeProjectName(item.from), to: safeProjectName(item.to) }
  })
  if (rows.some(item => item.from === item.to) || new Set(rows.map(item => item.from)).size !== rows.length) {
    throw new Error('项目整理映射包含重复或原地映射。')
  }
  if (rows.some(item => rows.some(other => other.from === item.to))) throw new Error('暂不支持链式项目迁移。')
  return rows
}

async function readOrganizerJournal() {
  if (!existsSync(ORGANIZER_JOURNAL)) return null
  return JSON.parse(await readFile(ORGANIZER_JOURNAL, 'utf8'))
}

export async function evidenceProjectOrganizationState() {
  const journal = await readOrganizerJournal()
  return journal ? { id: journal.id, status: journal.status, mappings: journal.mappings } : null
}

export async function organizeEvidenceProjects(moves) {
  const mappings = validateProjectMoves(moves)
  const names = [...new Set(mappings.flatMap(item => [item.from, item.to]))]
  return withProjectLocks(names, async () => {
    const previous = await readOrganizerJournal()
    if (previous?.status === 'applying') throw new Error('上次项目整理未完成，请先撤销恢复；未执行新的整理。')
    if (previous?.status === 'applied') throw new Error('已有可撤销的项目整理；请先撤销或保留当前结果。')
    const before = Object.fromEntries(await Promise.all(names.map(async name => [name, await readEntriesStrict(name)])))
    const after = Object.fromEntries(names.map(name => [name, [...before[name]]]))
    for (const { from, to } of mappings) {
      for (const entry of before[from]) {
        if (after[to].some(item => item.id === entry.id || dedupKey(item) === dedupKey(entry))) {
          throw new Error(`「${from}」→「${to}」存在重复 ID 或来源；未修改任何证据。`)
        }
        after[to].push({ ...entry, project: to, workspace_id: workspaceIdForProject(to), legacy_project: entry.legacy_project || from })
      }
      after[from] = []
    }
    const id = `organize-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const journal = { id, status: 'applying', mappings, before, after, createdAt: Date.now() }
    await mkdir(path.dirname(ORGANIZER_JOURNAL), { recursive: true })
    await writeFile(ORGANIZER_JOURNAL, JSON.stringify(journal), 'utf8')
    try {
      for (const name of names) await writeEntriesUnlocked(name, after[name])
      for (const name of names) {
        const checked = await readEntriesStrict(name)
        if (JSON.stringify(checked) !== JSON.stringify(after[name])) throw new Error(`项目「${name}」迁移校验失败。`)
      }
      await writeFile(ORGANIZER_JOURNAL, JSON.stringify({ ...journal, status: 'applied' }), 'utf8')
      return { id, moved: mappings.reduce((sum, item) => sum + before[item.from].length, 0), mappings }
    } catch (error) {
      for (const name of names) await writeEntriesUnlocked(name, before[name])
      await writeFile(ORGANIZER_JOURNAL, JSON.stringify({ ...journal, status: 'rolled_back' }), 'utf8')
      throw error
    }
  })
}

export async function undoEvidenceProjectOrganization(id) {
  const journal = await readOrganizerJournal()
  if (!journal || journal.id !== id || !['applied', 'applying'].includes(journal.status)) throw new Error('找不到可撤销的项目整理记录。')
  const names = Object.keys(journal.before)
  return withProjectLocks(names, async () => {
    for (const name of names) {
      const current = await readEntriesStrict(name)
      if (JSON.stringify(current) !== JSON.stringify(journal.after[name])
        && !(journal.status === 'applying' && JSON.stringify(current) === JSON.stringify(journal.before[name]))) {
        throw new Error(`项目「${name}」在整理后发生变化；为避免覆盖新数据，自动撤销已停止。`)
      }
    }
    for (const name of names) await writeEntriesUnlocked(name, journal.before[name])
    await writeFile(ORGANIZER_JOURNAL, JSON.stringify({ ...journal, status: 'undone' }), 'utf8')
    return { id, restored: names.length }
  })
}

export async function finalizeEvidenceProjectOrganization(id) {
  const journal = await readOrganizerJournal()
  if (!journal || journal.id !== id || journal.status !== 'applied') throw new Error('找不到待确认保留的项目整理记录。')
  await writeFile(ORGANIZER_JOURNAL, JSON.stringify({ ...journal, status: 'finalized' }), 'utf8')
  return { id, finalized: true }
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

export async function clearProjectEntries(project) {
  return withProjectLock(project, async () => writeEntriesUnlocked(project, []))
}

export async function clearAllProjectEntries() {
  if (!existsSync(BASE_DIR)) return 0
  const names = (await readdir(BASE_DIR, { withFileTypes: true }))
    .filter(item => item.isDirectory())
    .map(item => item.name)
  let cleared = 0
  for (const name of names) {
    const entries = await readProjectEntries(name)
    if (entries.length) {
      await clearProjectEntries(name)
      cleared += entries.length
    }
  }
  return cleared
}

async function saveEvidence({ identifier_type, identifier, title, url, note, project, grade_hint, run_id }) {
  const entry = {
    id: makeId(),
    identifier_type: identifier_type || 'none',
    identifier: identifier || '',
    title: title || '',
    url: url || '',
    note: note || '',
    project: safeProjectName(project),
    workspace_id: workspaceIdForProject(safeProjectName(project)),
    grade: grade_hint || 'ungraded',
    status: 'unverified',
    source: 'mcp-agent',
    saved_at: new Date().toISOString(),
    // run_id 是可选关联，不参与项目内来源去重；同一文献可在同一研究运行中多次
    // 被引用，但仍应只保存一条证据元数据。
    run_id: typeof run_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(run_id) ? run_id : '',
  }

  const result = await mergeProjectEntries(entry.project, [entry])
  if (!result.added) {
    const duplicate = result.skipped.find(item => item && typeof item === 'object' && dedupKey(item) === dedupKey(entry))
    return { saved: false, id: duplicate?.id, dedup_status: 'duplicate', existing_entry: duplicate || null }
  }
  return { saved: true, id: entry.id, dedup_status: 'new' }
}

// 批量保存：单次锁内完成全部去重与写入，避免逐条调用时的锁竞争。
// run_id 为批级可选关联；条目级 dedup 行为与单条 saveEvidence 完全一致。
async function saveEvidenceBatch(items = [], { project, run_id } = {}) {
  const projectName = safeProjectName(project)
  const normalizedRunId = typeof run_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(run_id) ? run_id : ''
  const entries = []
  const invalid = []
  for (const item of items.slice(0, 100)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { invalid.push({ index: entries.length + invalid.length, reason: '条目不是对象' }); continue }
    if (!item.title && !item.identifier) { invalid.push({ index: entries.length + invalid.length, reason: '缺少 title 与 identifier' }); continue }
    entries.push({
      id: makeId(),
      identifier_type: item.identifier_type || 'none',
      identifier: item.identifier_type === 'none' ? '' : String(item.identifier || ''),
      title: String(item.title || ''),
      url: String(item.url || ''),
      note: String(item.note || ''),
      project: projectName,
      workspace_id: workspaceIdForProject(projectName),
      grade: item.grade_hint || 'ungraded',
      status: 'unverified',
      source: 'mcp-agent',
      saved_at: new Date().toISOString(),
      run_id: normalizedRunId,
    })
  }
  return withProjectLock(projectName, async () => {
    const existing = await readEntriesUnlocked(projectName)
    const seen = new Map(existing.map(entry => [dedupKey(entry), entry]))
    const added = []
    const duplicates = []
    for (const entry of entries) {
      const key = dedupKey(entry)
      if (seen.has(key)) { duplicates.push({ title: entry.title, identifier_type: entry.identifier_type, identifier: entry.identifier, existing_id: seen.get(key)?.id }); continue }
      seen.set(key, entry)
      added.push(entry)
    }
    if (added.length) {
      await appendFile(entriesFile(projectName), added.map(entry => JSON.stringify(entry)).join('\n') + '\n', 'utf8')
      invalidateEntryCache(projectName)
    }
    return {
      project: projectName,
      run_id: normalizedRunId,
      requested: items.length,
      accepted: entries.length,
      saved: added.map(entry => ({ saved: true, id: entry.id, title: entry.title, identifier_type: entry.identifier_type, identifier: entry.identifier, dedup_status: 'new' })),
      duplicates,
      invalid,
    }
  })
}

async function listEvidence({ project, identifier_type, grade, run_id, limit, offset } = {}) {
  const projectName = safeProjectName(project)
  const sourceEntries = await readProjectEntries(projectName)
  let sorted = sortedEntryCache.get(projectName)
  if (sorted?.source !== sourceEntries) {
    sorted = { source: sourceEntries, entries: [...sourceEntries].sort((a, b) => new Date(b.saved_at || '') - new Date(a.saved_at || '')) }
    sortedEntryCache.set(projectName, sorted)
  }
  let entries = sorted.entries
  if (identifier_type) entries = entries.filter(entry => entry.identifier_type === identifier_type)
  if (grade) entries = entries.filter(entry => entry.grade === grade)
  if (run_id) entries = entries.filter(entry => entry.run_id === run_id)
  const max = Math.max(1, Math.min(Number(limit) || 50, 200))
  const pageOffset = Math.max(0, Number(offset) || 0)
  const selected = entries.slice(pageOffset, pageOffset + max)
  return {
    entries: selected,
    total: entries.length,
    returned: selected.length,
    offset: pageOffset,
    limit: max,
    has_more: pageOffset + selected.length < entries.length,
    project: projectName,
  }
}

async function linkEvidence(evidenceId, assetId, project) {
  const projectName = safeProjectName(project)
  return withProjectLock(projectName, async () => {
    const entries = await readEntriesUnlocked(projectName)
    const found = entries.find(item => item.id === evidenceId)
    const entry = found ? { ...found } : null
    if (!entry) throw new Error(`证据条目 "${evidenceId}" 不存在于项目 "${projectName}"。`)
    entry.linked_assets = [...new Set([...(entry.linked_assets || []), String(assetId)])]
    await writeEntriesUnlocked(projectName, entries.map(item => item.id === evidenceId ? entry : item))
    return { linked: true, evidence_id: evidenceId, asset_id: String(assetId) }
  })
}

async function assessEvidence(evidenceId, project, assessment = {}) {
  const projectName = safeProjectName(project)
  return withProjectLock(projectName, async () => {
    const entries = await readEntriesUnlocked(projectName)
    const current = entries.find(item => item.id === evidenceId)
    if (!current) throw new Error(`证据条目 "${evidenceId}" 不存在于项目 "${projectName}"。`)
    const allowed = {
      traceability: ['missing', 'identified'], study_type: ['unknown', 'primary-study', 'systematic-review', 'protocol', 'preprint', 'dataset', 'other'],
      claim_support: ['unassessed', 'supported', 'not-supported', 'mixed', 'not-applicable'], strength: ['ungraded', 'empirical', 'inference'],
      source_verification: ['unverified', 'verified', 'disputed', 'stale'],
    }
    const next = { ...current }
    for (const [key, values] of Object.entries(allowed)) if (assessment[key] && values.includes(assessment[key])) next[key] = assessment[key]
    next.status = next.source_verification || next.status || 'unverified'
    next.grade = next.strength || next.grade || 'ungraded'
    next.assessed_by = String(assessment.assessed_by || 'researcher').trim().slice(0, 120)
    next.assessment_reason = String(assessment.assessment_reason || '').trim().slice(0, 500)
    next.assessed_at = new Date().toISOString()
    await writeEntriesUnlocked(projectName, entries.map(item => item.id === evidenceId ? next : item))
    return next
  })
}

export { saveEvidence, saveEvidenceBatch, listEvidence, linkEvidence, assessEvidence, dedupKey }
