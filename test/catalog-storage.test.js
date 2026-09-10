import test from 'node:test'
import assert from 'node:assert/strict'
import { createCatalogStorage } from '../src/catalog-storage.js'

/** 内存 localStorage 桩：语义与浏览器一致，隔离测试。 */
function fakeStorage() {
  const map = new Map()
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) }
  }
}

test('收藏：切换、持久化、可重复往返', () => {
  const storage = createCatalogStorage({ storage: fakeStorage() })
  assert.deepEqual(storage.getFavorites(), [])
  assert.deepEqual(storage.toggleFavorite('review-paper'), ['review-paper'])
  assert.deepEqual(storage.getFavorites(), ['review-paper'])
  assert.deepEqual(storage.toggleFavorite('review-paper'), [])
  assert.deepEqual(storage.getFavorites(), [])
})

test('历史记录：含名称、摘要与时间戳，去重置顶并截断到 20 条', () => {
  const storage = createCatalogStorage({ storage: fakeStorage() })
  storage.recordHistory({ id: 'a', name: '工作流 A', summary: '第一行摘要\n第二行不该出现' })
  storage.recordHistory({ id: 'b', name: '工作流 B' })
  const rows = storage.getHistory()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].id, 'b')
  assert.equal(rows[0].name, '工作流 B')
  assert.equal(typeof rows[0].at, 'number')
  assert.equal(rows[1].id, 'a')
  assert.equal(rows[1].summary, '第一行摘要')
  // 再次使用 a：提到最前且不重复
  storage.recordHistory({ id: 'a', name: '工作流 A', summary: '更新' })
  const again = storage.getHistory()
  assert.equal(again[0].id, 'a')
  assert.equal(again.length, 2)
  // 超过 20 条截断
  for (let i = 0; i < 25; i++) storage.recordHistory({ id: `x${i}`, name: `X${i}` })
  const capped = storage.getHistory()
  assert.equal(capped.length, 20)
  assert.equal(capped[0].id, 'x24')
})

test('摘要只保存首行并截断到 80 字符，不保存完整 Prompt', () => {
  const storage = createCatalogStorage({ storage: fakeStorage() })
  const longSummary = `${'长'.repeat(100)}\n第二行`
  storage.recordHistory({ id: 'a', name: 'A', summary: longSummary })
  const [row] = storage.getHistory()
  assert.ok(row.summary.length <= 80)
  assert.ok(!row.summary.includes('第二行'))
  const raw = JSON.parse(fakeStorage.getItem ? 'null' : 'null') // 占位防误用
  assert.ok(!JSON.stringify(row).includes('第二行'))
})

test('getRecents 从历史派生唯一 ID 序列（向后兼容）', () => {
  const storage = createCatalogStorage({ storage: fakeStorage() })
  storage.recordHistory({ id: 'a', name: 'A' })
  storage.recordHistory({ id: 'b', name: 'B' })
  storage.recordHistory({ id: 'a', name: 'A' })
  assert.deepEqual(storage.getRecents(), ['a', 'b'])
})

test('onHistoryChange：记录与清空时收到通知', () => {
  const fake = fakeStorage()
  const storage = createCatalogStorage({ storage: fake })
  const seen = []
  const off = storage.onHistoryChange(rows => seen.push(rows.length))
  storage.recordHistory({ id: 'a', name: 'A' })
  storage.clearHistory()
  off()
  assert.deepEqual(seen, [1, 0])
})

test('clear 同时清空收藏与历史', () => {
  const storage = createCatalogStorage({ storage: fakeStorage() })
  storage.toggleFavorite('review-paper')
  storage.recordHistory({ id: 'write-introduction', name: '引言' })
  storage.clear()
  assert.deepEqual(storage.getFavorites(), [])
  assert.deepEqual(storage.getHistory(), [])
})

test('损坏的存储内容被当作空列表而非抛错', () => {
  const fake = fakeStorage()
  fake.setItem('dsh-research-kit:favorites', '{oops')
  fake.setItem('dsh-research-kit:history', 'not-json')
  const storage = createCatalogStorage({ storage: fake })
  assert.deepEqual(storage.getFavorites(), [])
  assert.deepEqual(storage.getHistory(), [])
})

test('无 window/window.localStorage 的环境中不抛错', () => {
  const storage = createCatalogStorage({ storage: null })
  assert.doesNotThrow(() => {
    storage.toggleFavorite('review-paper')
    storage.recordHistory({ id: 'a', name: 'A' })
    storage.clear()
  })
  assert.ok(Array.isArray(storage.getFavorites()))
  assert.ok(Array.isArray(storage.getHistory()))
})
