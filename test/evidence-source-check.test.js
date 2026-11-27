import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { agentActivityRoute } from '../dsh/agent-activity.js'
import { evidenceSyncRoute } from '../dsh/evidence-sync.js'
import { checkEvidenceSource, compareSourceTitle, evidenceSourceCheckRoute } from '../dsh/evidence-source-check.js'

test('官方 DOI 元数据核对不等于原文核验', async () => {
  const web = { fetch: async () => ({ statusCode: 200, body: { content: JSON.stringify({ message: {
    title: ['Barley NP1 controls male sterility'], 'container-title': ['Plant Journal'], published: { 'date-parts': [[2025]] }, URL: 'https://doi.org/10.1234/barley',
  } }) } }) }
  const result = await checkEvidenceSource(web, { title: 'Barley NP1 controls male sterility', identifierKind: 'doi', identifier: '10.1234/barley' })
  assert.equal(result.status, 'matched')
  assert.equal(result.contentVerified, false)
  assert.equal(result.official.journal, 'Plant Journal')
  assert.equal(compareSourceTitle('Different title', result.official.title), 'mismatch')
  await assert.rejects(() => checkEvidenceSource(web, { identifierKind: 'accession', identifier: 'A-5438' }), /仅支持 DOI 或 PMID/)
  assert.equal(evidenceSourceCheckRoute({ web }).path, '/dsh-research-kit/evidence-source-check')
})

test('元数据核对路由收敛 CORS、并发核对条目并正确映射 400/413 状态码', async t => {
  let active = 0
  let maxActive = 0
  const web = {
    fetch: async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 10))
      active -= 1
      return { statusCode: 200, body: { content: JSON.stringify({ message: { title: ['Concurrent check'], URL: 'https://doi.org/10.1000/x' } }) } }
    },
  }
  const route = evidenceSourceCheckRoute({ web })
  const makeRes = () => ({ headers: {}, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) }, end(data) { this.data = data; this.writableEnded = true } })

  const untrusted = makeRes()
  await route.handler({ method: 'OPTIONS', headers: { origin: 'https://evil.example', host: '127.0.0.1:3000' } }, untrusted)
  assert.equal(untrusted.status, 403)
  assert.equal(untrusted.headers['access-control-allow-origin'], undefined)

  const loopback = makeRes()
  await route.handler({ method: 'OPTIONS', headers: { origin: 'http://localhost:5173', host: '127.0.0.1:3000' } }, loopback)
  assert.equal(loopback.status, 204)
  assert.equal(loopback.headers['access-control-allow-origin'], 'http://localhost:5173')

  const nullBody = makeRes()
  await route.handler({ method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { yield 'null' } }, nullBody)
  assert.equal(nullBody.status, 400)

  const oversizedRequests = [
    [route, 16_384],
    [agentActivityRoute(), 32_768],
    [evidenceSyncRoute(), 1_048_576],
  ]
  const handlers = new Map(oversizedRequests.map(([route]) => [route.path, route.handler]))
  const server = createServer((req, res) => handlers.get(req.url)(req, res))
  t.after(() => new Promise(resolve => server.close(resolve)))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  for (const [route, maxChars] of oversizedRequests) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route.path}`, {
      method: 'POST',
      body: ' '.repeat(maxChars + 1),
      signal: AbortSignal.timeout(5_000),
    })
    assert.equal(response.status, 413, route.path)
    assert.equal(response.headers.get('connection'), 'close')
    assert.deepEqual(await response.json(), { ok: false, error: 'body_too_large' })
  }

  const ok = makeRes()
  await route.handler({
    method: 'POST',
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield JSON.stringify({
        entries: ['1', '2', '3'].map(id => ({ id, title: 'Concurrent check', identifierKind: 'doi', identifier: `10.1000/c${id}` })),
      })
    },
  }, ok)
  assert.equal(ok.status, 200)
  assert.ok(maxActive >= 2, `期望并发核对，实测 maxActive=${maxActive}`)
})
