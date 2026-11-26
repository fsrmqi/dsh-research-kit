import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const home = await mkdtemp(join(tmpdir(), 'research-kit-smoke-'))
const env = { ...process.env, DSH_HOME: join(home, 'dsh'), DSH_RESEARCH_KIT_HOME: join(home, 'research') }
const dsh = process.env.DSH_BIN || 'dsh'
const pluginSource = process.argv[2] ? resolve(process.argv[2]) : root
const workspace = pluginSource === root ? root : home
let host
let browser
try {
  const version = execFileSync(dsh, ['--version'], { env, encoding: 'utf8', timeout: 10_000 }).trim()
  execFileSync(dsh, ['plugin', '--profile', 'web', 'add', pluginSource], { cwd: workspace, env, timeout: 120_000 })
  // 本用例只操作草稿，隔离 profile 沿用 DSH 自身测试的配置跳过凭据引导。
  const overlay = join(home, 'smoke.patch.yml')
  await writeFile(overlay, '- id: ui-settings-models\n  config:\n    credentialOnboarding: false\n')
  host = spawn(dsh, ['--profile', 'web', '--patch', overlay, '--no-open', '--port', '0'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
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
  if (process.env.RK_PICKER_DESKTOP_SCREENSHOT) await page.emulateMedia({ colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  const workflows = page.getByRole('button', { name: '科研辅助', exact: true })
  await workflows.waitFor()
  const welcome = page.getByRole('button', { name: /^(继续|Continue)$/ })
  if (await welcome.isVisible()) await welcome.click()
  await workflows.click({ timeout: 4000 }).catch(async error => {
    if (!(await welcome.isVisible())) throw error
    await welcome.click()
    await workflows.click()
  })
  const selector = page.getByRole('dialog', { name: '选择科研工作流程' })
  await selector.getByText('文献综述与研究空白', { exact: true }).waitFor()
  const toggle = selector.getByRole('switch', { name: '自动科研辅助' })
  assert.equal(await toggle.isChecked(), false)
  assert.ok(await selector.evaluate(node => node.scrollWidth <= node.clientWidth + 1), '科研选择器不应出现横向滚动')
  if (process.env.RK_PICKER_DESKTOP_SCREENSHOT) await selector.screenshot({ path: process.env.RK_PICKER_DESKTOP_SCREENSHOT })
  await toggle.check()
  await page.keyboard.press('Escape')
  const editor = page.locator('[data-composer-card] [role="textbox"][contenteditable="true"]')
  await editor.click()
  const original = '请做一个关于水稻耐盐性的文献综述。'
  await page.keyboard.insertText(original)
  const suggestion = page.getByRole('region', { name: '科研建议' })
  await suggestion.getByRole('button', { name: '预览改动' }).click()
  await page.getByRole('dialog', { name: '预览科研建议' }).getByRole('button', { name: '采用并插入' }).click()
  const applied = await editor.innerText()
  assert.ok(applied.startsWith(original))
  assert.match(applied, /科研执行步骤/)
  await editor.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  assert.equal((await editor.innerText()).trim(), original)
  const statuses = await page.evaluate(async () => Object.fromEntries(
    await Promise.all(['catalog-data', 'host-capabilities', 'promptkit-client', 'archify-template', 'agent-activity']
      .map(async route => [route, (await fetch(`/dsh-research-kit/${route}`)).status])),
  ))
  for (const [route, status] of Object.entries(statuses)) assert.equal(status, 200, route)
  await workflows.click()
  await selector.getByRole('textbox', { name: '搜索', exact: true }).fill('研究结果解释图生成')
  await selector.getByRole('button', { name: /^研究结果解释图生成/ }).click()
  const diagram = page.getByRole('dialog', { name: '研究结果解释图生成' })
  await diagram.getByLabel('结果文件路径', { exact: true }).fill('sample.csv')
  await diagram.getByLabel('图题与受众', { exact: true }).fill('测试数据说明')
  await diagram.getByLabel('路线规划', { exact: true }).fill('来源与结果')
  await diagram.getByRole('button', { name: '使用工作流程', exact: true }).click()
  await diagram.waitFor({ state: 'hidden' })
  const diagramDraft = await editor.innerText()
  assert.match(diagramDraft, /sample\.csv/)
  assert.match(diagramDraft, /scripts\/validate-diagrams\.mjs/)
  assert.match(diagramDraft, /scripts\/render-diagrams\.mjs --html/)
  assert.deepEqual(errors, [])
  console.log(`DSH ${version} · 隔离 Web 装载、真实草稿预览与撤销、解释图草稿、${Object.keys(statuses).length} 条插件路由通过。`)
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
