// 进程内 TTL 缓存：过期当作未命中，并按上限淘汰最旧条目。
//
// database-query / citation-verifier / source-querier 三处此前各抄一份同形状实现，其中
// 只有 database-query 的命中会提升到末尾（真 LRU）。差异用 lruOnHit 显式表达，不在共享层
// 替调用方改淘汰顺序——改的是「只有一份实现」，不是「统一成一种策略」。
export function createTtlCache({ ttlMs, maxEntries, lruOnHit = false }) {
  const entries = new Map()
  return {
    get(key) {
      const hit = entries.get(key)
      if (!hit) return null
      if (Date.now() - hit.at > ttlMs) { entries.delete(key); return null }
      // 命中提升到末尾，淘汰策略才是真正的 LRU 而非插入顺序 FIFO。
      if (lruOnHit) { entries.delete(key); entries.set(key, hit) }
      return hit.value
    },
    set(key, value) {
      entries.set(key, { at: Date.now(), value })
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
    },
  }
}
