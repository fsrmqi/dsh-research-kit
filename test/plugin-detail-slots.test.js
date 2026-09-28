import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 产物把构建期常量定义在模块作用域最前面；本文件直接 import 源码，没有该常量。
// 按产物契约把它挂到 globalThis，覆盖「徽章/诊断载荷读烘焙值」的正路径；
// 缺省（不设置）时组件必须退化为不渲染，见「缺数据」用例。
globalThis.RESEARCH_KIT_BUILD_STATS = { version: '0.3.0', workflows: 349, skills: 109, resources: 129, direct: 11 }

const bundle = readFileSync(new URL('../ui/client.js', import.meta.url), 'utf8')
const glue = readFileSync(new URL('../dsh/standalone-glue.js', import.meta.url), 'utf8')
const contractCheck = readFileSync(new URL('../scripts/check-dsh-app.mjs', import.meta.url), 'utf8')
const pluginPkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const React = (await import('react')).default
const { renderToStaticMarkup } = await import('react-dom/server')
const {
  ResearchKitBadge, ResearchKitDiagnosticsAction, ResearchKitOpenWorkbenchAction,
  researchKitScaleLabel, researchKitDiagnosticsPayload, researchKitOpenWorkbench, RESEARCH_KIT_CONSOLE_VIEW,
} = await import('../src/plugin-status.js')
const { loadCatalogEntries } = await import('../scripts/lib/catalog-entries.mjs')

const researchSubject = { kind: 'bundle', pkg: { name: 'dsh-research-kit', version: '0.3.0', installed: true, enabled: true, rows: [] } }
const foreignBundle = { kind: 'bundle', pkg: { name: 'dsh-promptkit', version: '1.0.0', installed: true, enabled: true, rows: [] } }

test('规模标签只接受完整烘焙数据，缺字段返回 null 而不是 0', () => {
  assert.equal(researchKitScaleLabel({ workflows: 349, skills: 109, resources: 129 }), '349 工作流 · 109 技能 · 129 数据源')
  assert.equal(researchKitScaleLabel(null), null)
  assert.equal(researchKitScaleLabel({ workflows: 349, skills: 109 }), null)
  assert.equal(researchKitScaleLabel({ workflows: '349', skills: 109, resources: 129 }), null)
})

test('Plugins 页徽章渲染烘焙的目录规模，并自带全局样式', () => {
  const markup = renderToStaticMarkup(React.createElement(ResearchKitBadge, { subject: researchSubject }))
  assert.match(markup, /349 工作流 · 109 技能 · 129 数据源/)
  // 徽章可能先于会话 UI 挂载；缺少 --rk-* 变量时颜色会失效，故自带 GlobalStyle。
  assert.ok(markup.includes('--rk-teal'), '徽章产物应包含 rk 全局样式')
  assert.ok(markup.includes('数字随构建烘焙'), 'title 必须说明数字来源，避免被读成实时可用性')
})

test('徽章与诊断动作对非科研套件的 subject 一律渲染 null', () => {
  const subjects = [foreignBundle, { kind: 'row', pkg: researchSubject.pkg, row: { rowId: 'x' } }, { kind: 'item', id: 'plugins' }, undefined]
  for (const subject of subjects) {
    assert.equal(renderToStaticMarkup(React.createElement(ResearchKitBadge, { subject })), '')
    assert.equal(renderToStaticMarkup(React.createElement(ResearchKitDiagnosticsAction, { subject })), '')
  }
})

test('诊断动作在科研套件详情页渲染复制按钮', () => {
  const markup = renderToStaticMarkup(React.createElement(ResearchKitDiagnosticsAction, { subject: researchSubject }))
  assert.match(markup, /复制诊断/)
  assert.match(markup, /本机剪贴板/)
})

test('诊断载荷只含版本、规模与部署事实，不含凭据类字段', () => {
  const payload = researchKitDiagnosticsPayload({
    capabilities: { services: { web: true }, mcpServers: [{ server: 'memory-center', tools: 3 }], toolCount: 32, toolProbeAvailable: true },
    generatedAt: '2026-09-28T00:00:00.000Z',
    userAgent: 'test-agent',
  })
  assert.deepEqual(Object.keys(payload).sort(), ['capabilities', 'generatedAt', 'plugin', 'scale', 'userAgent', 'version'])
  assert.equal(payload.plugin, 'dsh-research-kit')
  assert.equal(payload.version, pluginPkg.version)
  assert.deepEqual(payload.scale, { workflows: 349, skills: 109, resources: 129, direct: 11 })
  assert.equal(payload.capabilities.mcpServers[0].server, 'memory-center')
  assert.equal(researchKitDiagnosticsPayload({ userAgent: '' }).userAgent, undefined)
  const serialized = JSON.stringify(payload).toLowerCase()
  for (const forbidden of ['apikey', 'api_key', 'token', 'password', 'secret', 'cookie']) {
    assert.ok(!serialized.includes(forbidden), `诊断载荷不得包含 ${forbidden}`)
  }
})

