// 路由层 JSON 应答与请求体解析的共享实现。
//
// 此前 dsh/ 下 10 个路由模块各抄一份 reply、7 份 readBody/readJson：守卫（响应已销毁
// 或已结束就不再写）只有 3 份副本有，no-store 只有 4 份有——「一起改才不出偏差」的
// 重复，收进这里。各路由自己的契约（上限数值、字节/字符口径、报错文案、空体语义、
// CORS 来源）仍由调用方显式传入，这里不替任何路由改数值。
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

// 本机 DSH 路由只允许回环来源、与请求 Host 一致的同源来源，或显式配置的白名单来源，
// 避免任意外部网页通过反射 Origin 跨站访问本机接口。
export function resolveAllowedCorsOrigin(req, { env = process.env } = {}) {
  const origin = String(req?.headers?.origin || '').trim()
  if (!origin) return ''
  let parsed
  try { parsed = new URL(origin) } catch { return '' }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
  if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return origin
  const reqHost = String(req?.headers?.host || '').trim().toLowerCase()
  if (reqHost && parsed.host.toLowerCase() === reqHost) return origin
  const allowed = String(env?.DSH_RESEARCH_KIT_ALLOWED_ORIGINS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  if (allowed.includes(origin)) return origin
  return ''
}

export function jsonReply(res, status, body, { headers, corsOrigin } = {}) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(corsOrigin ? { 'access-control-allow-origin': corsOrigin, vary: 'Origin' } : {}),
    ...headers,
  })
  res.end(JSON.stringify(body))
}

export async function readJsonBody(req, {
  maxBytes,
  maxChars,
  tooLargeMessage = 'body_too_large',
  invalidJsonMessage = 'invalid_json',
  emptyBodyAsObject = false,
  destroyOnTooLarge = false,
  requireObject = false,
} = {}) {
  // 上限必须显式：无上限读入等于把进程内存交给调用方，不能成为默认。
  if (maxBytes === undefined && maxChars === undefined) throw new Error('readJsonBody 需要显式上限（maxBytes 或 maxChars）')
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (maxBytes !== undefined ? Buffer.byteLength(raw) > maxBytes : raw.length > maxChars) {
      if (destroyOnTooLarge) req.destroy()
      const error = new Error(tooLargeMessage)
      error.code = 'body_too_large'
      throw error
    }
  }
  let parsed
  try {
    parsed = JSON.parse(emptyBodyAsObject ? (raw || '{}') : raw)
  } catch {
    const error = new Error(invalidJsonMessage)
    error.code = 'invalid_json'
    throw error
  }
  if (requireObject && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
    const error = new Error(invalidJsonMessage)
    error.code = 'invalid_json'
    throw error
  }
  return parsed
}
