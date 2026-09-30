import React from 'react'
import { h, C, GlobalStyle } from './theme.js'
import { Button } from './ui.js'
import { catalog, loadBrowserCatalog } from './catalog.js'

const SERVICES = [
  ['web', 'Web'],
  ['shell', 'Shell'],
  ['fs', 'FS'],
  ['llm', 'LLM'],
]

// 宿主能力探测路由（Node half 定义于 dsh/host-capabilities.js，浏览器端只消费）。
const HOST_CAPABILITIES_URL = '/dsh-research-kit/host-capabilities'

// 目录规模在构建期由 scripts/build-client.mjs 烘焙成常量（349 工作流 / 109 技能 / 129 数据源）。
// 独立模块上下文（node --test 直接 import 本文件）没有该常量，用 typeof 探测而非直接引用，
// 否则会抛 ReferenceError。
const BUILD_STATS = typeof RESEARCH_KIT_BUILD_STATS === 'undefined' ? null : RESEARCH_KIT_BUILD_STATS

function isResearchBundle(subject) {
  return subject?.kind === 'bundle' && subject.pkg?.name === 'dsh-research-kit'
}

function directQueryCount() {
  return catalog.filter(item => item.type === 'database' && item.availability === 'available-in-plugin').length
}

// 探测只读一次事实：状态区与「复制诊断」共用同一条路径，避免两处各写一份 URL 与错误处理。
function fetchHostCapabilities() {
  return fetch(HOST_CAPABILITIES_URL, { headers: { accept: 'application/json' } })
    .then(async response => {
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.message || `HTTP ${response.status}`)
      return body.capabilities
    })
}

/** 构建期目录规模的紧凑标签；缺少烘焙数据或字段不可用时返回 null（徽章不渲染）。 */
export function researchKitScaleLabel(stats = BUILD_STATS) {
  if (!stats) return null
  const numbers = ['workflows', 'skills', 'resources'].map(key => stats[key])
  if (!numbers.every(value => Number.isFinite(value))) return null
  return `${stats.workflows} 工作流 · ${stats.skills} 技能 · ${stats.resources} 数据源`
}

/**
 * 「复制诊断」的剪贴板载荷（纯函数，单测覆盖）。只含版本、目录规模与部署事实；
 * 不含会话内容、提示词或任何凭据，且只在用户点击时写入本机剪贴板，不经网络上传。
 */
export function researchKitDiagnosticsPayload({ stats = BUILD_STATS, capabilities = null, generatedAt = new Date().toISOString(), userAgent = '' } = {}) {
  return {
    plugin: 'dsh-research-kit',
    version: stats?.version || 'unknown',
    generatedAt,
    scale: stats ? { workflows: stats.workflows, skills: stats.skills, resources: stats.resources, direct: stats.direct } : null,
    capabilities: capabilities || null,
    userAgent: userAgent || undefined,
  }
}

/** Plugins-page section for deployment facts; it never upgrades catalog claims. */
export function ResearchPluginStatusSection({ subject }) {
  const [state, setState] = React.useState({ status: 'loading', data: null, error: '' })
  const [, setCatalogVersion] = React.useState(0)
  React.useEffect(() => {
    if (!isResearchBundle(subject)) return
    let alive = true
    setState({ status: 'loading', data: null, error: '' })
    loadBrowserCatalog().then(() => { if (alive) setCatalogVersion(version => version + 1) }).catch(() => {})
    fetchHostCapabilities()
      .then(capabilities => { if (alive) setState({ status: 'ready', data: capabilities, error: '' }) })
      .catch(error => { if (alive) setState({ status: 'error', data: null, error: error?.message || String(error) }) })
    return () => { alive = false }
  }, [subject?.kind, subject?.pkg?.name])
  if (!isResearchBundle(subject)) return null
  const capabilities = state.data
  const mcpServers = capabilities?.mcpServers || []
  return h('section', {
    'aria-label': 'Research Kit 运行状态',
    style: {
      marginTop: 18, padding: '14px 16px', border: `1px solid ${C.line}`, borderRadius: 12,
      background: C.surface, display: 'grid', gap: 10,
    },
  }, [
    h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } }, [
      h('strong', { key: 'title', style: { fontSize: 14 } }, '运行状态'),
      h('span', { key: 'scope', style: { color: C.muted, fontSize: 12 } }, '部署事实 · 不改变目录标注'),
    ]),
    state.status === 'loading' ? h('p', { key: 'loading', style: { margin: 0, color: C.muted, fontSize: 13 } }, '正在探测宿主能力……') : null,
    state.status === 'error' ? h('p', { key: 'error', style: { margin: 0, color: C.amber, fontSize: 13 } }, `探测失败：${state.error}`) : null,
    capabilities ? h('div', { key: 'services', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, SERVICES.map(([key, label]) => {
      const available = capabilities.services?.[key] === true
      return h('span', {
        key,
        style: {
          padding: '3px 8px', borderRadius: 999, fontSize: 12, fontWeight: 650,
          background: available ? C.tealTint : C.surfaceAlt, color: available ? C.teal : C.muted,
        },
      }, `${label} ${available ? '可用' : '未知'}`)
    })) : null,
    capabilities ? h('div', { key: 'rows', style: { display: 'grid', gap: 5, fontSize: 13, lineHeight: 1.5, color: C.muted } }, [
      h('div', { key: 'direct' }, `插件直查适配器：${directQueryCount()} 个`),
      h('div', { key: 'mcp' }, `已连接 MCP 服务器：${mcpServers.length ? mcpServers.map(item => item.server).join('、') : '无'}`),
      h('div', { key: 'tools' }, `工具注册表：${capabilities.toolProbeAvailable ? `${capabilities.toolCount} 个工具` : '不可读'}`),
    ]) : null,
  ])
}

