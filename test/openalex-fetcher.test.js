import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchOpenAlexMetadata } from '../mcp/execution/openalex-fetcher.js'

test('OpenAlex 批量 DOI 使用受控并发，引用列表默认不返回全量', async () => {
  const originalFetch = globalThis.fetch
  let active = 0
  let maxActive = 0
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active -= 1
    const index = calls
    return new Response(JSON.stringify({
      id: `https://api.openalex.org/works/W${index}`,
      doi: `https://doi.org/10.1000/test-${index}`,
      title: `OpenAlex Test ${index}`,
      referenced_works: ['https://api.openalex.org/works/W999'],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const parsed = await fetchOpenAlexMetadata({
      dois: Array.from({ length: 8 }, (_, index) => `10.1000/concurrent-${index}`),
    })
    assert.equal(parsed.data.results.length, 8)
    assert.equal(parsed.data.errors.length, 0)
    assert.ok(maxActive <= 4, `maxActive=${maxActive}`)
    assert.equal(parsed.data.results[0].referenced_works_count, 1)
    assert.ok(!('referenced_works' in parsed.data.results[0]))
  } finally {
    globalThis.fetch = originalFetch
  }
})
