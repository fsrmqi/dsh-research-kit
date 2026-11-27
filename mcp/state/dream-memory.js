// 梦境记忆的文件真源。浏览器和 MCP 读写同一份 JSON，不保存论文全文。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dataPath } from '../paths.js'
import { safeProjectName } from '../execution/evidence-store.js'
import { acquireFileLock, releaseFileLock } from '../execution/file-lock.js'
import {
  addMemoryCard, emptyDreamMemory, expandDreamMemory, foldCardsIntoTheme, hotDreamMemory, normalizeDreamMemory,
} from '../../src/lib/dream-memory.js'

const MEMORY_DIR = dataPath('dream')
const LOCK_TIMEOUT_MS = 2_000
const LOCK_STALE_MS = 5_000

function fileFor(project) {
  return path.join(MEMORY_DIR, safeProjectName(project), 'memory.json')
}

function lockFor(project) {
  return path.join(MEMORY_DIR, safeProjectName(project), '.lock')
}

async function withLock(project, task) {
  const name = safeProjectName(project)
  const handle = await acquireFileLock(lockFor(name), { timeoutMs: LOCK_TIMEOUT_MS, staleMs: LOCK_STALE_MS })
  try { return await task(name) } finally { await releaseFileLock(lockFor(name), handle) }
}

export async function readDreamMemory(project = 'default') {
  const name = safeProjectName(project)
  try {
    const raw = await readFile(fileFor(name), 'utf8')
    return normalizeDreamMemory(JSON.parse(raw), name)
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyDreamMemory(name)
    throw error
  }
}

async function writeMemory(project, memory) {
  const file = fileFor(project)
  await mkdir(path.dirname(file), { recursive: true })
  const next = normalizeDreamMemory(memory, project)
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await rename(temp, file)
  return next
}

export async function recordDreamMemoryCard(project = 'default', card) {
  return withLock(project, async name => {
    const current = await readDreamMemory(name)
    return writeMemory(name, addMemoryCard({ ...current, project: name }, card))
  })
}

export async function recordDreamMemoryTheme(project = 'default', theme) {
  return withLock(project, async name => {
    const current = await readDreamMemory(name)
    const next = foldCardsIntoTheme({ ...current, project: name }, theme)
    if (next.themes.length === current.themes.length && next.themes[0]?.id === current.themes[0]?.id) {
      throw new Error('主题摘要至少要收进两张已有记忆卡。')
    }
    return writeMemory(name, next)
  })
}

export async function dreamMemoryView(project = 'default', { id = '' } = {}) {
  const memory = await readDreamMemory(project)
  if (id) {
    const expanded = expandDreamMemory(memory, id)
    if (!expanded) throw new Error('没有这张记忆卡或主题摘要。')
    return { project: memory.project, ...expanded }
  }
  return hotDreamMemory(memory)
}