/**
 * Plugins 页标题徽章：只陈述构建期烘焙的目录规模，不做任何运行时探测。
 * 徽章紧邻标题，异步补数会先闪一个 0 再跳成真实数字，观感与准确性都更差。
 */
export function ResearchKitBadge({ subject }) {
  if (!isResearchBundle(subject)) return null
  const label = researchKitScaleLabel()
  if (!label) return null
  return h(React.Fragment, null, [
    // 徽章可能先于会话 UI 挂载，自带全局样式，避免 --rk-* 变量缺失时颜色失效。
    h(GlobalStyle, { key: 'style' }),
    h('span', {
      key: 'label',
      className: 'rk-badge',
      title: `${BUILD_STATS.workflows} 条人工审核工作流、${BUILD_STATS.skills} 个技能条目、${BUILD_STATS.resources} 个科学数据源（其中 ${BUILD_STATS.direct ?? 0} 个支持插件直查）。数字随构建烘焙，不代表当前会话的实际可用性。`,
      style: {
        padding: '3px 8px', borderRadius: 999, fontSize: 12, fontWeight: 650,
        background: C.tealTint, color: C.teal, whiteSpace: 'nowrap',
      },
    }, label),
  ])
}

/**
 * Plugins 页头部动作：按需复制诊断信息。只写入本机剪贴板，不触网。
 */
export function ResearchKitDiagnosticsAction({ subject }) {
  const [state, setState] = React.useState('idle')
  const timer = React.useRef(null)
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  if (!isResearchBundle(subject)) return null
  const settle = next => {
    if (timer.current) clearTimeout(timer.current)
    setState(next)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }
  const copy = () => {
    if (state === 'busy') return
    setState('busy')
    fetchHostCapabilities()
      .then(capabilities => navigator.clipboard.writeText(JSON.stringify(
        researchKitDiagnosticsPayload({ capabilities, userAgent: navigator.userAgent || '' }), null, 2)))
      .then(() => settle('done'))
      .catch(() => settle('failed'))
  }
  const label = state === 'busy' ? '复制中…' : state === 'done' ? '已复制' : state === 'failed' ? '复制失败' : '复制诊断'
  return h(React.Fragment, null, [
    h(GlobalStyle, { key: 'style' }),
    h(Button, {
      key: 'copy', size: 'sm', variant: 'ghost', icon: state === 'done' ? 'check' : 'copy',
      disabled: state === 'busy', onClick: copy,
      title: '复制插件版本、目录规模与宿主能力探测结果，便于反馈问题；只写入本机剪贴板，不会上传。',
    }, label),
  ])
}

/**
 * 本插件唯一对话视图的 id。必须与 dsh/slot-registry.js 的 RESEARCH_SLOTS 条目一致，
 * 否则「打开工作台」会请求一个宿主不认识、因而不予选中的视图（单测断言两者相等）。
 */
export const RESEARCH_KIT_CONSOLE_VIEW = 'dsh-research-kit-console'

/**
 * 请求宿主把主区切到科研工作台视图（宿主 side：`uiConversation.openView`）。
 * sessionId 传 undefined 表示「主区当前持有的那个会话」，由宿主解析 ——
 * 插件详情页与对话挂载树无关，拿到会话 id 的合法途径只有宿主自己。
 * @param {unknown} openView 宿主注入的视图导航；缺失时为 undefined。
 * @returns {boolean} 宿主是否接受了请求（false = 无可展示会话或视图未注册）。
 */
export function researchKitOpenWorkbench(openView) {
  if (typeof openView !== 'function') return false
  return openView(undefined, RESEARCH_KIT_CONSOLE_VIEW) !== false
}

