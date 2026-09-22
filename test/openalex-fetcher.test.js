import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const testHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-openalex-'))
process.env.DSH_RESEARCH_KIT_HOME = testHome
const { fetchOpenAlexMetadata } = await import('../mcp/execution/openalex-fetcher.js')
const { listEvidence } = await import('../mcp/execution/evidence-store.js')

test.after(async () => rm(testHome, { recursive: true, force: true }))

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

test('OpenAlex 搜索模式启用 save_to_evidence 时会批量保存结果', async () => {
  const originalFetch = globalThis.fetch
  const project = `openalex-search-${Date.now()}`
  globalThis.fetch = async () => new Response(JSON.stringify({ results: [{
    id: 'https://api.openalex.org/works/W-SAVE-1',
    doi: 'https://doi.org/10.1000/openalex-search-save',
    title: 'Search result saved to evidence',
  }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  try {
    const parsed = await fetchOpenAlexMetadata({ query: 'save this result', project, save_to_evidence: true })
    assert.equal(parsed.data.mode, 'search')
    assert.equal(parsed.data.saved_to_evidence.saved.length, 1)
    const listed = await listEvidence({ project })
    assert.equal(listed.entries[0].identifier, '10.1000/openalex-search-save')
  } finally {
    globalThis.fetch = originalFetch
  }
})
