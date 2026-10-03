// IndexedDB 小工具：工厂探测、请求转 Promise、事务壳。
//
// 原先这两个 store 各写一份事务壳，且知识库要反向 import 证据库模块才能拿到工厂与
// 请求转换函数。集中到这里之后：两个 store 只保留各自的 schema 与业务语义，
// 「事务何时算成功」只有一处实现 —— 事务未提交就 resolve，调用方会误以为写入已落盘。

export function indexedDbFactory() {
  try {
    return typeof globalThis !== 'undefined' && globalThis.indexedDB ? globalThis.indexedDB : null
  } catch {
    return null
  }
}

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'))
  })
}

// run 收到的是事务本身（多 store 写入需要），返回值原样透出；等 oncomplete 才 resolve。
// errorMessage / abortMessage 可覆盖：迁移类操作要给出比「事务失败」更有指向的文案。
export async function withTransaction(db, storeNames, mode, run, {
  errorMessage = 'IndexedDB 事务失败',
  abortMessage = 'IndexedDB 事务被中止',
} = {}) {
  const tx = db.transaction(storeNames, mode)
  // 先挂完成回调再执行 run：run 自己抛错时事务同样会中止，
  // 那时才挂回调就会漏掉这次中止（IndexedDB 的回调是异步的，正常路径看不出差别）。
  const settled = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error(errorMessage))
    tx.onabort = () => reject(tx.error || new Error(abortMessage))
  })
  settled.catch(() => {}) // run 抛错时由这里兜住，避免未处理的拒绝
  const value = await run(tx)
  await settled
  return value
}

export function withObjectStore(db, storeName, mode, run) {
  return withTransaction(db, storeName, mode, tx => run(tx.objectStore(storeName)))
}
