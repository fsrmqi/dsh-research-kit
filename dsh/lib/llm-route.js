import { jsonReply, resolveAllowedCorsOrigin } from './http-json.js'

export function stripJsonFence(output) {
  return String(output || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

export async function collectLlmText({
  llm,
  route,
  system,
  text,
  maxTokens,
  sessionId,
  purpose,
  signal,
  maxOutputChars,
  incompleteMessage = 'Agent 输出未正常完成。',
  tooLongMessage = 'Agent 输出过长。',
  emptyMessage = 'Agent 未返回完整输出。',
}) {
  let output = ''
  let finished = false
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-research-kit' } }],
    maxTokens,
    sessionId,
    purpose,
    signal,
  })) {
    signal?.throwIfAborted()
    if (chunk.type === 'finish') {
      if (chunk.reason?.kind !== 'stop') throw new Error(incompleteMessage)
      finished = true
      break
    }
    if (chunk.type === 'text-delta') output += chunk.text
    if (chunk.type === 'block-end' && chunk.block?.type === 'text' && !output) output = chunk.block.text
    if (maxOutputChars && output.length > maxOutputChars) throw new Error(tooLongMessage)
  }
  if (!finished || !output.trim()) throw new Error(emptyMessage)
  return output
}

export function createAgentRouteHandler({
  path,
  timeoutMs = 120_000,
  methodNotAllowedBody = null,
  sessionRequiredBody = { error: 'session_id_required' },
  onRequest,
}) {
  return async function handler(req, res) {
    const reply = (status, body) => jsonReply(res, status, body, { corsOrigin: res.__agentCorsOrigin })
    const rawOrigin = String(req.headers?.origin || '').trim()
    const allowedOrigin = resolveAllowedCorsOrigin(req)
    if (req.method === 'OPTIONS') {
      if (!rawOrigin) { reply(400, { ok: false, error: 'origin_required' }); return }
      if (!allowedOrigin) { reply(403, { ok: false, error: 'origin_not_allowed' }); return }
      res.__agentCorsOrigin = allowedOrigin
      res.writeHead(204, {
        'access-control-allow-origin': allowedOrigin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        vary: 'Origin',
      })
      res.end()
      return
    }
    if (req.method !== 'POST') {
      if (methodNotAllowedBody) reply(405, methodNotAllowedBody)
      else { res.writeHead(405, { allow: 'POST' }); res.end() }
      return
    }
    if (allowedOrigin) res.__agentCorsOrigin = allowedOrigin
    const sessionId = String(new URL(req.url || path, 'http://localhost').searchParams.get('session_id') || '')
    if (!sessionId) { reply(400, sessionRequiredBody); return }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    // Node 的 response `close` 在正常响应完成后也可能触发；只在响应尚未完成时取消模型，
    // 避免正常写回后把连接误判为客户端取消。
    const abort = () => { if (!res.writableEnded) controller.abort() }
    res.on?.('close', abort)
    try {
      await onRequest({ req, res, sessionId, controller, reply })
    } finally {
      clearTimeout(timeout)
      res.off?.('close', abort)
    }
  }
}
