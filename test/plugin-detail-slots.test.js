import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 产物把构建期常量定义在模块作用域最前面；本文件直接 import 源码，没有该常量。
// 按产物契约把它挂到 globalThis，覆盖「徽章/诊断载荷读烘焙值」的正路径；
// 缺省（不设置）时组件必须退化为不渲染，见「缺数据」用例。
globalThis.RESEARCH_KIT_BUILD_STATS = { version: '0.3.0', workflows: 351, skills: 109, resources: 129, direct: 11 }

const bundle = readFileSync(new URL('../ui/client.js', import.meta.url), 'utf8')
const glue = readFileSync(new URL('../dsh/standalone-glue.js', import.meta.url), 'utf8')
// seam 清单与检查逻辑已从 CLI 里抽到 scripts/lib/：这里断言的是**事实源**，
// 而不是某个入口文件的文本形态（此前断言 check-dsh-app.mjs 的字符串，
// 一重构检查器就误报——那测的是实现细节，不是契约）。
const seamData = readFileSync(new URL('../scripts/lib/dsh-baselines.mjs', import.meta.url), 'utf8')
const claimApp = readFileSync(new URL('../src/research-claim-review.js', import.meta.url), 'utf8')
const pluginPkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const React = (await import('react')).default
const { renderToStaticMarkup } = await import('react-dom/server')
const {
  ResearchKitBadge, ResearchKitDiagnosticsAction, ResearchKitOpenWorkbenchAction,
  researchKitScaleLabel, researchKitDiagnosticsPayload, researchKitOpenWorkbench, RESEARCH_KIT_CONSOLE_VIEW,
  ResearchKitPresetConfig, RESEARCH_KIT_CONFIG_PRESETS, researchKitPresetOps,
} = await import('../src/plugin-status.js')

// 预设的字段名必须与宿主 Config 的字段集合完全相同：多一个（宿主忽略）、少一个（「原子覆盖」
// 变成部分覆盖，旧值残留）都算错。真值直接取自 dsh/config.js 的 schema，不在这里手抄；
// 同时抽出 schema 默认值——「辅助预设 = 保留默认」与「直连预设 = 收紧」都是可断言的语义。
const CONFIG_SOURCE = readFileSync(new URL('../dsh/config.js', import.meta.url), 'utf8')
const CONFIG_FIELDS = [...CONFIG_SOURCE.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*Schema\./gm)].map(match => match[1]).sort()
const parseSchemaScalar = raw => (raw === 'true' ? true
  : raw === 'false' ? false
    : /^['"]/.test(raw) ? raw.slice(1, -1)
      : Number(raw.replace(/_/g, '')))
const CONFIG_DEFAULTS = Object.fromEntries([...CONFIG_SOURCE.matchAll(
  /^\s{2}([A-Za-z0-9_]+):\s*Schema\.\w+\(\)\.default\(([^)]+)\)/gm,
)].map(match => [match[1], parseSchemaScalar(match[2])]))
const { loadCatalogEntries } = await import('../scripts/lib/catalog-entries.mjs')

const researchSubject = { kind: 'bundle', pkg: { name: 'dsh-research-kit', version: '0.3.0', installed: true, enabled: true, rows: [] } }
const foreignBundle = { kind: 'bundle', pkg: { name: 'dsh-promptkit', version: '1.0.0', installed: true, enabled: true, rows: [] } }

test('规模标签只接受完整烘焙数据，缺字段返回 null 而不是 0', () => {
  assert.equal(researchKitScaleLabel({ workflows: 351, skills: 109, resources: 129 }), '351 工作流 · 109 技能 · 129 数据源')
  assert.equal(researchKitScaleLabel(null), null)
  assert.equal(researchKitScaleLabel({ workflows: 351, skills: 109 }), null)
  assert.equal(researchKitScaleLabel({ workflows: '351', skills: 109, resources: 129 }), null)
})

