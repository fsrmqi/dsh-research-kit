import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const home = await mkdtemp(join(tmpdir(), 'research-kit-smoke-'))
const env = { ...process.env, DSH_HOME: join(home, 'dsh'), DSH_RESEARCH_KIT_HOME: join(home, 'research') }
const dsh = process.env.DSH_BIN || 'dsh'
let host
let browser
try {
  const version = execFileSync(dsh, ['--version'], { env, encoding: 'utf8', timeout: 10_000 }).trim()
  execFileSync(dsh, ['plugin', '--profile', 'web', 'add', root], { cwd: root, env, timeout: 120_000 })
  host = spawn(dsh, ['web', '--no-open', '--port', '0'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  host.stderr.resume()
  const url = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('等待 DSH Web 启动超时')), 30_000)
    const stop = () => clearTimeout(deadline)
    let output = ''
    host.once('error', error => { stop(); reject(error) })
    host.once('exit', code => { stop(); reject(new Error(`DSH Web 提前退出（${code}）`)) })
    host.stdout.setEncoding('utf8').on('data', chunk => {
      output = (output + chunk).slice(-16384)
      const match = output.match(/dsh web: (https?:\/\/[^\s]+)[\r\n]/)
      if (match) { stop(); resolve(match[1]) }
    })
  })
  const channel = process.env.PLAYWRIGHT_CHANNEL
  browser = await chromium.launch(channel ? { channel } : {})
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  const workflows = page.getByRole('button', { name: '工作流程', exact: true })
  await workflows.waitFor()
  const welcome = page.getByRole('button', { name: /^(继续|Continue)$/ })
  if (await welcome.isVisible()) await welcome.click()
  await workflows.click()
  await page.getByRole('dialog', { name: '选择科研工作流程' }).getByText('文献综述与研究空白', { exact: true }).waitFor()
  const statuses = await page.evaluate(async () => Object.fromEntries(
    await Promise.all(['catalog-data', 'host-capabilities', 'promptkit-client', 'archify-template', 'agent-activity']
      .map(async route => [route, (await fetch(`/dsh-research-kit/${route}`)).status])),
  ))
  for (const [route, status] of Object.entries(statuses)) assert.equal(status, 200, route)
  assert.deepEqual(errors, [])
  console.log(`DSH ${version} · 隔离 Web 装载、工作流入口及 ${Object.keys(statuses).length} 条插件路由通过。`)
} finally {
  await browser?.close()
  if (host && host.pid && host.exitCode === null && host.signalCode === null) {
    const stopped = once(host, 'exit')
    host.kill()
    const deadline = setTimeout(() => host.kill('SIGKILL'), 4000)
    await stopped.finally(() => clearTimeout(deadline))
  }
  await rm(home, { recursive: true, force: true })
}
