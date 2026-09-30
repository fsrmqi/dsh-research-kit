import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { createTtlCache } from '../mcp/execution/ttl-cache.js'

// database-query / citation-verifier / source-querier 三处改用同一实现后，淘汰顺序与
// 过期语义就成了它们的共同契约：这里把差异（lruOnHit）与共同点都钉住。

test('TTL 缓存：未命中返回 null，命中返回原值', () => {
  const cache = createTtlCache({ ttlMs: 60_000, maxEntries: 10 })
  assert.equal(cache.get('missing'), null)
  cache.set('key', { value: 1 })
  assert.deepEqual(cache.get('key'), { value: 1 })
})

test('TTL 缓存：超过 ttlMs 后按未命中处理', async () => {
  const cache = createTtlCache({ ttlMs: 5, maxEntries: 10 })
  cache.set('key', 'stale')
  assert.equal(cache.get('key'), 'stale')
  await delay(15)
  assert.equal(cache.get('key'), null)
})

test('TTL 缓存：超过 maxEntries 时淘汰最旧条目（默认 FIFO）', () => {
  const cache = createTtlCache({ ttlMs: 60_000, maxEntries: 2 })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.get('a') // 默认不提升：读一下不影响淘汰顺序
  cache.set('c', 3)
  assert.equal(cache.get('a'), null, 'FIFO 下最旧的 a 应被淘汰')
  assert.equal(cache.get('b'), 2)
  assert.equal(cache.get('c'), 3)
})

test('TTL 缓存：lruOnHit 打开后命中提升，淘汰的是最久未用而不是最早写入', () => {
  const cache = createTtlCache({ ttlMs: 60_000, maxEntries: 2, lruOnHit: true })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.get('a') // 提升 a → 最久未用变成 b
  cache.set('c', 3)
  assert.equal(cache.get('a'), 1, 'LRU 下刚用过的 a 必须留下')
  assert.equal(cache.get('b'), null, 'LRU 下应淘汰最久未用的 b')
  assert.equal(cache.get('c'), 3)
})

test('TTL 缓存：过期条目被淘汰前不占用 maxEntries 名额（重新写入即最新）', async () => {
  const cache = createTtlCache({ ttlMs: 5, maxEntries: 1 })
  cache.set('a', 'old')
  await delay(15)
  cache.set('b', 'new')
  assert.equal(cache.get('a'), null)
  assert.equal(cache.get('b'), 'new')
})
