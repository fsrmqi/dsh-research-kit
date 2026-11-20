import React from 'react'
import { h, C, GlobalStyle } from './theme.js'
import { Page, Segmented, Spinner, Notice, Button } from './ui.js'
import { catalogReady, loadBrowserCatalog, subscribeCatalog } from './catalog.js'
import { loadPromptKit, promptKitReady } from './promptkit-loader.js'
import { ensureResearchProviders } from '../dsh/prompt-studio-glue.js'
import { RESEARCH_CONSOLE_SECTIONS, normalizeConsoleSection, findConsoleSection } from './lib/console-sections.js'
import { ResearchProjectHome } from './research-project-home.js'
import { ResearchEvidenceGraphHost } from './research-evidence-graph.js'
import { AgentActivityPanel } from './agent-activity.js'
import { ResearchTransferPanel } from './research-transfer-panel.js'
import { currentResearchContext, setResearchProject, setResearchContext as updateResearchContext, subscribeResearchContext, activeResearchRun } from './research-context-store.js'

const SECTION_STORAGE_KEY = 'dsh-research-kit.console.section'

// 分区 → 组件映射。key 与 console-sections.js 的 section.id 一一对应；
// 新增分区时必须同时在这里挂载组件，避免出现「有导航无内容」的空分区。
const SECTION_VIEWS = {
  home: props => h(ResearchProjectHome, { onNavigate: props.onNavigate, inputActions: props.inputActions, insertMaterialReference: props.insertMaterialReference }),
  catalog: props => h(ResearchWorkbench, { sessionId: props.sessionId, inputActions: props.inputActions, initialWorkflowId: props.initialWorkflowId, launchSession: props.launchSession, embedded: true }),
  methods: props => h(ResearchPromptStudioHost, props),
  // embedded 必须显式传入：容器已渲染 Page + GlobalStyle，
  // 分区若再渲染一次会出现嵌套 main.rk-page，min-height:100vh 叠加后内容被挤出可视区。
  vault: props => h(ResearchVaultHost, { inputActions: props.inputActions, sessionId: props.sessionId, initialTab: props.vaultTab, onTabChange: props.onVaultTabChange, embedded: true }),
  evidence: props => h(ResearchEvidenceGraphHost, { sessionId: props.sessionId, embedded: true, onNavigate: props.onNavigate }),
}

function readStoredSection() {
  try {
    return normalizeConsoleSection(window.localStorage.getItem(SECTION_STORAGE_KEY))
  } catch {
    // 隐私模式或宿主禁用 storage：回落默认分区，不阻断渲染。
    return normalizeConsoleSection(null)
  }
}

function persistSection(id) {
  try { window.localStorage.setItem(SECTION_STORAGE_KEY, id) } catch { /* 忽略：持久化失败不影响导航 */ }
}

const META_LINE = { margin: 0, fontSize: 12, lineHeight: 1.55 }

class ResearchSectionBoundary extends React.Component {
  state = { error: '' }

  static getDerivedStateFromError(error) {
    return { error: error?.message || '未知错误' }
  }

  render() {
    return this.state.error
      ? h(Notice, { tone: 'error', style: { margin: 20 } }, `分区无法显示：${this.state.error}。切换分区后可以重试。`)
      : this.props.children
  }
}

