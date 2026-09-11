import test from 'node:test'
import assert from 'node:assert/strict'
import databases from '../catalog/resources/index.js'
import { runDatabaseQuery, databaseQueryRoute, DATABASE_QUERY_PATH } from '../dsh/database-query.js'

const database = id => databases.find(item => item.id === id)
const jsonResult = value => ({ statusCode: 200, body: { kind: 'text', content: JSON.stringify(value) }, truncated: false })

test('PubChem 成功响应可解析且遵守结果数量上限', async () => {
  const web = { async fetch() { return jsonResult({ PropertyTable: { Properties: [
    { CID: 2244, IUPACName: 'aspirin' }, { CID: 2, IUPACName: 'other' },
  ] } }) } }
  const result = await runDatabaseQuery({ web, database: database('pubchem'), query: 'aspirin', limit: 1 })
  assert.equal(result.mode, 'direct')
  assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0].url, 'https://pubchem.ncbi.nlm.nih.gov/compound/2244')
})

test('Crossref 公开查询解析为可引用的结构化记录', async () => {
  const web = { async fetch() { return jsonResult({ message: { items: [{ DOI: '10.1/demo', title: ['研究标题'], URL: 'https://doi.org/10.1/demo', author: [{ family: 'Li' }], 'container-title': ['Journal'], 'published-print': { 'date-parts': [[2026]] } }] } }) } }
  const result = await runDatabaseQuery({ web, database: database('crossref'), query: 'genomics', limit: 3 })
  assert.equal(result.mode, 'direct')
  assert.deepEqual(result.sources[0], { id: '10.1/demo', title: '研究标题', url: 'https://doi.org/10.1/demo', meta: 'Li · Journal · 2026', summary: '' })
})

test('无直查适配器的来源返回 Agent 回退提示，不伪造查询结果', async () => {
  const result = await runDatabaseQuery({ web: { async fetch() { throw new Error('不应调用') } }, database: database('gnomad'), query: 'BRCA1' })
  assert.equal(result.mode, 'agent-fallback')
  assert.equal(result.sources.length, 0)
  assert.match(result.prompt, /不得编造/)
})

test('公开 API 限流时平滑回退给 Agent，而不是把限流当作数据结果', async () => {
  const web = { async fetch() { return { statusCode: 429, body: { kind: 'text', content: '{"message":"rate limited"}' }, truncated: false } } }
  const result = await runDatabaseQuery({ web, database: database('semantic-scholar'), query: 'single-cell RNA' })
  assert.equal(result.mode, 'agent-fallback')
  assert.match(result.reason, /429/)
  assert.match(result.prompt, /不得编造/)
})

test('GBIF 公开查询解析物种出现记录', async () => {
  const web = { async fetch() { return jsonResult({ results: [{ key: 123, scientificName: 'Panthera leo', country: 'KE', eventDate: '2025-01-01', basisOfRecord: 'HUMAN_OBSERVATION', datasetName: 'Demo' }] }) } }
  const result = await runDatabaseQuery({ web, database: database('gbif'), query: 'lion' })
  assert.equal(result.mode, 'direct')
  assert.equal(result.sources[0].url, 'https://www.gbif.org/occurrence/123')
})

// 路由层行为：缓存命中不重复出网；速率上限返回 429；Agent 回退响应带 prompt。
function makeRequest(url, clientKey = '203.0.113.9') {
  return { method: 'GET', url, socket: { remoteAddress: clientKey } }
}
function makeResponse() {
  return { status: 0, body: '', writeHead(status) { this.status = status }, end(value) { this.body = value ?? '' } }
}

test('路由层：相同查询 5 分钟内命中缓存，不再调用公开 API', async () => {
  let calls = 0
  const web = { async fetch() { calls += 1; return jsonResult({ message: { items: [{ DOI: '10.2/cache', title: ['缓存样例'], URL: 'https://doi.org/10.2/cache' }] } }) } }
  const route = databaseQueryRoute({ web, databases, logger: null })
  const url = `${DATABASE_QUERY_PATH}?database_id=crossref&q=cachedemo&limit=3`
  const first = makeResponse()
  await route.handler(makeRequest(`${url}&_t=${Date.now()}-1`), first)
  assert.equal(first.status, 200)
  const second = makeResponse()
  await route.handler(makeRequest(`${url}&_t=${Date.now()}-2`), second)
  assert.equal(second.status, 200)
  assert.equal(JSON.parse(second.body).cached, true)
  assert.equal(calls, 1, '第二次查询应命中缓存，不重复出网')
})

test('路由层：规范化等价查询，并合并并发的上游请求', async () => {
  let calls = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const web = { async fetch() {
    calls += 1
    await gate
    return jsonResult({ message: { items: [{ DOI: '10.2/coalesced', title: ['合并样例'], URL: 'https://doi.org/10.2/coalesced' }] } })
  } }
  const route = databaseQueryRoute({ web, databases, logger: null })
  const first = makeResponse()
  const second = makeResponse()
  const a = route.handler(makeRequest(`${DATABASE_QUERY_PATH}?database_id=crossref&q=%20coalesced%20&limit=99`, `coalesce-${Math.random()}`), first)
  const b = route.handler(makeRequest(`${DATABASE_QUERY_PATH}?database_id=crossref&q=coalesced&limit=10`, `coalesce-${Math.random()}`), second)
  await Promise.resolve()
  assert.equal(calls, 1, '同一规范化键的并发请求只能访问一次上游')
  release()
  await Promise.all([a, b])
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(calls, 1)
})

test('路由层：同一客户端超出每分钟预算返回 429', async () => {
  const web = { async fetch() { return jsonResult({ message: { items: [] } }) } }
  const route = databaseQueryRoute({ web, databases, logger: null })
  const clientKey = `test-${Math.random()}`
  let sawLimited = false
  for (let index = 0; index < 15; index += 1) {
    const response = makeResponse()
    // 每次不同查询词避免命中缓存；缓存命中不计入速率窗口。
    await route.handler(makeRequest(`${DATABASE_QUERY_PATH}?database_id=crossref&q=q${Date.now()}-${index}&limit=1`, clientKey), response)
    if (response.status === 429) { sawLimited = true; assert.match(JSON.parse(response.body).message, /频繁/) ; break }
    assert.equal(response.status, 200)
  }
  assert.ok(sawLimited, '连续查询应触发每分钟速率限制')
})

test('路由层：Agent 回退响应带可执行的查询任务文本', async () => {
  const route = databaseQueryRoute({ web: { async fetch() { throw new Error('不应调用') } }, databases, logger: null })
  const response = makeResponse()
  await route.handler(makeRequest(`${DATABASE_QUERY_PATH}?database_id=scopus&q=test&limit=1`, `fb-${Math.random()}`), response)
  assert.equal(response.status, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.mode, 'agent-fallback')
  assert.match(body.prompt, /不得编造/)
})
