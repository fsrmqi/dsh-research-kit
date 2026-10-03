import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { acquireFileLock, releaseFileLock } from '../mcp/execution/file-lock.js'

// 直接测共享锁原语：三处调用方（checkpoint-manager / claim-ledger / evidence-store）的
// 崩溃恢复语义全压在这一个函数上，而它们的用例只走「正常抢到锁」这条路径。
async function tempLock({ occupied = null } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-file-lock-'))
  const file = path.join(dir, 'nested', 'state.lock')
  await mkdir(path.dirname(file), { recursive: true })
  if (occupied !== null) await writeFile(file, occupied)
  return { dir, file, async cleanup() { await rm(dir, { recursive: true, force: true }) } }
}

test('文件锁：抢锁自动写入持锁者标识并创建父目录', async () => {
  const { file, cleanup } = await tempLock()
  const handle = await acquireFileLock(file, { timeoutMs: 200, staleMs: 10_000, busyMessage: '忙' })
  assert.ok(handle)
  const owner = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(owner.pid, process.pid)
  assert.ok(owner.token)
  await releaseFileLock(file, handle)
  await assert.rejects(() => stat(file), { code: 'ENOENT' })
  await cleanup()
})

test('文件锁：已被持有时按调用方文案超时，绝不复用别人的锁', async () => {
  const { file, cleanup } = await tempLock()
  const handle = await acquireFileLock(file, { timeoutMs: 200, staleMs: 10_000, busyMessage: '忙' })
  const startedAt = Date.now()
  await assert.rejects(
    () => acquireFileLock(file, { timeoutMs: 120, staleMs: 10_000, busyMessage: '检查点状态正被其他进程写入，请稍后重试。' }),
    /检查点状态正被其他进程写入，请稍后重试。/,
  )
  // 只花掉一个 timeout 预算，没有无限重试也没有提前放弃。
  assert.ok(Date.now() - startedAt >= 100, `应至少等待 100ms，实际 ${Date.now() - startedAt}ms`)
  await handle.close()
  await cleanup()
})

test('文件锁：陈旧锁被 rename 接管，且不留下 .stale-* 残渣', async () => {
  const { file, cleanup } = await tempLock({ occupied: 'dead-pid' })
  const stale = new Date(Date.now() - 60_000)
  await utimes(file, stale, stale)
  const handle = await acquireFileLock(file, { timeoutMs: 300, staleMs: 5_000, busyMessage: '忙' })
  assert.ok(handle, '过期锁应被接管')
  assert.deepEqual((await readdir(path.dirname(file))).filter(name => name.includes('.stale-')), [], '.stale-* 接管产物必须立即删除')
  await handle.close()
  await cleanup()
})

test('文件锁：空锁文件在宽限期内不被接管，过期后才接管', async () => {
  const { file, cleanup } = await tempLock({ occupied: '' })
  await assert.rejects(
    () => acquireFileLock(file, { timeoutMs: 120, staleMs: 5_000, emptyGraceMs: 5_000, busyMessage: '空锁宽限期内' }),
    /空锁宽限期内/,
    '空锁刚出现时可能是进程正处于 open 与 writeFile 之间，不能立刻抢',
  )
  const handle = await acquireFileLock(file, { timeoutMs: 300, staleMs: 5_000, emptyGraceMs: 0, busyMessage: '忙' })
  assert.ok(handle)
  await handle.close()
  await cleanup()
})

test('文件锁：未给文案时用默认文案兜底', async () => {
  const { file, cleanup } = await tempLock({ occupied: 'held' })
  await assert.rejects(
    () => acquireFileLock(file, { timeoutMs: 100, staleMs: 5_000 }),
    /文件正被其他进程写入，请稍后重试。/,
  )
  await cleanup()
})


test('文件锁：持有进程存活时，超过空锁和陈旧预算仍不能接管', async () => {
  const { file, cleanup } = await tempLock()
  const handle = await acquireFileLock(file, { timeoutMs: 200, staleMs: 1 })
  try {
    const old = new Date(Date.now() - 60_000)
    await utimes(file, old, old)
    await assert.rejects(() => acquireFileLock(file, { timeoutMs: 120, staleMs: 1, emptyGraceMs: 0 }), /其他进程/)
  } finally { await releaseFileLock(file, handle); await cleanup() }
})

test('文件锁：旧持有者释放时不能删除已替换的锁', async () => {
  const { file, cleanup } = await tempLock()
  const handle = await acquireFileLock(file, { timeoutMs: 200 })
  await unlink(file)
  const replacement = await acquireFileLock(file, { timeoutMs: 200 })
  try {
    const token = await readFile(file, 'utf8')
    await releaseFileLock(file, handle)
    assert.equal(await readFile(file, 'utf8'), token)
  } finally { await releaseFileLock(file, replacement); await cleanup() }
})

test('文件锁：多个独立进程恢复陈旧锁后，临界区仍然互斥', async () => {
  const { spawn } = await import('node:child_process')
  const { file, cleanup } = await tempLock({ occupied: 'dead-pid' })
  const old = new Date(Date.now() - 60_000)
  await utimes(file, old, old)
  const moduleUrl = new URL('../mcp/execution/file-lock.js', import.meta.url).href
  const counter = path.join(path.dirname(file), 'counter')
  await writeFile(counter, '0')
  const source = `import { acquireFileLock, releaseFileLock } from ${JSON.stringify(moduleUrl)};
    import { readFile, writeFile } from 'node:fs/promises';
    const file = process.argv[1], counter = process.argv[2];
    const handle = await acquireFileLock(file, { timeoutMs: 5000, staleMs: 1 });
    try { const n = Number(await readFile(counter, 'utf8'));
      await new Promise(r => setTimeout(r, 80)); await writeFile(counter, String(n + 1));
    } finally { await releaseFileLock(file, handle); }`
  try {
    await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source, file, counter])
      let stderr = ''
      child.stderr.on('data', data => { stderr += data })
      child.on('error', reject)
      child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr)))
    })))
    assert.equal(await readFile(counter, 'utf8'), '6')
  } finally { await cleanup() }
})


test('文件锁：多个进程同时恢复崩溃协调锁，也不能重叠持锁', async () => {
  const { spawn } = await import('node:child_process')
  const { file, cleanup } = await tempLock({ occupied: 'dead-pid' })
  const gate = `${file}.gate`
  await writeFile(gate, 'dead-pid')
  const old = new Date(Date.now() - 60_000)
  await utimes(file, old, old)
  await utimes(gate, old, old)
  const counter = path.join(path.dirname(file), 'counter')
  await writeFile(counter, '0')
  const moduleUrl = new URL('../mcp/execution/file-lock.js', import.meta.url).href
  const source = `import { acquireFileLock, releaseFileLock } from ${JSON.stringify(moduleUrl)};
    import { readFile, writeFile } from 'node:fs/promises';
    const file = process.argv[1], counter = process.argv[2];
    const handle = await acquireFileLock(file, { timeoutMs: 5000, staleMs: 1 });
    try { const n = Number(await readFile(counter, 'utf8'));
      await new Promise(r => setTimeout(r, 80)); await writeFile(counter, String(n + 1));
    } finally { await releaseFileLock(file, handle); }`
  try {
    await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source, file, counter])
      let stderr = ''
      child.stderr.on('data', data => { stderr += data })
      child.on('error', reject)
      child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr)))
    })))
    assert.equal(await readFile(counter, 'utf8'), '6')
    assert.deepEqual((await readdir(path.dirname(file))).filter(name => /\.gate/.test(name)), [])
  } finally { await cleanup() }
})