/**
 * 两组预设的唯一事实源：字段名必须与 dsh/config.js 的 volatile Config 字段一一对应
 * （volatile 正是宿主允许「免重挂载」就地写入的那类字段）。
 *
 * 同一组值还有第二份载体 presets/*.patch.yml（启动 overlay）。两条路径必须逐字段一致，
 * 由 test/plugin-detail-slots.test.js 直接比对，防止改了一处忘了另一处。
 */
export const RESEARCH_KIT_CONFIG_PRESETS = [
  {
    id: 'direct', label: '直连研究',
    description: '仅使用直查适配器；查询不可用时不委托给 Agent。',
    values: { memoryServer: 'memory-center', memoryTimeoutMs: 5000, databaseTimeoutMs: 10000, databaseRequestsPerMinute: 6, allowAgentFallback: false },
  },
  {
    id: 'assisted', label: 'Agent 辅助',
    description: '保留默认超时、速率和 Agent 回退。',
    values: { memoryServer: 'memory-center', memoryTimeoutMs: 15000, databaseTimeoutMs: 15000, databaseRequestsPerMinute: 12, allowAgentFallback: true },
  },
]

/** 预设 → 宿主的原子写入操作数组；未知 id 返回 null（不给「静默写默认值」留口子）。 */
export function researchKitPresetOps(presetId, presets = RESEARCH_KIT_CONFIG_PRESETS) {
  const preset = presets.find(candidate => candidate.id === presetId)
  if (!preset) return null
  return Object.entries(preset.values).map(([field, value]) => ({ op: 'set', path: [field], value }))
}

/** Plugins 配置页的 Research Kit 预设；写入走宿主的 revision-fenced ConfigForm。 */
export function ResearchKitPresetConfig({ view, form }) {
  const [state, setState] = React.useState('idle')
  if (view === 'summary') return '选择直连研究或 Agent 辅助配置。'
  if (!form || form.state.status !== 'ready') return null
  const apply = async preset => {
    if (!form.state.writable || state === 'busy') return
    setState('busy')
    try {
      const accepted = await form.mutate(researchKitPresetOps(preset.id), form.state.revision)
      setState(accepted ? preset.id : 'failed')
    } catch {
      setState('failed')
    }
  }
  return h('section', { style: { display: 'grid', gap: 10, marginTop: 12 } }, [
    h('p', { key: 'hint', style: { margin: 0, color: C.muted, fontSize: 13, lineHeight: 1.5 } }, '预设会原子覆盖全部 Research Kit 运行字段；手动字段仍可在下方调整。'),
    ...RESEARCH_KIT_CONFIG_PRESETS.map(preset => h('div', { key: preset.id, style: { display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 10 } }, [
      h('div', { key: 'text' }, [h('strong', { key: 'label', style: { fontSize: 13 } }, preset.label), h('div', { key: 'description', style: { color: C.muted, fontSize: 12, marginTop: 3 } }, preset.description)]),
      h(Button, { key: 'apply', size: 'sm', variant: 'ghost', disabled: !form.state.writable || state === 'busy', onClick: () => { void apply(preset) } }, state === preset.id ? '已应用' : '应用'),
    ])),
    state === 'failed' ? h('p', { key: 'failed', style: { margin: 0, color: C.amber, fontSize: 12 } }, '预设未保存；请检查配置页的错误提示后重试。') : null,
  ])
}

/**
 * Plugins 页头部动作：跳到对话区里的科研工作台。
 * 宿主需同时提供 `uiConversation.openView`（跨页选中视图）与主区可见的会话；
 * 通道缺失时整个按钮不渲染 —— 留一个点了毫无反应的死按钮比没有更糟。
 * 宿主补通道的方式见 docs/PRODUCT.md 的集成边界表。
 */
export function ResearchKitOpenWorkbenchAction({ subject, openView }) {
  const [denied, setDenied] = React.useState(false)
  const timer = React.useRef(null)
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  if (!isResearchBundle(subject)) return null
  if (typeof openView !== 'function') return null
  const open = () => {
    if (researchKitOpenWorkbench(openView)) return
    if (timer.current) clearTimeout(timer.current)
    setDenied(true)
    timer.current = setTimeout(() => setDenied(false), 2000)
  }
  return h(React.Fragment, null, [
    h(GlobalStyle, { key: 'style' }),
    h(Button, {
      key: 'open', size: 'sm', variant: 'ghost', icon: 'layers', onClick: open,
      title: '把主区切回当前会话并打开「科研工作台」视图；宿主未提供跨页视图导航时不显示此按钮。',
    }, denied ? '暂不可用' : '打开工作台'),
  ])
}
