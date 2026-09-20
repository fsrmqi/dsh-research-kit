import { createHash } from 'node:crypto'

// 生成物 URL 固定，但内容会随插件版本变化。用强 ETag + no-cache 要求浏览器每次复用前
// 先确认版本，避免新 client.js 搭配旧目录/PromptKit/模板造成契约错配。
export function staticArtifactRoute({ path, body, contentType }) {
  const etag = `"${createHash('sha256').update(body).digest('base64url')}"`
  return {
    kind: 'exact', path,
    handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        return res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }))
      }
      const headers = {
        'cache-control': 'no-cache',
        'content-type': contentType,
        etag,
        'x-content-type-options': 'nosniff',
      }
      if (req.headers?.['if-none-match'] === etag) {
        res.writeHead(304, headers)
        return res.end()
      }
      res.writeHead(200, headers)
      return res.end(body)
    },
  }
}
