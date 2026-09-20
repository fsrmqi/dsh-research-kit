import { readFileSync } from 'node:fs'

export const ARCHIFY_TEMPLATE_PATH = '/dsh-research-kit/archify-template'

// 模板只在用户弹出完整回放窗口时使用；保留在服务端，避免 774KB HTML 进入主 JS。
const template = readFileSync(new URL('../vendor/archify/template.html', import.meta.url), 'utf8')

export function archifyTemplateRoute() {
  return {
    kind: 'exact', path: ARCHIFY_TEMPLATE_PATH,
    handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        return res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }))
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
      })
      return res.end(template)
    },
  }
}
