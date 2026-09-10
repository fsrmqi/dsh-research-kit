import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import { SEMANTIC_ENHANCE_PATH, SEMANTIC_ENHANCE_STREAM_PATH } from '../dsh/semantic-enhance.js'
import { DATABASE_QUERY_PATH as QUERY_PATH } from '../dsh/database-query.js'

// Node half 统一注册：index.js 应注册公开查询 + 语义增强（非流式/流式）三条路由，
// 且会话模型路由随 agent/created 与 agent/disposed 增删。
function makeContext() {
  const listeners = new Map()
  const registered = []
  return {
    listeners,
    registered,
    ctx: {
      effect: callback => callback(),
      on: (name, callback) => { listeners.set(name, callback); return () => {} },
      logger: () => ({ info() {}, warn() {} }),
      web: {},
      webServer: { register: value => { registered.push(value); return () => {} } },
      llm: {},
      sessions: {},
    },
  }
}

test('index.js 统一注册三条路由且不使用 dsh-promptkit 路径', () => {
  const { ctx, registered } = makeContext()
  apply(ctx)
  assert.deepEqual(registered.map(route => route.path).sort(), [
    QUERY_PATH,
    SEMANTIC_ENHANCE_PATH,
    SEMANTIC_ENHANCE_STREAM_PATH,
  ].sort())
  assert.ok(registered.every(route => route.path.startsWith('/dsh-research-kit/')))
})

function sseResponse() {
  const chunks = []
  return {
    chunks,
    headers: {},
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) },
    write(value) { chunks.push(value) },
    end() { this.ended = true },
  }
}

