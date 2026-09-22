import test from 'node:test'
import assert from 'node:assert/strict'
import databases from '../catalog/resources/index.js'
import { readFileSync } from 'node:fs'
import { canWriteDraft, supportsSafeInsert, writeDraftText } from '../src/lib/input-actions.js'
import { databaseQueryRoute, DATABASE_QUERY_PATH } from '../dsh/database-query.js'
import { memorySearchRoute } from '../dsh/memory-search.js'

test('安全插入：宿主支持时写入捕获的插入点，不再覆盖整段草稿', () => {
  const calls = []
  const inputActions = {
    captureInsertion: () => calls.push('capture') && { start: 7, end: 7, draftRev: 3 },
    insertText: (text, span) => calls.push(['insert', text, span]) && true,
    setDraft: () => calls.push('replace'),
  }
  assert.equal(canWriteDraft(inputActions), true)
  const written = writeDraftText(inputActions, '新证据')
  assert.deepEqual(written, { ok: true, inserted: true })
  assert.deepEqual(calls, ['capture', ['insert', '新证据', { start: 7, end: 7, draftRev: 3 }]])
})

test('安全插入：草稿修订过期时返回 stale，绝不静默覆盖用户新输入', () => {
  const calls = []
  const inputActions = {
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 3 }),
    insertText: () => false,
    setDraft: text => calls.push(text),
  }
  const written = writeDraftText(inputActions, '过期结果')
  assert.deepEqual(written, { ok: false, inserted: false, stale: true })
  assert.deepEqual(calls, [])
})

test('安全插入：旧宿主回落 setDraft，完全缺失时如实失败', () => {
  const calls = []
  const legacy = { setDraft: text => calls.push(text) }
  assert.equal(supportsSafeInsert(legacy), false)
  assert.deepEqual(writeDraftText(legacy, '旧宿主'), { ok: true, inserted: false, fallback: true })
  assert.deepEqual(writeDraftText({}, '无宿主'), { ok: false })
  assert.deepEqual(calls, ['旧宿主'])
})

test('即时配置：关闭 Agent 回退后不可直查来源返回失败，而不是伪造成回退任务', async () => {
  const route = databaseQueryRoute({
    web: { async fetch() { throw new Error('不应调用') } },
    databases,
    logger: null,
    config: { allowAgentFallback: { get: () => false } },
  })
  const response = { status: 0, body: '', writeHead(value) { this.status = value }, end(value = '') { this.body += value } }
  await route.handler({ method: 'GET', url: `${DATABASE_QUERY_PATH}?database_id=scopus&q=cfg-${Math.random()}&limit=1`, socket: { remoteAddress: `cfg-fb-${Math.random()}` } }, response)
  assert.equal(response.status, 502)
  assert.match(JSON.parse(response.body).message, /Agent 回退已关闭/)
})

test('即时配置：volatile 每分钟上限会在下一次请求生效', async () => {
  let limit = 2
  const route = databaseQueryRoute({
    web: { async fetch() { return { statusCode: 200, body: { kind: 'text', content: '[]' }, truncated: false } } },
    databases,
    logger: null,
    config: { databaseRequestsPerMinute: { get: () => limit } },
  })
  const clientKey = `live-rate-${Math.random()}`
  for (let index = 0; index < 2; index += 1) {
    const response = { status: 0, body: '', writeHead(value) { this.status = value }, end(value = '') { this.body += value } }
    await route.handler({ method: 'GET', url: `${DATABASE_QUERY_PATH}?database_id=crossref&q=live-${index}-${Math.random()}&limit=1`, socket: { remoteAddress: clientKey } }, response)
    assert.equal(response.status, 200)
  }
  limit = 1
  const third = { status: 0, body: '', writeHead(value) { this.status = value }, end(value = '') { this.body += value } }
  await route.handler({ method: 'GET', url: `${DATABASE_QUERY_PATH}?database_id=crossref&q=live-2-${Math.random()}&limit=1`, socket: { remoteAddress: clientKey } }, third)
  assert.equal(third.status, 429)
  assert.match(JSON.parse(third.body).message, /每分钟 1 次/)
})

test('即时配置：volatile Memory server 会成为默认检索目标，显式 server 仍可覆盖', async () => {
  const executed = []
  const schemas = [
    { name: 'mcp__memory-center__search', parameters: { properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'mcp__pubmed__search', parameters: { properties: { query: { type: 'string' } }, required: ['query'] } },
  ]
  const route = memorySearchRoute({
    config: { memoryServer: { get: () => 'pubmed' } },
    tools: {
      schemas: () => schemas,
      async execute(input) { executed.push(input.name); return { content: [{ type: 'text', text: 'ok' }] } },
    },
  })
  const post = async body => {
    const req = { method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) } }
    const pending = {}
    pending.done = new Promise(resolve => {
      pending.res = { writeHead() {}, end(value) { resolve(JSON.parse(value)) } }
    })
    await route.handler(req, pending.res)
    return pending.done
  }
  assert.equal((await post({ query: 'default' })).tool, 'mcp__pubmed__search')
  assert.equal((await post({ query: 'explicit', server: 'memory-center' })).tool, 'mcp__memory-center__search')
  assert.deepEqual(executed, ['mcp__pubmed__search', 'mcp__memory-center__search'])
})

test('DSH 产物注册插件详情状态区，不把状态探测当成能力升级', () => {
  const client = readFileSync(new URL('../ui/client.js', import.meta.url), 'utf8')
  assert.match(client, /plugins\.detail\.section/)
  assert.match(client, /dsh-research-kit-status/)
  assert.match(client, /部署事实 · 不改变目录标注/)
})
