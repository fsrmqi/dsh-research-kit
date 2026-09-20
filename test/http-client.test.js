import test from 'node:test'
import assert from 'node:assert/strict'
import { crossrefUrl, fetchWithRetry, USER_AGENT } from '../mcp/execution/http-client.js'
import { stableIdentifier } from '../mcp/execution/identifiers.js'

function response(status, headers = {}) {
  return new Response(status === 200 ? '{}' : 'service unavailable', { status, headers })
}

test('HTTP 客户端：429 读取 Retry-After 后重试，并携带 User-Agent', async () => {
  const calls = []
  const result = await fetchWithRetry('https://retry.test/api', {
    retries: 1,
    fetchImpl: async (url, init) => {
      calls.push({ url, userAgent: init.headers['User-Agent'] })
      return response(calls.length === 1 ? 429 : 200, calls.length === 1 ? { 'Retry-After': '0' } : {})
    },
  })
  assert.equal(result.status, 200)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].userAgent, USER_AGENT)
  assert.match(USER_AGENT, /^dsh-research-kit\//)
})

test('HTTP 客户端：连续可重试失败会打开短时熔断；客户端 4xx 不计入熔断', async () => {
  const fail = async () => response(503)
  await assert.rejects(() => fetchWithRetry('https://circuit-one.test/api', { retries: 0, fetchImpl: fail }), /HTTP 503/)
  await assert.rejects(() => fetchWithRetry('https://circuit-one.test/api', { retries: 0, fetchImpl: fail }), /HTTP 503/)
  await assert.rejects(() => fetchWithRetry('https://circuit-one.test/api', { retries: 0, fetchImpl: fail }), /HTTP 503/)
  await assert.rejects(() => fetchWithRetry('https://circuit-one.test/api', { retries: 0, fetchImpl: fail }), error => {
    assert.equal(error.code, 'CIRCUIT_OPEN')
    return true
  })

  const badRequest = async () => response(400)
  await assert.rejects(() => fetchWithRetry('https://circuit-two.test/api', { retries: 0, fetchImpl: badRequest }), /HTTP 400/)
  await assert.rejects(() => fetchWithRetry('https://circuit-two.test/api', { retries: 0, fetchImpl: badRequest }), /HTTP 400/)
  await assert.rejects(() => fetchWithRetry('https://circuit-two.test/api', { retries: 0, fetchImpl: badRequest }), /HTTP 400/)
})

test('HTTP 客户端：Crossref URL 在配置联系邮箱时可附加 mailto 参数', () => {
  const url = crossrefUrl('https://api.crossref.org/works?query=x', 'research@example.com')
  assert.equal(url, 'https://api.crossref.org/works?query=x&mailto=research%40example.com')
  assert.equal(crossrefUrl('https://api.openalex.org/works?search=x'), 'https://api.openalex.org/works?search=x')
})

test('标识符归一化：DOI、PMID、arXiv、OpenAlex 统一为稳定键', () => {
  assert.deepEqual(stableIdentifier('https://doi.org/10.1038/ABC'), {
    type: 'doi', value: '10.1038/abc', key: 'doi:10.1038/abc',
  })
  assert.deepEqual(stableIdentifier('https://pubmed.ncbi.nlm.nih.gov/12345/'), {
    type: 'pmid', value: '12345', key: 'pmid:12345',
  })
  assert.deepEqual(stableIdentifier('https://arxiv.org/abs/2301.00001v2'), {
    type: 'arxiv', value: '2301.00001v2', key: 'arxiv:2301.00001v2',
  })
  assert.deepEqual(stableIdentifier('https://api.openalex.org/works/W123'), {
    type: 'openalex', value: 'W123', key: 'openalex:W123',
  })
  assert.deepEqual(stableIdentifier('https://api.openalex.org/works/W123', 'https://doi.org/10.1038/abc'), {
    type: 'doi', value: '10.1038/abc', key: 'doi:10.1038/abc',
  }, 'DOI 优先于 OpenAlex work ID，跨源才能合并')
  assert.equal(stableIdentifier('not-an-identifier'), null)
})
