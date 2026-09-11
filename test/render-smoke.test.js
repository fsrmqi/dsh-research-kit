// R2：宿主动作（inputActions）缺失时的降级——渲染级断言（ROADMAP §1）。
//
// 三层分工，别混：
//   1. 纯逻辑测试覆盖决策层（`planCitationWrite` 等）；
//   2. **本文件**覆盖初始渲染态——降级时按钮是否真的带 disabled、提示文案是否存在；
//   3. 真实 profile 覆盖交互（点击后不注入），见 docs/MANUAL-QA.md 的 W2/W3。
//
// 边界（不掩饰）：SSR 不执行事件，所以「点击后是否真的不写入」在这里**测不到**。
// 那部分由文件末尾的源码接线断言钉住调用关系，而不是假装测过。
//
// 为什么必须用真实 react 而不是桩：桩会把 useState/useMemo 降级成「直接调用 init」，
// 不执行真实 hooks 调度，跨模块的状态形状错误会被当成正常值放过去。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { installDomStub } from './helpers/dom-stub.js'
import { installFakeIndexedDB } from './helpers/fake-indexeddb.js'

installDomStub()
installFakeIndexedDB()

const { ResearchWorkbench } = await import('../src/research-workbench.js')
const { ResearchVault } = await import('../src/research-vault.js')
const { EvidenceVaultPane } = await import('../src/research-evidence-vault.js')
const { DatabaseQueryPanel } = await import('../src/database-query-panel.js')
const { ResearchComposerOverlay } = await import('../src/composer-overlay.js')

const assetProviderStub = { list: async () => [], onChange: () => {} }
const hostActionsStub = { setDraft: () => {}, submit: () => {} }
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props))

// 取出包含某文案的那个按钮标签，用于断言它是否带 disabled。
function buttonMarkup(html, label) {
  const index = html.indexOf(label)
  if (index < 0) return null
  const start = html.lastIndexOf('<button', index)
  const end = html.indexOf('>', index)
  return start >= 0 && end > start ? html.slice(start, end + 1) : null
}

test('工作台：宿主未提供 inputActions 时给出降级提示，写入与发送按钮均禁用', () => {
  const html = render(ResearchWorkbench, { sessionId: 'r2', embedded: true })
  assert.match(html, /当前 DSH 会话未提供输入框操作/, '降级提示缺失')
  assert.match(buttonMarkup(html, '写入输入框') || '', /disabled/, '写入按钮应为禁用态')
  assert.match(buttonMarkup(html, '发送到当前会话') || '', /disabled/, '发送按钮应为禁用态')
})

test('工作台对照组：宿主提供 inputActions 后两个按钮恢复可用', () => {
  const html = render(ResearchWorkbench, { sessionId: 'r2', inputActions: hostActionsStub, embedded: true })
  assert.doesNotMatch(html, /当前 DSH 会话未提供输入框操作/, '提供宿主动作后不应再出现降级提示')
  assert.doesNotMatch(buttonMarkup(html, '写入输入框') || '', /disabled/, '写入按钮应恢复可用')
  assert.doesNotMatch(buttonMarkup(html, '发送到当前会话') || '', /disabled/, '发送按钮应恢复可用')
})

test('证据库：宿主不支持写入时「写入 Prompt」按钮为禁用态', () => {
  const html = render(EvidenceVaultPane, {})
  assert.match(buttonMarkup(html, '写入 Prompt') || '', /disabled/, '宿主无 setDraft 时写入按钮应禁用')
})

test('灵感库与数据库面板：宿主未提供 inputActions 时仍能完整渲染，不抛错', () => {
  const vaultHtml = render(ResearchVault, { assetProvider: assetProviderStub, embedded: true })
  assert.ok(vaultHtml.length > 0, '灵感库应渲染出内容')
  const panelHtml = render(DatabaseQueryPanel, { database: { id: 'pubmed', name: 'PubMed' }, sessionId: 'r2' })
  assert.ok(panelHtml.length > 0, '数据库面板应渲染出内容')
})

test('输入框浮层：关闭态渲染为空且不抛错（打开态由事件驱动，SSR 初始渲染不可见）', () => {
  const html = render(ResearchComposerOverlay, { sessionId: 'r2', catalogStorage: null })
  assert.equal(html, '', '浮层未打开时应渲染为空，不应抛错')
})

// ── 渲染期不可见的部分：用源码接线断言钉住 ──────────────────────────────────────
// 灵感库的降级走异步 setError，数据库面板的降级是 onClick 里的一次提前 return——
// 两者在初始渲染态里都没有痕迹，只能靠下面这些断言确认守卫没有被删掉。
test('源码接线：四处宿主动作守卫必须存在', async () => {
  const read = relative => readFile(new URL(relative, import.meta.url), 'utf8')
  const [workbench, vault, panel, vaultPane] = await Promise.all([
    read('../src/research-workbench.js'),
    read('../src/research-vault.js'),
    read('../src/database-query-panel.js'),
    read('../src/research-evidence-vault.js')
  ])
  assert.match(workbench, /const hasDraftAction = typeof inputActions\?\.setDraft === 'function'/, '工作台缺少 setDraft 守卫')
  assert.match(workbench, /disabled: !hasDraftAction/, '工作台写入按钮未接守卫')
  assert.match(workbench, /disabled: !hasSubmitAction/, '工作台发送按钮未接守卫')
  assert.match(vault, /typeof inputActions\?\.setDraft !== 'function'/, '灵感库缺少 setDraft 守卫')
  assert.match(panel, /const canWrite = typeof inputActions\?\.setDraft === 'function'/, '数据库面板缺少 setDraft 守卫')
  assert.match(panel, /if \(!prompt \|\| !canWrite\) return/, '数据库面板缺少写入前的提前返回')
  assert.match(vaultPane, /const canWrite = typeof inputActions\?\.setDraft === 'function'/, '证据库缺少 setDraft 守卫')
  assert.match(vaultPane, /disabled: !selectedEntries\.length \|\| !canWrite/, '证据库写入按钮未接守卫')
  const overlay = await read('../src/composer-overlay.js')
  assert.match(overlay, /const hasDraftAction = typeof inputActions\?\.setDraft === 'function'/, '输入框浮层缺少 setDraft 守卫')
  assert.match(overlay, /if \(!hasDraftAction\) return setNotice\(/, '输入框浮层缺少写入前的降级提示')
})
