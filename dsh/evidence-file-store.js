import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const EVIDENCE_FILE_KIND = 'dsh-research-kit-evidence'
export const EVIDENCE_FILE_VERSION = 1
const BACKUP_LIMIT = 5

export function dshHomeDirectory(env = process.env, home = homedir()) {
  return env.DSH_HOME || join(env.USERPROFILE || home, '.dsh')
}

export function evidenceFilePaths(env = process.env, home = homedir()) {
  const directory = join(dshHomeDirectory(env, home), 'dsh-research-kit')
  return { directory, file: join(directory, 'evidence-vault.json'), backups: join(directory, 'backups') }
}

function digest(text) { return createHash('sha256').update(text).digest('hex') }
function documentFor(entries) { return { kind: EVIDENCE_FILE_KIND, version: EVIDENCE_FILE_VERSION, updatedAt: new Date().toISOString(), entries: Array.isArray(entries) ? entries : [] } }

export async function readEvidenceFile(options = {}) {
  const paths = evidenceFilePaths(options.env, options.home)
  try {
    const text = await readFile(paths.file, 'utf8')
    const value = JSON.parse(text)
    if (value?.kind !== EVIDENCE_FILE_KIND || value?.version !== EVIDENCE_FILE_VERSION || !Array.isArray(value?.entries)) throw new Error('本地证据库文件格式或版本不受支持。')
    return { paths, exists: true, document: value, hash: digest(text), mtimeMs: (await stat(paths.file)).mtimeMs }
  } catch (error) {
    if (error?.code === 'ENOENT') return { paths, exists: false, document: documentFor([]), hash: '', mtimeMs: 0 }
    throw error
  }
}

export async function writeEvidenceFile(entries, { expectedHash, env, home } = {}) {
  const current = await readEvidenceFile({ env, home })
  if (expectedHash !== undefined && expectedHash !== current.hash) {
    const error = new Error('本地证据库已被其他操作修改，请重新加载后再保存。')
    error.code = 'CONFLICT'
    throw error
  }
  const { paths } = current
  await mkdir(paths.directory, { recursive: true })
  await mkdir(paths.backups, { recursive: true })
  if (current.exists) await writeFile(join(paths.backups, `evidence-vault-${Date.now()}.json`), JSON.stringify(current.document, null, 2), 'utf8')
  const next = documentFor(entries)
  const text = `${JSON.stringify(next, null, 2)}\n`
  const temporary = `${paths.file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, paths.file)
  const backups = (await readdir(paths.backups)).filter(name => name.endsWith('.json')).sort()
  const stale = backups.slice(0, -BACKUP_LIMIT)
  await Promise.all(stale.map(name => unlink(join(paths.backups, name))))
  return { paths, document: next, hash: digest(text) }
}
