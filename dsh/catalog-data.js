import { readFileSync } from 'node:fs'

export const CATALOG_DATA_PATH = '/dsh-research-kit/catalog-data'

const body = readFileSync(new URL('../ui/catalog-data.json', import.meta.url), 'utf8')

export function catalogDataRoute() {
  return {
    kind: 'exact', path: CATALOG_DATA_PATH,
    handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        return res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }))
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
      })
      return res.end(body)
    },
  }
}