test('产物把目录规模烘焙进常量，且与目录真源、包版本一致', async () => {
  const baked = JSON.parse(/const RESEARCH_KIT_BUILD_STATS = (\{[^}]*\})/.exec(bundle)?.[1] || 'null')
  assert.ok(baked, '产物必须包含 RESEARCH_KIT_BUILD_STATS 常量')
  const { workflows, skills, resources } = await loadCatalogEntries()
  assert.equal(baked.workflows, workflows.length)
  assert.equal(baked.skills, skills.length)
  assert.equal(baked.resources, resources.length)
  assert.equal(baked.direct, resources.filter(entry => entry.availability === 'available-in-plugin').length)
  assert.equal(baked.version, pluginPkg.version)
})

test('两个新槽位已接入 glue 与产物，并被 check:dsh-app 契约检查锁定', () => {
  assert.match(glue, /slots\.inject\('plugins\.detail\.badge'/)
  assert.match(glue, /slots\.inject\('plugins\.detail\.actions'/)
  assert.ok(bundle.includes("'plugins.detail.badge'"))
  assert.ok(bundle.includes("'plugins.detail.actions'"))
  assert.match(contractCheck, /ui-plugin-manager\/src\/client\/slot-contract\.ts/)
  assert.match(contractCheck, /'plugins\.detail\.badge'/)
  assert.match(contractCheck, /'plugins\.detail\.actions'/)
})

test('Desktop 契约检查覆盖 Claim Agent 路由、会话传递与自定义协议转发', () => {
  assert.match(contractCheck, /apps\/desktop\/src\/main\.ts/)
  assert.match(contractCheck, /apps\/desktop\/src\/web-document\.ts/)
  assert.match(contractCheck, /claimAgentReviewRoute/)
  assert.match(contractCheck, /session_id=\$\{encodeURIComponent\(sessionId\)\}/)
  assert.match(contractCheck, /target\.pathname = source\.pathname/)
  assert.match(bundle, /dsh-research-kit\/claim-agent-review/)
  assert.match(bundle, /发布检查并导出/)
})

test('跳转动作向宿主请求当前会话的科研工作台视图', () => {
  const calls = []
  const accepted = (sessionId, view, focus) => { calls.push([sessionId, view, focus]); return true }
  assert.equal(researchKitOpenWorkbench(accepted), true)
  // sessionId 留空 = 由宿主解析「主区当前持有的会话」；详情页拿不到会话 id，也不该去猜。
  assert.deepEqual(calls, [[undefined, RESEARCH_KIT_CONSOLE_VIEW, undefined]])
  // 宿主拒绝（无会话 / 视图未注册）时如实返回 false，UI 据此给 2 秒短提示。
  assert.equal(researchKitOpenWorkbench(() => false), false)
  assert.equal(researchKitOpenWorkbench(undefined), false)
  assert.equal(researchKitOpenWorkbench({ openView: () => true }), false)
})

test('跳转目标视图 id 与 slot-registry 注册完全一致', () => {
  const registry = readFileSync(new URL('../dsh/slot-registry.js', import.meta.url), 'utf8')
  assert.ok(
    registry.includes(`slot: 'conversation.view', id: '${RESEARCH_KIT_CONSOLE_VIEW}'`),
    'RESEARCH_KIT_CONSOLE_VIEW 必须与 RESEARCH_SLOTS 的 conversation.view 条目一致，否则宿主不予选中',
  )
  assert.ok(bundle.includes(`const RESEARCH_KIT_CONSOLE_VIEW = '${RESEARCH_KIT_CONSOLE_VIEW}'`))
})

test('没有宿主视图导航时不渲染跳转按钮，有通道才渲染', () => {
  // 通道缺失时整块不渲染：留个点了没反应的死按钮比没有更糟。
  assert.equal(renderToStaticMarkup(React.createElement(ResearchKitOpenWorkbenchAction, { subject: researchSubject })), '')
  assert.equal(renderToStaticMarkup(React.createElement(ResearchKitOpenWorkbenchAction, { subject: researchSubject, openView: 'nope' })), '')
  assert.equal(renderToStaticMarkup(React.createElement(ResearchKitOpenWorkbenchAction, { subject: foreignBundle, openView: () => true })), '')
  const markup = renderToStaticMarkup(React.createElement(ResearchKitOpenWorkbenchAction, { subject: researchSubject, openView: () => true }))
  assert.match(markup, /打开工作台/)
  assert.match(markup, /跨页视图导航/)
})

test('跨页跳转是软探测：不写进客户端 inject 列表，检查脚本按可选能力报告', () => {
  // 客户端 inject 清单硬编码在构建脚本里；新增服务若写进去，旧宿主的客户端会因缺服务拒绝加载整插件。
  assert.ok(bundle.includes("inject: ['slots', 'sessions']"), '产物必须保持最小 inject 列表')
  assert.match(glue, /ctx\.get\?\.\('uiConversation'\)/)
  assert.ok(glue.includes('dsh-research-kit-open-workbench'))
  assert.match(contractCheck, /跨页视图导航（可选）/)
  assert.match(contractCheck, /installViewNavigator/)
})
