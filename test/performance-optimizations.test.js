import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { catalogDataRoute, catalogItemRoute, catalogSearchRoute } from '../dsh/catalog-data.js'
import { archifyTemplateRoute } from '../dsh/archify-template.js'
import { promptKitClientRoute } from '../dsh/promptkit-client.js'
import { loadArchifyTemplate } from '../src/route-replay.js'
import { evidenceVaultStore, invalidateEvidenceSync, syncEvidenceVaultWithFiles } from '../src/lib/evidence-vault-sync.js'

function captureRoute(route, method = 'GET', requestHeaders = {}, url = route.path) {
  return new Promise((resolve, reject) => {
    let status = 0
    let headers = {}
    route.handler({ method, url, headers: requestHeaders }, {
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
  assert.equal(JSON.parse(catalogResponse.body).data.workflows.length, 351)
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
  // 按需详情与 Node 侧全文检索路由
  const itemRoute = catalogItemRoute()
  const itemResponse = await captureRoute(itemRoute, 'GET', {}, `${itemRoute.path}?id=review-paper`)
  assert.equal(itemResponse.status, 200)
  assert.ok(JSON.parse(itemResponse.body).item.prompt.length > 50)
  const itemCached = await captureRoute(itemRoute, 'GET', { 'if-none-match': itemResponse.headers.etag }, `${itemRoute.path}?id=review-paper`)
  assert.equal(itemCached.status, 304)
  assert.equal((await captureRoute(itemRoute, 'GET', {}, `${itemRoute.path}?id=Bad_ID`)).status, 400)
  assert.equal((await captureRoute(itemRoute, 'GET', {}, `${itemRoute.path}?id=missing-workflow`)).status, 404)
  const searchRoute = catalogSearchRoute()
  const searchResponse = await captureRoute(searchRoute, 'GET', {}, `${searchRoute.path}?q=${encodeURIComponent('禁止静默丢弃')}&type=skill`)
  assert.equal(searchResponse.status, 200)
  assert.ok(JSON.parse(searchResponse.body).results.some(row => row.id === 'data-integrity'))
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
  let remote = []
  let postCount = 0
  let race = false
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'POST') {
      postCount++
      if (race) remote = JSON.parse(options.body).entries.map(row => ({ ...row, id: `${row.id}-remote` }))
      return { ok: true, json: async () => ({ ok: true, added: 0, skipped: 1 }) }
    }
    return { ok: true, json: async () => ({ ok: true, entries: remote }) }
  }
  try {
    await evidenceVaultStore().save({ id: `${project}-local`, title: '待同步来源',
      identifierKind: 'doi', identifier: '10.1234/already-file-side', project })
    await assert.rejects(syncEvidenceVaultWithFiles(project, { force: true }), /重复来源/)
    const result = await syncEvidenceVaultWithFiles(project, { force: true, allowExistingSources: true })
    assert.equal(result.exported, 0)
    assert.equal(result.existingSources, 1)
    race = true
    const reconciled = await syncEvidenceVaultWithFiles(project, { force: true })
    assert.equal(reconciled.existingSources, 1, '并发写入后可确认同源记录，无需用户重试')
    assert.equal(reconciled.exported, 0)
    const countAfterRace = postCount
    await syncEvidenceVaultWithFiles(project, { force: true })
    assert.equal(postCount, countAfterRace)
    const other = { id: `${project}-different-key`, title: '相同文件网址', identifierKind: 'accession', identifier: 'GSE12345', project,
      url: 'https://example.org/same-source' }
    await evidenceVaultStore().save(other)
    remote.push({ id: `${project}-file-url`, title: other.title, identifier_type: 'accession', identifier: 'GSE67890', project, url: other.url })
    await syncEvidenceVaultWithFiles(project, { force: true })
    assert.equal(postCount, countAfterRace, '使用文件端规则，已存在的 URL 不应重复提交')
    assert.ok((await evidenceVaultStore().list({project})).some(row => row.id === other.id), '保留已存在的本地记录')
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
  assert.match(graph, /GRAPH_RENDER_NODE_LIMIT = 300/)
  assert.match(graph, /layoutEvidenceGraph\(interactiveGraph\)/)
  assert.match(graph, /const exportSource = renderLimitedCount \? displayGraph : interactiveGraph/)
  assert.match(graph, /const exportLayout = layoutEvidenceGraph\(exportSource\)/)
  assert.match(vault, /selectedIdSet\.has\(item\.id\)/)
  assert.match(vault, /contentVisibility: 'auto'/)
  const vaultSync = readFileSync(new URL('../src/lib/evidence-vault-sync.js', import.meta.url), 'utf8')
  assert.match(vaultSync, /EVIDENCE_SYNC_CACHE_LIMIT = 64/)
  assert.match(vaultView, /linkRefreshVersion\.current/)
  assert.match(vaultView, /assetRefreshVersion\.current/)
  assert.match(vaultView, /React\.memo\(/)
  assert.match(workbench, /useDeferredValue\(query\)/)
  assert.match(workbench, /groupEntriesByCategory\(listEntries\), \[listEntries, deferredQuery, isSpecialView\]/)
  assert.match(overlay, /useDeferredValue\(query\)/)
  assert.doesNotMatch(consoleView, /Promise\.all\(\[loadBrowserCatalog\(\), loadPromptKit\(\)\]\)/)
  assert.match(consoleView, /!needsPromptKit \|\| promptKitLoaded/)
  assert.match(consoleView, /const \[catalogError, setCatalogError\]/)
  assert.match(consoleView, /const \[promptKitError, setPromptKitError\]/)
  assert.match(replay, /if \(popup\.closed\) return null/g)
  assert.match(activityRoute, /record\.at >= since/)
  assert.match(activityRoute, /checkpointSnapshots/)
})

test('客户端活动由宿主展示，工作台无需定时轮询', () => {
  const srcDir = new URL('../src/', import.meta.url)
  const sources = readdirSync(srcDir, { recursive: true }).filter(name => String(name).endsWith('.js'))
  const polling = sources.filter(name => readFileSync(new URL(String(name), srcDir), 'utf8').includes('setInterval'))
  assert.deepEqual(polling, [])
})

test('文件同步重试会更新已存在的旧记录，并保留引用元数据', async () => {
  const originalWindow = globalThis.window; const originalFetch = globalThis.fetch
  const project = `retry-put-${Date.now()}`
  const savedAt = Date.now() - 10000
  globalThis.window = {}
  const store = evidenceVaultStore()
  const { entry } = await store.save({ id: project, title: '本地新标题', project, url: 'https://example.org/retry-put', savedAt, updatedAt: Date.now(), bibliography: { authors: ['李'], year: '2024' } })
  let puts = 0
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'PUT') {
      puts++
      const payload = JSON.parse(options.body)
      assert.equal(payload.entry.title, '本地新标题')
      assert.equal(payload.entry.bibliography.year, '2024')
      if (puts === 1) return { ok: false, status: 503 }
      return { ok: true, json: async () => ({ ok: true }) }
    }
    return { ok: true, json: async () => ({ ok: true, entries: [{ id: entry.id, title: '旧标题', project, url: entry.url, saved_at: new Date(savedAt).toISOString(), updated_at: new Date(savedAt).toISOString() }] }) }
  }
  try {
    await assert.rejects(() => syncEvidenceVaultWithFiles(project, { force: true }), /503/)
    const result = await syncEvidenceVaultWithFiles(project, { force: true })
    assert.equal(result.updated, 1)
    assert.equal(puts, 2)
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    await store.remove(entry.id)
  }
})