export function ResearchConsole(props) {
  const { sessionId, inputActions } = props
  const [section, setSection] = React.useState(readStoredSection)
  const [researchContext, setResearchContext] = React.useState(currentResearchContext)
  const [projectDraft, setProjectDraft] = React.useState(() => currentResearchContext().project)
  const [catalogLoaded, setCatalogLoaded] = React.useState(catalogReady)
  const [promptKitLoaded, setPromptKitLoaded] = React.useState(promptKitReady)
  const [catalogError, setCatalogError] = React.useState('')
  const [promptKitError, setPromptKitError] = React.useState('')
  const [vaultTab, setVaultTab] = React.useState('assets')
  const [initialWorkflowId, setInitialWorkflowId] = React.useState('')
  const [transferOpen, setTransferOpen] = React.useState(false)
  const current = findConsoleSection(section)
  const needsPromptKit = current.id === 'methods' || (current.id === 'vault' && vaultTab === 'assets') || transferOpen
  const navRef = React.useRef(null)
  React.useLayoutEffect(() => {
    navRef.current?.parentElement?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
  }, [current.id, vaultTab])
  // 折行会改变导航高度，按实际 border-box 更新子分区的吸顶位置。
  React.useEffect(() => {
    const nav = navRef.current
    const host = nav?.parentElement
    if (!nav || !host) return undefined
    const apply = () => host.style.setProperty('--rk-console-nav-h', `${Math.ceil(nav.getBoundingClientRect().height)}px`)
    apply()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null
    observer?.observe(nav, { box: 'border-box' })
    window.addEventListener('resize', apply)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', apply)
      host.style.removeProperty('--rk-console-nav-h')
    }
  }, [])
  React.useEffect(() => subscribeResearchContext(setResearchContext), [])
  React.useEffect(() => {
    let active = true
    const markReady = () => {
      if (active && catalogReady()) { setCatalogLoaded(true); setCatalogError('') }
    }
    const dispose = subscribeCatalog(markReady)
    loadBrowserCatalog().then(markReady)
      .catch(error => { if (active) setCatalogError(error?.message || String(error)) })
    return () => { active = false; dispose() }
  }, [])
  React.useEffect(() => {
    if (!needsPromptKit || promptKitLoaded) return undefined
    let active = true
    loadPromptKit().then(PromptKit => {
      ensureResearchProviders(PromptKit)
      if (active) { setPromptKitLoaded(true); setPromptKitError('') }
    }).catch(error => { if (active) setPromptKitError(error?.message || String(error)) })
    return () => { active = false }
  }, [needsPromptKit, promptKitLoaded])
  React.useEffect(() => setProjectDraft(researchContext.project), [researchContext.project])
  const run = activeResearchRun()
  const activeRun = run?.project === researchContext.project ? run : null
  const commitProject = () => {
    const normalized = String(projectDraft || '').trim().slice(0, 100)
    if (normalized !== researchContext.project) setResearchProject(normalized)
  }
  const select = (id, options = {}) => {
    if (options.workflowId) setInitialWorkflowId(options.workflowId)
    if (options.tab) setVaultTab(options.tab)
    setSection(normalizeConsoleSection(id))
    persistSection(id)
  }
  const navOptions = RESEARCH_CONSOLE_SECTIONS.map(item => ({ value: item.id, label: item.label }))
  const view = SECTION_VIEWS[current.id]
  const resourceError = catalogError || (needsPromptKit ? promptKitError : '')
  return h(Page, { style: { padding: 0 } }, [
    h(GlobalStyle, { key: 'global-style' }),
    h('div', {
      key: 'nav',
      ref: navRef,
      className: 'rk-console-nav',
      style: {
        position: 'sticky', top: 0, zIndex: 20,
        padding: '20px var(--rk-gutter) 14px', background: C.canvas,
        borderBottom: `1px solid ${C.line}`,
      },
    }, [
      h(Segmented, { key: 'tabs', value: current.id, options: navOptions, onChange: select, ariaLabel: '科研工作台分区' }),
      h('div', { key: 'meta', style: { display: 'grid', gap: 2, marginTop: 10 } }, [
        h('details', { key: 'description', style: { fontSize: 12, color: C.muted } }, [
          h('summary', { key: 'summary', style: { cursor: 'pointer' } }, current.position),
          h('p', { key: 'purpose', style: META_LINE }, current.purpose),
          h('p', { key: 'boundary', style: META_LINE }, current.boundary),
        ]),
        h('div', { key: 'context', style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' } }, [
          h('label', { key: 'label', style: { fontSize: 12, color: C.muted } }, '当前项目'),
          h('input', {
            key: 'project', value: projectDraft,
            onChange: event => setProjectDraft(event?.target?.value || ''),
            onBlur: commitProject,
            onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur() },
            placeholder: '未命名项目', 'aria-label': '当前研究项目',
            style: { width: 190, maxWidth: '100%', border: `1px solid ${C.line}`, borderRadius: 7, padding: '5px 8px', color: C.ink, background: C.surface },
          }),
          activeRun ? h('span', { key: 'run', style: { fontSize: 12, color: C.teal } }, `运行中：${activeRun.workflowName || '未命名工作流'} · ${activeRun.status}`) : null,
          h(Button, { key: 'transfer', size: 'sm', variant: 'ghost', onClick: () => setTransferOpen(value => !value), 'aria-expanded': transferOpen }, '迁移到 App'),
        ]),
      ]),
    ]),
    transferOpen && promptKitLoaded ? h(ResearchTransferPanel, { key: 'transfer-panel', assetProvider: researchAssetProvider, onClose: () => setTransferOpen(false) }) : null,
    h('div', { key: 'section', 'data-section': current.id }, (current.id === 'home' || catalogLoaded) && (!needsPromptKit || promptKitLoaded)
      ? h(ResearchSectionBoundary, { key: current.id },
        view?.({ ...props, initialWorkflowId, vaultTab, onVaultTabChange: setVaultTab, onNavigate: select }))
      : resourceError
        ? h(Notice, { tone: 'error', style: { margin: 20 } }, resourceError)
        : h(Spinner, { text: '正在加载科研工作台……' })),
    h(AgentActivityPanel, {
      key: 'agent-activity',
      sessionId,
      runId: activeRun?.id || (run ? '' : researchContext.activeRunId),
      onRunDetected: mcpRunId => {
        if (!run && mcpRunId && mcpRunId !== researchContext.activeRunId) {
          updateResearchContext({ activeRunId: mcpRunId })
        }
      },
    }),
  ])
}
