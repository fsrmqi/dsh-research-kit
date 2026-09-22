import React from 'react'
import { h, C } from './theme.js'
import { catalog, loadBrowserCatalog } from './catalog.js'

const SERVICES = [
  ['web', 'Web'],
  ['shell', 'Shell'],
  ['fs', 'FS'],
  ['llm', 'LLM'],
]

function isResearchBundle(subject) {
  return subject?.kind === 'bundle' && subject.pkg?.name === 'dsh-research-kit'
}

function directQueryCount() {
  return catalog.filter(item => item.type === 'database' && item.availability === 'available-in-plugin').length
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
    fetch('/dsh-research-kit/host-capabilities', { headers: { accept: 'application/json' } })
      .then(async response => {
        const body = await response.json()
        if (!response.ok || !body.ok) throw new Error(body.message || `HTTP ${response.status}`)
        if (alive) setState({ status: 'ready', data: body.capabilities, error: '' })
      })
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