test('流式语义增强：会话模型路由可驱动 SSE 逐段推送并给出最终结果', async () => {
  const { listeners, registered, ctx } = makeContext()
  ctx.llm = { async *stream() {
    yield { type: 'text-delta', text: '[DIAG] concept_clarity: 足够\n[DIAG] hidden_premise: [OK]\n[DIAG] falsifiability: [OK]\n[DIAG] actionability: 可行\n[DIAG] context_fit: 契合\n===PROMPT===\n' }
    yield { type: 'text-delta', text: '改写后的研究提示词' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  apply(ctx)
  listeners.get('agent/created')({ agent: { session: { id: 's1' }, options: { provider: 'test', model: 'test-model' } } })
  const route = registered.find(item => item.path === SEMANTIC_ENHANCE_STREAM_PATH)
  assert.ok(route, '应注册流式语义增强路由')
  const response = sseResponse()
  const request = {
    method: 'POST', url: `${SEMANTIC_ENHANCE_STREAM_PATH}?session_id=s1`, on() {}, off() {},
    async *[Symbol.asyncIterator]() { yield JSON.stringify({ draft: '请改写这段研究草稿', lang: 'zh' }) },
  }
  await route.handler(request, response)
  assert.equal(response.status, 200)
  assert.match(response.headers['content-type'], /text\/event-stream/)
  const text = response.chunks.join('')
  assert.match(text, /event: open/)
  assert.match(text, /event: stage/)
  assert.match(text, /event: delta/)
  const doneFrame = text.split('\n\n').find(frame => frame.startsWith('event: done'))
  assert.ok(doneFrame, '应有 done 结束帧')
  const payload = JSON.parse(doneFrame.split('\ndata: ')[1])
  assert.equal(payload.prompt, '改写后的研究提示词')
  assert.equal(payload.diagnosis.concept_clarity, '足够')
  assert.equal(payload.model, 'test-model')
  // 会话释放后路由应删除模型映射：再次调用报未建立路由。
  listeners.get('agent/disposed')({ agent: { session: { id: 's1' }, options: {} } })
  const response2 = sseResponse()
  await route.handler(request, response2)
  assert.equal(response2.status, 503)
})

test('语义增强：未注册会话路由时拒绝并给出可读错误', async () => {
  const { registered, ctx } = makeContext()
  apply(ctx)
  const route = registered.find(item => item.path === SEMANTIC_ENHANCE_PATH)
  const chunks = []
  const response = {
    status: 0, body: '', writeHead(status, headers) { this.status = status; this.headers = headers }, end(value) { this.body = value ?? '' }, write: value => chunks.push(value),
  }
  const request = {
    method: 'POST', url: `${SEMANTIC_ENHANCE_PATH}?session_id=missing`, on() {}, off() {},
    async *[Symbol.asyncIterator]() { yield JSON.stringify({ draft: '内容' }) },
  }
  await route.handler(request, response)
  assert.equal(response.status, 503)
  assert.match(JSON.parse(response.body).next_action, /模型路由/)
})

test('语义增强：缺 session_id 返回 400；GET 返回 405', async () => {
  const { registered, ctx } = makeContext()
  apply(ctx)
  const route = registered.find(item => item.path === SEMANTIC_ENHANCE_PATH)
  const response = { status: 0, body: '', writeHead(status) { this.status = status }, end(value) { this.body = value ?? '' } }
  await route.handler({ method: 'POST', url: SEMANTIC_ENHANCE_PATH, on() {}, off() {}, async *[Symbol.asyncIterator]() {} }, response)
  assert.equal(response.status, 400)
  await route.handler({ method: 'GET', url: SEMANTIC_ENHANCE_PATH }, response)
  assert.equal(response.status, 405)
})

test('研究上下文随请求传入且被约束（不抛错、不出现在响应中）', async () => {
  const { listeners, registered, ctx } = makeContext()
  let captured
  ctx.llm = { async *stream(options) {
    captured = options
    yield { type: 'text-delta', text: '===PROMPT===\n改写结果' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  apply(ctx)
  listeners.get('agent/created')({ agent: { session: { id: 's2' }, options: { provider: 'test', model: 'm' } } })
  const route = registered.find(item => item.path === SEMANTIC_ENHANCE_PATH)
  const response = { status: 0, body: '', writeHead(status) { this.status = status }, end(value) { this.body = value ?? '' } }
  const request = {
    method: 'POST', url: `${SEMANTIC_ENHANCE_PATH}?session_id=s2`, on() {}, off() {},
    async *[Symbol.asyncIterator]() { yield JSON.stringify({ draft: '研究草稿', lang: 'zh', researchContext: '数据库：PubMed —— 生物医学文献检索' }) },
  }
  await route.handler(request, response)
  assert.equal(response.status, 200)
  assert.match(captured.messages[0].content[0].text, /研究上下文/)
  assert.match(captured.system, /不得编造文献/)
})

test('语义增强：插件晚于会话启动时，向 ctx.sessions 惰性反查模型路由', async () => {
  const { registered, ctx } = makeContext()
  let captured
  ctx.llm = { async *stream(options) {
    captured = options
    yield { type: 'text-delta', text: '===PROMPT===\n改写结果' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  // 模拟「会话先于插件存在」：不触发 agent/created，只能靠惰性反查。
  ctx.sessions = { get: id => (id === 'late' ? { agent: { options: { provider: 'p', model: 'late-model' } } } : null) }
  apply(ctx)
  const route = registered.find(item => item.path === SEMANTIC_ENHANCE_PATH)
  const response = { status: 0, body: '', writeHead(status) { this.status = status }, end(value) { this.body = value ?? '' } }
  const request = {
    method: 'POST', url: `${SEMANTIC_ENHANCE_PATH}?session_id=late`, on() {}, off() {},
    async *[Symbol.asyncIterator]() { yield JSON.stringify({ draft: '研究草稿', lang: 'zh' }) },
  }
  await route.handler(request, response)
  assert.equal(response.status, 200)
  assert.equal(captured.model, 'late-model')
  assert.equal(captured.provider, 'p')
})

test('语义增强：sessions 形状未知或探测抛错时安全退化，不崩溃', async () => {
  const { registered, ctx } = makeContext()
  ctx.sessions = { get() { throw new Error('宿主接口不兼容') } }
  apply(ctx)
  const route = registered.find(item => item.path === SEMANTIC_ENHANCE_PATH)
  const response = { status: 0, body: '', writeHead(status) { this.status = status }, end(value) { this.body = value ?? '' } }
  const request = {
    method: 'POST', url: `${SEMANTIC_ENHANCE_PATH}?session_id=broken`, on() {}, off() {},
    async *[Symbol.asyncIterator]() { yield JSON.stringify({ draft: '研究草稿' }) },
  }
  await route.handler(request, response)
  assert.equal(response.status, 503)
})
