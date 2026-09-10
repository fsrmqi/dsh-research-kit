// 最小 IndexedDB 桩：够 store 用即可（open / transaction / getAll / put / delete / clear）。
//
// 存在的理由：「跨刷新持久化」在 Node 里没法真测，但可以测它的等价命题——
// 用同一个数据库重建 store 实例后，数据仍在。数据活在本桩的闭包里，
// 重建 store 只重连不重置，这正是刷新页面的行为。
//
// 注意：本文件位于 test/ 下，会被 node --test 当作 0 用例的测试文件执行一次，属预期行为。

export function createFakeIndexedDB() {
  const databases = new Map()

  // 请求一律异步兑现，且事务完成用 setTimeout 而非 microtask：
  // store 是在 `await run(...)` 之后才挂 oncomplete，microtask 会抢在赋值前触发导致悬挂。
  const makeRequest = (tx, run) => {
    const request = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }
    if (tx) tx.pending += 1
    queueMicrotask(() => {
      try {
        const out = run(request)
        if (out !== undefined) request.result = out
      } catch (error) {
        request.error = error
        request.onerror?.({})
        return
      }
      request.onsuccess?.({})
      if (tx) {
        tx.pending -= 1
        if (tx.pending === 0) setTimeout(() => tx.oncomplete?.({}), 0)
      }
    })
    return request
  }

  // 对外暴露的 db 句柄：objectStoreNames / createObjectStore / transaction。
  const publicDb = name => {
    const data = databases.get(name)
    return {
      objectStoreNames: { contains: storeName => data.stores.has(storeName) },
      createObjectStore(storeName) {
        if (!data.stores.has(storeName)) data.stores.set(storeName, new Map())
        return { createIndex: () => {} }
      },
      transaction(storeName) {
        if (!data.stores.has(storeName)) data.stores.set(storeName, new Map())
        const rows = data.stores.get(storeName)
        const tx = { pending: 0, oncomplete: null, onerror: null, onabort: null, error: null }
        return {
          objectStore: () => ({
            getAll: () => makeRequest(tx, request => { request.result = [...rows.values()] }),
            put: value => makeRequest(tx, request => { rows.set(value.id, value); request.result = value.id }),
            delete: key => makeRequest(tx, request => { rows.delete(String(key)) }),
            clear: () => makeRequest(tx, () => { rows.clear() }),
          }),
          set oncomplete(fn) { tx.oncomplete = fn },
          get oncomplete() { return tx.oncomplete },
          set onerror(fn) { tx.onerror = fn },
          get onerror() { return tx.onerror },
          set onabort(fn) { tx.onabort = fn },
          get onabort() { return tx.onabort },
          get error() { return tx.error },
        }
      },
    }
  }

  return {
    open(name) {
      return makeRequest(null, request => {
        if (!databases.has(name)) {
          databases.set(name, { stores: new Map() })
          request.result = publicDb(name)
          // 与真实 IndexedDB 一致：建库时先在 onupgradeneeded 里建表，再 onsuccess。
          request.onupgradeneeded?.({})
        } else {
          request.result = publicDb(name)
        }
      })
    },
    _databases: databases,
  }
}

// 装上桩并返回卸载函数。不卸载会污染后续用例——降级分支的断言依赖 indexedDB 缺席。
export function installFakeIndexedDB() {
  const fake = createFakeIndexedDB()
  const had = 'indexedDB' in globalThis
  const previous = globalThis.indexedDB
  globalThis.indexedDB = fake
  return {
    fake,
    restore() {
      if (had) globalThis.indexedDB = previous
      else delete globalThis.indexedDB
    },
  }
}
