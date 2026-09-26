import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { catalogDataRoute } from '../dsh/catalog-data.js'
import { archifyTemplateRoute } from '../dsh/archify-template.js'
import { promptKitClientRoute } from '../dsh/promptkit-client.js'
import { loadArchifyTemplate } from '../src/route-replay.js'
import { evidenceVaultStore, invalidateEvidenceSync, syncEvidenceVaultWithFiles } from '../src/research-evidence-vault.js'

function captureRoute(route, method = 'GET', requestHeaders = {}) {
  return new Promise((resolve, reject) => {
    let status = 0
    let headers = {}
    route.handler({ method, headers: requestHeaders }, {
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
  for (const response of [catalogResponse, promptKitResponse, templateResponse]) {
    assert.equal(response.headers['cache-control'], 'no-cache')
    assert.match(response.headers.etag, /^".+"$/)
  }
  const cached = await captureRoute(catalogDataRoute(), 'GET', { 'if-none-match': catalogResponse.headers.etag })
  assert.equal(cached.status, 304)
  assert.equal(cached.body, '')
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

test('迁移备份只拉取文件侧证据，不因反向回写的重复来源阻断导出', async () => {
  const originalWindow = globalThis.window
  const originalFetch = globalThis.fetch
  const project = `transfer-pull-${Date.now()}`
  let posts = 0
  globalThis.window = {}
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'POST') {
      posts++
      return { ok: true, json: async () => ({ ok: true, added: 0, skipped: 1 }) }
    }
    return { ok: true, json: async () => ({ ok: true, entries: [{
      id: `${project}-file`, title: '文件侧来源', identifier_type: 'doi',
      identifier: '10.1234/file-side', project, saved_at: new Date().toISOString(),
    }] }) }
  }
  try {
    const store = evidenceVaultStore()
    await store.save({ id: `${project}-local`, title: '页面侧来源', identifierKind: 'doi',
      identifier: '10.1234/page-side', project })
    const result = await syncEvidenceVaultWithFiles(project, { force: true, pullOnly: true })
    assert.equal(result.skipped, false)
    assert.equal(result.imported, 1)
    assert.equal(result.exported, 0)
    assert.equal(posts, 0)
    assert.equal((await store.list({ project })).length, 2)
  } finally {
    invalidateEvidenceSync(project)
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    globalThis.fetch = originalFetch
  }
})

test('迁移同步只计数文件侧已有同源，日常严格同步仍报告冲突', async () => {
  const originalWindow = globalThis.window
  const originalFetch = globalThis.fetch
  const project = `transfer-existing-${Date.now()}`
  globalThis.window = {}
  globalThis.fetch = async (_url, options = {}) => options.method === 'POST'
    ? { ok: true, json: async () => ({ ok: true, added: 0, skipped: 1 }) }
    : { ok: true, json: async () => ({ ok: true, entries: [] }) }
  try {
    await evidenceVaultStore().save({ id: `${project}-local`, title: '待同步来源',
      identifierKind: 'doi', identifier: '10.1234/already-file-side', project })
    await assert.rejects(syncEvidenceVaultWithFiles(project, { force: true }), /重复来源/)
    const result = await syncEvidenceVaultWithFiles(project, { force: true, allowExistingSources: true })
    assert.equal(result.exported, 0)
    assert.equal(result.existingSources, 1)
  } finally {
    invalidateEvidenceSync(project)
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    globalThis.fetch = originalFetch
  }
})

test('大图与长列表性能守卫已接线', () => {
  const graph = readFileSync(new URL('../src/research-evidence-graph.js', import.meta.url), 'utf8')
  const vault = readFileSync(new URL('../src/research-evidence-vault.js', import.meta.url), 'utf8')
  const vaultView = readFileSync(new URL('../src/research-vault.js', import.meta.url), 'utf8')
  const workbench = readFileSync(new URL('../src/research-workbench.js', import.meta.url), 'utf8')
  const overlay = readFileSync(new URL('../src/composer-overlay.js', import.meta.url), 'utf8')
  const consoleView = readFileSync(new URL('../src/research-console.js', import.meta.url), 'utf8')
  const replay = readFileSync(new URL('../src/route-replay.js', import.meta.url), 'utf8')
  const activityRoute = readFileSync(new URL('../dsh/agent-activity.js', import.meta.url), 'utf8')
  const activityView = readFileSync(new URL('../src/agent-activity.js', import.meta.url), 'utf8')
  assert.match(graph, /GRAPH_RENDER_NODE_LIMIT = 300/)
  assert.match(graph, /layoutEvidenceGraph\(interactiveGraph\)/)
  assert.match(graph, /const exportLayout = hiddenNodeCount \? layoutEvidenceGraph\(graph\) : layout/)
  assert.match(vault, /selectedIdSet\.has\(item\.id\)/)
  assert.match(vault, /contentVisibility: 'auto'/)
  assert.match(vault, /EVIDENCE_SYNC_CACHE_LIMIT = 64/)
  assert.match(vaultView, /linkRefreshVersion\.current/)
  assert.match(vaultView, /assetRefreshVersion\.current/)
  assert.match(vaultView, /React\.memo\(/)
  assert.match(workbench, /useDeferredValue\(query\)/)
  assert.match(workbench, /useMemo\(\(\) => groupEntriesByCategory\(listEntries\)/)
  assert.match(overlay, /useDeferredValue\(query\)/)
  assert.doesNotMatch(consoleView, /Promise\.all\(\[loadBrowserCatalog\(\), loadPromptKit\(\)\]\)/)
  assert.match(consoleView, /current\.id === 'catalog' \|\| promptKitLoaded/)
  assert.match(consoleView, /const \[catalogError, setCatalogError\]/)
  assert.match(consoleView, /const \[promptKitError, setPromptKitError\]/)
  assert.match(replay, /if \(popup\.closed\) return null/g)
  assert.match(activityRoute, /record\.at >= since/)
  assert.match(activityRoute, /checkpointSnapshots/)
  assert.match(activityView, /activityKey\(call\)/)
})
