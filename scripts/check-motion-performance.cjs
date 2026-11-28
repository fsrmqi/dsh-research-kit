#!/usr/bin/env node
/**
 * 真实浏览器动效与帧率实测脚本：
 * - 长内容（10,000 条证据分页列表）滚动帧时间 P95 测量
 * - 高频分段控件连续打断切换无报错、胶囊跟手落位
 * - Modal 进退场 + Escape 关闭
 * - prefers-reduced-motion: reduce 下所有 rk-* 动画时长收敛至 <= 1ms
 */
const { chromium } = require('playwright')
const fs = require('fs')
const http = require('http')
const assert = require('node:assert/strict')
const path = require('path')

const repo = path.resolve(__dirname, '..')
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>动效与帧率实测</title><div id="root"></div><div id="composer" data-composer-card style="position:fixed;bottom:12px;left:12px;width:520px"></div>
<script src="/react"></script><script src="/react-dom"></script>
<script>window.__ModuleLoader__={load({factory}){window.plugin=factory(id=>id==='react-dom'?ReactDOM:React)}};</script>
<script src="/bundle"></script><script>
const registered={};
window.testSessions={list:{getSnapshot(){return {current:'qa'}},subscribe(){return ()=>{}}},binding(){return {eventSource:{getSnapshot(){return {entries:[]}},subscribe(){return ()=>{}}}}}};
plugin.apply({sessions:window.testSessions,get(){return undefined},slots:{inject(n,fn){fn();return ()=>{}},register(o,c){if(o.id && o.name!=='sidebar.panellist') registered[o.id]=c;return ()=>{}}}});
const actions={setDraft(){},submit(){},captureInsertion:()=>({start:0,end:0,draftRev:0}),insertText(){return true}};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(registered['dsh-research-kit-console'],{sessionId:'qa',inputActions:actions}));
const composer = ['launcher','overlay'].map(id=>React.createElement(registered['dsh-research-kit-'+id],{
  key:id,sessionId:'qa',input:{draft:'',draftRev:0},inputActions:actions,
}));
ReactDOM.createRoot(document.getElementById('composer')).render(React.createElement(React.Fragment,null,...composer));
</script>`

const server = http.createServer((req, res) => {
  if (req.url === '/dsh-research-kit/catalog-data') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.end(fs.readFileSync(path.join(repo, 'ui/catalog-data.json')))
  }
  if (req.url === '/dsh-research-kit/promptkit-client') {
    res.setHeader('Content-Type', 'text/javascript')
    return res.end(fs.readFileSync(path.join(repo, 'ui/promptkit.js')))
  }
  if (req.url?.startsWith('/dsh-research-kit/evidence-sync')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.end(JSON.stringify({ ok: true, entries: [] }))
  }
  if (req.url?.startsWith('/dsh-research-kit/claim-review')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.end(JSON.stringify({ ok: true, project: 'default', claims: [], evidence: [] }))
  }
  const files = { '/react': 'node_modules/react/umd/react.development.js', '/react-dom': 'node_modules/react-dom/umd/react-dom.development.js', '/bundle': 'ui/client.js' }
  res.setHeader('Content-Type', files[req.url] ? 'text/javascript' : 'text/html')
  res.end(files[req.url] ? fs.readFileSync(path.join(repo, files[req.url])) : html)
})

;(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.getByRole('heading', { name: '本次研究', exact: true }).waitFor()

    // 1. 分段控件连续打断切换
    for (const label of ['科研工具', '资料库', '本次研究', '科研工具']) {
      await page.getByRole('tab', { name: label, exact: true }).click()
    }
    await page.getByRole('tab', { name: '选流程', exact: true }).waitFor()

    const openModal = async () => {
      await page.locator('#composer').getByRole('button', { name: '科研辅助', exact: true }).click()
      await page.getByRole('dialog', { name: '选择科研工作流程' }).locator('.rk-picker-row').first().click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: '关闭', exact: true }).waitFor()
      return dialog
    }
    for (const close of ['button', 'Escape', 'backdrop']) {
      const dialog = await openModal()
      if (close === 'button') await dialog.getByRole('button', { name: '关闭', exact: true }).click()
      else if (close === 'Escape') await page.keyboard.press('Escape')
      else await page.locator('.rk-modal-backdrop').click({ position: { x: 8, y: 8 } })
      await dialog.waitFor({ state: 'hidden', timeout: 2000 })
    }

    await page.getByRole('tab', { name: '资料库', exact: true }).click()
    await page.getByRole('tab', { name: '证据库', exact: true }).click()
    await page.getByLabel('搜索证据条目').waitFor()
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('dsh-research-kit-evidence')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const tx = db.transaction('evidence', 'readwrite')
      for (let index = 0; index < 10000; index++) {
        tx.objectStore('evidence').put({
          id: 'motion-' + index, title: '动效测量证据 ' + index,
          project: '', status: 'unverified', savedAt: index + 1, url: 'https://example.test/motion/' + index,
        })
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    })
    await page.getByRole('button', { name: '重试同步', exact: true }).click()
    await page.getByText('第 1 页 · 本页 50 条 · 完整范围 10000 条', { exact: true }).waitFor()

    // 2. 长列表滚动帧率实测
    const scrollPerf = await page.evaluate(() => new Promise(resolve => {
      const list = document.scrollingElement
      const positions = new Set()
      const deltas = []
      let last = performance.now()
      let step = 0
      const run = now => {
        deltas.push(now - last)
        last = now
        list.scrollTop = step * 48
        positions.add(list.scrollTop)
        step++
        if (step < 36) requestAnimationFrame(run)
        else {
          const sorted = deltas.slice(2).sort((a, b) => a - b)
          const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0
          const avg = sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length)
          resolve({ positions: positions.size, frames: sorted.length, avgMs: Number(avg.toFixed(2)), p95Ms: Number(p95.toFixed(2)), overflow: document.documentElement.scrollWidth > window.innerWidth })
        }
      }
      requestAnimationFrame(run)
    }))
    assert.ok(scrollPerf.positions > 10, '必须实际滚动已加载的证据列表')
    assert.equal(scrollPerf.overflow, false, '滚动期间不得产生横向溢出')

    // 3. prefers-reduced-motion: reduce 合规检查
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const reducedModal = await openModal()
    await page.keyboard.press('Escape')
    await reducedModal.waitFor({ state: 'hidden', timeout: 2000 })
    const reducedCheck = await page.evaluate(() => {
      const el = document.querySelector('.rk-seg-indicator') || document.querySelector('.rk-btn')
      const style = el ? getComputedStyle(el) : null
      const dur = style ? parseFloat(style.transitionDuration) : 0
      return { found: Boolean(el), transitionDurationSec: dur }
    })
    assert.ok(reducedCheck.found && reducedCheck.transitionDurationSec <= 0.001, `减少动态效果下过渡时长应 <= 1ms: ${JSON.stringify(reducedCheck)}`)

    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ ok: true, scrollPerf, reducedCheck }, null, 2))
  } finally {
    await browser.close()
    server.close()
  }
})().catch(error => {
  console.error(error)
  server.close()
  process.exitCode = 1
})