test('Plugins 页徽章渲染烘焙的目录规模，并自带全局样式', () => {
  const markup = renderToStaticMarkup(React.createElement(ResearchKitBadge, { subject: researchSubject }))
  assert.match(markup, /351 工作流 · 109 技能 · 129 数据源/)
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
  assert.deepEqual(payload.scale, { workflows: 351, skills: 109, resources: 129, direct: 11 })
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

test('两个新槽位已接入 glue 与产物，并被 seam 清单锁定', () => {
  assert.match(glue, /slots\.inject\('plugins\.detail\.badge'/)
  assert.match(glue, /slots\.inject\('plugins\.detail\.actions'/)
  assert.ok(bundle.includes("'plugins.detail.badge'"))
  assert.ok(bundle.includes("'plugins.detail.actions'"))
  assert.match(seamData, /packages\/client\/ui-plugin-manager\/src\/client\/slot-contract\.ts/)
  assert.match(seamData, /'plugins\.detail\.badge'/)
  assert.match(seamData, /'plugins\.detail\.actions'/)
})

test('Desktop 与 Claim 契约检查覆盖路由、会话传递与自定义协议转发', () => {
  assert.match(seamData, /apps\/desktop\/src\/main\.ts/)
  assert.match(seamData, /apps\/desktop\/src\/web-document\.ts/)
  assert.match(seamData, /claimAgentReviewRoute/)
  assert.match(claimApp, /session_id=\$\{encodeURIComponent\(sessionId\)\}/)
  assert.match(seamData, /target\.pathname = source\.pathname/)
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

test('跨页跳转是软探测：不写进客户端 inject 列表，且已在 seam 清单里登记为可选', () => {
  // 客户端 inject 清单硬编码在构建脚本里；新增服务若写进去，旧宿主的客户端会因缺服务拒绝加载整插件。
  assert.ok(bundle.includes("inject: ['slots', 'sessions']"), '产物必须保持最小 inject 列表')
  assert.match(glue, /ctx\.get\?\.\('uiConversation'\)/)
  assert.ok(glue.includes('dsh-research-kit-open-workbench'))
  // 可选 seam 必须标 optional：宿主不提供时按钮不该渲染，也不该让兼容性检查失败。
  assert.match(seamData, /id: 'view-navigation'/)
  assert.match(seamData, /optional: true/)
  assert.match(seamData, /binding\(source: SessionBinding \| SessionId\)/)
  // 当前接线仍指向宿主不存在的 openView —— 这是已登记的缺口（KNOWN_GAPS 的绊线守着它），
  // 修好之后绊线测试会失败，提醒同步删除缺口记录与文档。
  assert.match(seamData, /id: 'cross-page-view-navigation'/)
  assert.match(seamData, /conversationViews\.openView\(/)
})

test('预设是原子写入的 ops，字段集合与 dsh/config.js 逐个对齐', () => {
  assert.deepEqual(researchKitPresetOps('direct'), [
    { op: 'set', path: ['memoryServer'], value: 'memory-center' },
    { op: 'set', path: ['memoryTimeoutMs'], value: 5000 },
    { op: 'set', path: ['databaseTimeoutMs'], value: 10000 },
    { op: 'set', path: ['databaseRequestsPerMinute'], value: 6 },
    { op: 'set', path: ['allowAgentFallback'], value: false },
  ])
  // 未知 id 必须返回 null：返回空 ops 会让「点了没反应」，而调用方无从察觉。
  assert.equal(researchKitPresetOps('nope'), null)
  assert.equal(researchKitPresetOps('direct', []), null)
  assert.ok(CONFIG_FIELDS.length >= 5, `没能从 dsh/config.js 抽出 Config 字段：${CONFIG_FIELDS.join(' / ')}`)
  const [direct, assisted] = RESEARCH_KIT_CONFIG_PRESETS
  for (const preset of RESEARCH_KIT_CONFIG_PRESETS) {
    assert.deepEqual(
      Object.keys(preset.values).sort(),
      CONFIG_FIELDS,
      `${preset.id} 预设必须重述**完整**的 Research Kit config（少写字段会留下旧值）`,
    )
    assert.ok(researchKitPresetOps(preset.id).length === CONFIG_FIELDS.length)
  }
  // 两句描述都是可核对的事实，不该只活在文案里：「保留默认」= 逐字段等于宿主 schema 的默认值。
  assert.deepEqual(assisted.values, CONFIG_DEFAULTS, '「Agent 辅助」的语义是保留宿主默认，必须与 dsh/config.js 的 default 完全一致')
  // 「收紧」= 超时与速率都低于默认，并关闭 Agent 回退（若哪天调松了，这里会拦住并提醒同步 README 的措辞）。
  assert.ok(
    direct.values.memoryTimeoutMs < CONFIG_DEFAULTS.memoryTimeoutMs
      && direct.values.databaseTimeoutMs < CONFIG_DEFAULTS.databaseTimeoutMs
      && direct.values.databaseRequestsPerMinute < CONFIG_DEFAULTS.databaseRequestsPerMinute
      && direct.values.allowAgentFallback === false,
    `「直连研究」的语义是收紧：超时/速率应低于默认（${JSON.stringify(CONFIG_DEFAULTS)}），且关闭 Agent 回退`,
  )
})

test('presets/*.patch.yml 与代码里的预设逐字段一致（同一组值的两条路径不许分叉）', () => {
  const files = { direct: 'research-direct.patch.yml', assisted: 'research-assisted.patch.yml' }
  for (const preset of RESEARCH_KIT_CONFIG_PRESETS) {
    const source = readFileSync(new URL(`../presets/${files[preset.id]}`, import.meta.url), 'utf8')
    // 按 row id 定位：宿主的一条 patch 会**替换**该行的整个 config（见 DSH docs/architecture.md），
    // 所以 overlay 里的字段集必须与代码里的预设完全相同，否则两条路径给出的运行配置不一样。
    assert.match(source, new RegExp(`-\\s*id:\\s*${pluginPkg.name}\\b`), `presets/${files[preset.id]} 必须按 row id 定位本插件`)
    assert.deepEqual(
      parseOverlayConfig(source),
      preset.values,
      `presets/${files[preset.id]} 与代码里的 ${preset.id} 预设不一致：改一处必须同时改另一处`,
    )
  }
})

test('预设配置区只在表单就绪时渲染；只读或写入被拒时按实情降级', () => {
  // summary 仅作为「行描述缺失」的兜底文案。
  assert.equal(
    renderToStaticMarkup(React.createElement(ResearchKitPresetConfig, { view: 'summary' })),
    '选择直连研究或 Agent 辅助配置。',
  )
  // 表单未就绪（loading / unavailable / 根本没传）：整块不渲染，避免点了写不进去还显示「已应用」。
  for (const form of [undefined, { state: { status: 'loading' } }, { state: { status: 'unavailable', writable: false } }]) {
    assert.equal(renderToStaticMarkup(React.createElement(ResearchKitPresetConfig, { view: 'page', form })), '')
  }
  const ready = { state: { status: 'ready', writable: true, revision: 7 }, mutate: async () => true }
  const markup = renderToStaticMarkup(React.createElement(ResearchKitPresetConfig, { view: 'page', form: ready }))
  assert.match(markup, /直连研究/)
  assert.match(markup, /Agent 辅助/)
  assert.match(markup, /预设会原子覆盖全部 Research Kit 运行字段/)
  assert.doesNotMatch(markup, /disabled/, '可写时按钮不应禁用')
  // 只读（memory 模式 / 宿主文档不接受写入）时必须禁用，而不是让用户点一个注定失败的按钮。
  const readonly = renderToStaticMarkup(React.createElement(ResearchKitPresetConfig, {
    view: 'page',
    form: { state: { status: 'ready', writable: false, revision: 7 }, mutate: async () => true },
  }))
  assert.match(readonly, /disabled/)
})

/** 从 overlay 的 config 段抽出标量（够用即可：这里只有字符串、数字与布尔）。 */
function parseOverlayConfig(source) {
  const block = /config:\s*\n([\s\S]*)$/.exec(source)?.[1]
  assert.ok(block, 'overlay 缺少 config 段：启动时不会覆盖任何字段')
  const values = {}
  for (const line of block.split('\n')) {
    const match = /^\s+([A-Za-z0-9_]+):\s*(.+?)\s*$/.exec(line)
    if (!match) continue
    const raw = match[2]
    values[match[1]] = raw === 'true' ? true
      : raw === 'false' ? false
        : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw)
          : raw.replace(/^['"]|['"]$/g, '')
  }
  return values
}
