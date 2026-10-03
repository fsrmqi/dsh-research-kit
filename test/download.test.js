import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// 导出链原先在 6 个模块里各写一遍，其中两处在 click() 之后**同步** revokeObjectURL：
// 下载还在读 Blob，回收早了会被浏览器取消（用户看到的是"点了导出没反应"）。
// 这里钉住两件事：回收必须是异步的；全仓只允许 src/lib/download.js 碰 Blob URL。

const ROOT = process.cwd()

function installStubs() {
  const calls = { created: [], revoked: [], clicked: 0, downloads: [] }
  const saved = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    URL: Object.getOwnPropertyDescriptor(globalThis, 'URL'),
    Blob: Object.getOwnPropertyDescriptor(globalThis, 'Blob'),
  }
  globalThis.document = {
    createElement: () => {
      const link = {
        href: '',
        download: '',
        click() { calls.clicked += 1; calls.downloads.push(link.download) },
      }
      return link
    },
  }
  globalThis.Blob = class {
    constructor(parts, options) { this.parts = parts; this.type = options?.type ?? '' }
  }
  globalThis.URL = {
    createObjectURL(blob) { calls.created.push(blob); return `blob:rk-${calls.created.length}` },
    revokeObjectURL(url) { calls.revoked.push(url) },
  }
  return {
    calls,
    restore() {
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    },
  }
}

test('导出：link 落盘触发点击，Blob URL 回收必须异步（同步回收会被取消下载）', async t => {
  const stubs = installStubs()
  t.after(() => stubs.restore())
  const { downloadJsonFile } = await import('../src/lib/download.js')
  const ok = downloadJsonFile('{"a":1}\n', 'research-evidence-publication.json', { revokeDelayMs: 0 })
  assert.equal(ok, true, '有 DOM 时应报告成功')
  assert.equal(stubs.calls.clicked, 1, '必须触发一次点击')
  assert.deepEqual(stubs.calls.downloads, ['research-evidence-publication.json'], '文件名要落到 download 属性')
  assert.equal(stubs.calls.created.length, 1, '只创建一个 Blob URL')
  assert.equal(stubs.calls.created[0].type, 'application/json', 'JSON 导出要带 MIME')
  assert.equal(stubs.calls.created[0].parts[0], '{"a":1}\n', '导出内容不得被改写')
  assert.deepEqual(stubs.calls.revoked, [], '此刻不得回收：同步 revoke 会取消下载')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(stubs.calls.revoked, ['blob:rk-1'], '延迟一个事件循环后再回收同一个 URL')
})

test('导出：缺 DOM/URL/Blob 时安静降级，不抛错也不泄漏 URL', async t => {
  const stubs = installStubs()
  t.after(() => stubs.restore())
  const { canDownload, downloadBlob, downloadText } = await import('../src/lib/download.js')
  assert.equal(canDownload(), true)
  delete globalThis.document
  assert.equal(canDownload(), false, '没有 document 时不得声称可导出')
  assert.equal(downloadText('<html></html>', 'text/html', 'x.html'), false)
  assert.equal(downloadBlob(new Blob(['x']), 'x.bin'), false)
  assert.deepEqual(stubs.calls.created, [], '降级路径不得创建 Blob URL')
  assert.equal(stubs.calls.clicked, 0)
})

test('导出收敛守卫：只有 src/lib/download.js 创建下载链，产物里也只有一处', () => {
  const dirs = ['src', 'src/lib', 'dsh']
  const files = []
  for (const dir of dirs) {
    for (const name of readdirSync(resolve(ROOT, dir))) {
      if (name.endsWith('.js')) files.push(`${dir}/${name}`)
    }
  }
  const offenders = files.filter(file => file !== 'src/lib/download.js'
    && /createObjectURL|revokeObjectURL/.test(readFileSync(resolve(ROOT, file), 'utf8')))
  assert.deepEqual(offenders, [], `导出必须走 src/lib/download.js，禁止各自重写：${offenders.join(', ')}`)
  const bundle = readFileSync(resolve(ROOT, 'ui/client.js'), 'utf8')
  const anchors = (bundle.match(/document\.createElement\('a'\)/g) || []).length
  assert.equal(anchors, 1, `产物里创建下载 <a> 的位置应恰好 1 处，实测 ${anchors}`)
})
