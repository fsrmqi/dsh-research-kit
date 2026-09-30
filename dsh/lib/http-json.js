// 路由层 JSON 应答与请求体解析的共享实现。
//
// 此前 dsh/ 下 10 个路由模块各抄一份 reply、7 份 readBody/readJson：守卫（响应已销毁
// 或已结束就不再写）只有 3 份副本有，no-store 只有 4 份有——「一起改才不出偏差」的
// 重复，收进这里。各路由自己的契约（上限数值、字节/字符口径、报错文案、空体语义、
// CORS 来源）仍由调用方显式传入，这里不替任何路由改数值。
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
  try {
    return JSON.parse(emptyBodyAsObject ? (raw || '{}') : raw)
  } catch {
    throw new Error(invalidJsonMessage)
  }
}
