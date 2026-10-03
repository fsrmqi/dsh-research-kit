import test from 'node:test'
import assert from 'node:assert/strict'
import { indexedDbFactory, requestToPromise, withObjectStore, withTransaction } from '../src/lib/idb.js'

// 两个 store（证据库 / 知识库）共用这套事务壳。这里钉住三条语义：
//   1. 事务**提交**后才 resolve —— 提前 resolve 会让调用方以为写入已落盘；
//   2. onerror / onabort 一律 reject，且允许覆盖成有指向的文案；
//   3. 无 indexedDB 的环境如实返回 null（调用方据此走内存降级），不抛错。

function controlledDb() {
  const seen = []
  const tx = {
    objectStore: name => ({ name }),
  }
  const db = {
    seen,
    transaction(storeNames, mode) {
      seen.push({ storeNames, mode })
      return tx
    },
  }
  return {
    db,
    seen,
    complete: () => tx.oncomplete?.(),
    fail: error => { tx.error = error; tx.onerror?.() },
    abort: error => { tx.error = error; tx.onabort?.() },
  }
}

test('事务壳：run 拿到事务、返回值透出，但必须等 oncomplete 才 resolve', async () => {
  const harness = controlledDb()
  let ran = false
  let settled = false
  const pending = withTransaction(harness.db, ['a', 'b'], 'readwrite', tx => {
    ran = true
    assert.equal(typeof tx.objectStore, 'function', 'run 应拿到事务本身（多 store 写入用）')
    return 'value'
  }).then(value => { settled = true; return value })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(ran, 'run 应立即执行')
  assert.deepEqual(harness.seen, [{ storeNames: ['a', 'b'], mode: 'readwrite' }], 'store 名与模式要原样传给 db.transaction')
  assert.equal(settled, false, '事务未提交前不得 resolve')
  harness.complete()
  assert.equal(await pending, 'value')
})

test('事务壳：onerror/onabort 转成拒绝，可覆盖成有指向的文案', async () => {
  // 真实 IndexedDB 的回调是异步的：这里也延后一个事件循环再触发。
  const failed = controlledDb()
  const failing = withTransaction(failed.db, 's', 'readwrite', () => 'ignored', {
    errorMessage: '证据项目迁移失败',
  })
  setTimeout(() => failed.fail(), 0)
  await assert.rejects(() => failing, /证据项目迁移失败/)

  const aborted = controlledDb()
  const aborting = withTransaction(aborted.db, 's', 'readwrite', () => 'ignored', {
    abortMessage: '知识项目迁移中止',
  })
  setTimeout(() => aborted.abort(), 0)
  await assert.rejects(() => aborting, /知识项目迁移中止/)

  // 驱动层自带 error 时优先透出原始错误，便于定位。
  const detailed = controlledDb()
  const withCause = withTransaction(detailed.db, 's', 'readwrite', () => 'ignored')
  setTimeout(() => detailed.fail(new Error('QuotaExceededError')), 0)
  await assert.rejects(() => withCause, /QuotaExceededError/)

  // run 自己抛错：事务会随之中止，不得留下未处理的拒绝，也不能假装成功。
  const thrown = controlledDb()
  await assert.rejects(
    () => withTransaction(thrown.db, 's', 'readwrite', () => { throw new Error('run 内部错误') }),
    /run 内部错误/)
  setTimeout(() => thrown.abort(), 0)
})

test('事务壳：withObjectStore 交出目标 store；requestToPromise 与无 indexedDB 环境如实降级', async () => {
  const harness = controlledDb()
  const pendingStore = withObjectStore(harness.db, 'researchEvidence', 'readonly', target => target)
  setTimeout(() => harness.complete(), 0)
  const store = await pendingStore
  assert.equal(store.name, 'researchEvidence')
  assert.deepEqual(harness.seen, [{ storeNames: 'researchEvidence', mode: 'readonly' }])

  // 假 request 必须手动触发回调：requestToPromise 只在宿主回调里结算。
  const okRequest = { result: 7 }
  const ok = requestToPromise(okRequest)
  okRequest.onsuccess()
  assert.equal(await ok, 7)

  const badRequest = { error: null }
  const bad = requestToPromise(badRequest)
  badRequest.onerror()
  await assert.rejects(() => bad, /IndexedDB 请求失败/)

  assert.equal(indexedDbFactory(), null, 'Node 无 indexedDB 时应返回 null，由调用方走内存降级')
})
