import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceSettings, querySource } from '../mcp/execution/source-querier.js'

test('sourceSettings 支持每源 timeout、rate limit 与 API key', () => {
  const settings = sourceSettings('semantic-scholar', {
    DSH_RESEARCH_KIT_SOURCE_SEMANTIC_SCHOLAR_TIMEOUT_MS: '5000',
    DSH_RESEARCH_KIT_SOURCE_SEMANTIC_SCHOLAR_RATE_LIMIT: '3',
    DSH_RESEARCH_KIT_SOURCE_SEMANTIC_SCHOLAR_API_KEY: 'secret',
  })
  assert.deepEqual(settings, {
    env_key: 'SEMANTIC_SCHOLAR',
    timeout_ms: 5000,
    rate_limit: 3,
    api_key: 'secret',
  })
  const defaults = sourceSettings('crossref', {})
  assert.equal(defaults.timeout_ms, 15_000)
  assert.equal(defaults.rate_limit, 12)
  assert.equal(defaults.api_key, '')
})

test('querySource 会按数据源适配器发送 API key', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.DSH_RESEARCH_KIT_SOURCE_SEMANTIC_SCHOLAR_API_KEY
  process.env.DSH_RESEARCH_KIT_SOURCE_SEMANTIC_SCHOLAR_API_KEY = 'source-key'
  const headers = []
  globalThis.fetch = async (url, init) => {
    headers.push(init.headers)
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await querySource('semantic-scholar', `header-${Date.now()}`, 1)
    assert.equal(result.total, 0)
    assert.equal(headers[0]['x-api-key'], 'source-key')
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.DSH_RESEARCH_KIT_SOURCE_SEMANTIC_SCHOLAR_API_KEY
    else process.env.DSH_RESEARCH_KIT_SOURCE_SEMANTIC_SCHOLAR_API_KEY = originalKey
  }
})
