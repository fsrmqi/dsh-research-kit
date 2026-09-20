import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { catalogDataRoute } from '../dsh/catalog-data.js'
import { archifyTemplateRoute } from '../dsh/archify-template.js'
import { promptKitClientRoute } from '../dsh/promptkit-client.js'
import { loadArchifyTemplate } from '../src/route-replay.js'
import { invalidateEvidenceSync, syncEvidenceVaultWithFiles } from '../src/research-evidence-vault.js'

function captureRoute(route, method = 'GET') {
  return new Promise((resolve, reject) => {
    let status = 0
    let headers = {}
    route.handler({ method }, {
      writeHead(nextStatus, nextHeaders) { status = nextStatus; headers = nextHeaders },
      end(body) { resolve({ status, headers, body: String(body || '') }) },
    })?.catch?.(reject)
  })
}

test('延迟资源路由：目录、PromptKit 与 Archify 模板可独立读取', async () => {
  const [catalogResponse, promptKitResponse, templateResponse] = await Promise.all([
    captureRoute(catalogDataRoute()),
    captureRoute(promptKitClientRoute()),
    captureRoute(archifyTemplateRoute()),
  ])
  assert.equal(catalogResponse.status, 200)
  assert.equal(JSON.parse(catalogResponse.body).data.workflows.length, 349)
  assert.equal(promptKitResponse.status, 200)
  assert.match(promptKitResponse.headers['content-type'], /text\/javascript/)
  assert.match(promptKitResponse.body, /__DSH_RESEARCH_PROMPTKIT__/)
  assert.equal(templateResponse.status, 200)
  assert.match(templateResponse.body, /ARCHIFY:SVG_SLOT_START/)
})

test('Archify 模板加载：并发调用共享同一个请求', async () => {
  let requests = 0
  const fetcher = async () => {
    requests++
    return { ok: true, text: async () => '<html>archify</html>' }
  }
  const [first, second] = await Promise.all([loadArchifyTemplate(fetcher), loadArchifyTemplate(fetcher)])
  assert.equal(first, '<html>archify</html>')
  assert.equal(second, first)
  assert.equal(requests, 1)
})

test('证据同步：同项目并发和短时重复刷新只发一个请求，失效后重新读取', async () => {
  const originalWindow = globalThis.window
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.window = {}
  globalThis.fetch = async () => {
    requests++
    return { ok: true, json: async () => ({ ok: true, entries: [] }) }
  }
  const project = `perf-${Date.now()}`
  try {
    invalidateEvidenceSync(project)
    await Promise.all([syncEvidenceVaultWithFiles(project), syncEvidenceVaultWithFiles(project)])
    await syncEvidenceVaultWithFiles(project)
    assert.equal(requests, 1)
    invalidateEvidenceSync(project)
    await syncEvidenceVaultWithFiles(project)
    assert.equal(requests, 2)
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    globalThis.fetch = originalFetch
  }
})

test('大图与长列表性能守卫已接线', () => {
  const graph = readFileSync(new URL('../src/research-evidence-graph.js', import.meta.url), 'utf8')
  const vault = readFileSync(new URL('../src/research-evidence-vault.js', import.meta.url), 'utf8')
  assert.match(graph, /GRAPH_RENDER_NODE_LIMIT = 300/)
  assert.match(graph, /renderGraph\.routes\.map/)
  assert.match(vault, /selectedIdSet\.has\(item\.id\)/)
  assert.match(vault, /contentVisibility: 'auto'/)
})
