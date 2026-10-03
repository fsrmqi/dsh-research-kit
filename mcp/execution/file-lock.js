import { link, mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const EMPTY_LOCK_GRACE_MS = 2_000
const backoffMs = attempt => Math.min(20 + attempt * 10, 80)
const owners = new WeakMap()

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}

async function staleLock(file, staleMs, emptyGraceMs) {
  const info = await stat(file)
  const raw = await readFile(file, 'utf8')
  let owner
  try { owner = JSON.parse(raw) } catch {}
  // 只要持有进程还活着，耗时操作就不能被陈旧时间误判为崩溃。
  if (processAlive(owner?.pid)) return false
  const grace = info.size === 0 ? emptyGraceMs : staleMs
  return Date.now() - info.mtimeMs > grace
}

// 创建与陈旧接管共用短期协调锁，避免两个等待者依据同一份旧 stat 接管新锁。
async function acquireGate(file) {
  const gate = `${file}.gate`
  const token = JSON.stringify({ pid: process.pid, token: randomUUID() })
  const prepared = `${gate}.${process.pid}.${randomUUID()}.tmp`
  // 先写完所有者信息，再用硬链接独占发布；其他进程不会看到活进程的空协调锁。
  await writeFile(prepared, token, { flag: 'wx' })
  try {
    await link(prepared, gate)
    return async () => {
      try { if (await readFile(gate, 'utf8') === token) await unlink(gate) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    // 恢复协调锁时再串行化一次。恢复者自身崩溃时保守停止恢复，不能继续递归抢锁。
    let recovery
    try { recovery = await open(`${gate}.recovery`, 'wx') }
    catch (error) { if (error.code !== 'EEXIST') throw error }
    if (recovery) {
      try {
        try { if (await staleLock(gate, 2_000, 2_000)) await unlink(gate) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      } finally {
        await recovery.close()
        await unlink(`${gate}.recovery`)
      }
    }
    return null
  } finally { await unlink(prepared).catch(() => {}) }
}

export async function acquireFileLock(file, { timeoutMs = 5_000, staleMs = 10_000, emptyGraceMs = EMPTY_LOCK_GRACE_MS, busyMessage } = {}) {
  await mkdir(path.dirname(file), { recursive: true })
  const startedAt = Date.now()
  for (let attempt = 0; Date.now() - startedAt < timeoutMs; attempt++) {
    const releaseGate = await acquireGate(file)
    if (releaseGate) {
      try {
        try {
          if (await staleLock(file, staleMs, emptyGraceMs)) await unlink(file)
        } catch (error) { if (error.code !== 'ENOENT') throw error }
        let handle
        try { handle = await open(file, 'wx') }
        catch (error) { if (error.code !== 'EEXIST') throw error }
        if (handle) {
          const token = JSON.stringify({ pid: process.pid, token: randomUUID() })
          try { await handle.writeFile(token) }
          catch (error) { await handle.close(); await unlink(file); throw error }
          owners.set(handle, token)
          return handle
        }
      } finally { await releaseGate() }
    }
    await new Promise(resolve => setTimeout(resolve, backoffMs(attempt)))
  }
  throw new Error(busyMessage || '文件正被其他进程写入，请稍后重试。')
}

export async function releaseFileLock(file, handle) {
  const token = owners.get(handle)
  await handle.close()
  owners.delete(handle)
  // 原持有者只能释放自己的锁。接管后的锁或人工替换的文件必须保留。
  try {
    if (token && await readFile(file, 'utf8') === token) await unlink(file)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
