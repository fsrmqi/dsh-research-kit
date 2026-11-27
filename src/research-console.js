import React from 'react'
import { h, C, GlobalStyle } from './theme.js'
import { Page, Segmented, Spinner, Notice, Button, Input, Textarea, Card } from './ui.js'
import { catalogReady, composeWorkflow, loadBrowserCatalog, searchCatalog, subscribeCatalog } from './catalog.js'
import { loadPromptKit, promptKitReady } from './promptkit-loader.js'
import { supportsSafeInsert } from './lib/input-actions.js'
import { ensureResearchProviders, ResearchPromptStudioHost, researchMethodProvider, researchAssetProvider } from '../dsh/prompt-studio-glue.js'
import { RESEARCH_CONSOLE_SECTIONS, normalizeConsoleSection, findConsoleSection } from './lib/console-sections.js'
import { ResearchProjectHome } from './research-project-home.js'
import { ResearchWorkbench } from './research-workbench.js'
import { ResearchVaultHost } from './research-vault.js'
import { ResearchEvidenceGraphHost } from './research-evidence-graph.js'
import { ResearchTransferPanel } from './research-transfer-panel.js'

const SECTION_STORAGE_KEY = 'dsh-research-kit.console.section'

// 分区 → 组件映射。key 与 console-sections.js 的 section.id 一一对应；
// 新增分区时必须同时在这里挂载组件，避免出现「有导航无内容」的空分区。
const SECTION_VIEWS = {
  home: props => h(ResearchProjectHome, { onNavigate: props.onNavigate, inputActions: props.inputActions, insertMaterialReference: props.insertMaterialReference }),
  catalog: props => h(ResearchWorkbench, { sessionId: props.sessionId, inputActions: props.inputActions, initialWorkflowId: props.initialWorkflowId, initialType: props.catalogType, launchSession: props.launchSession, embedded: true }),
  methods: props => props.mine ? h(ResearchPersonalTemplates, props) : h(ResearchPromptStudioHost, props),
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

const RESEARCH_HOME_TABS = [{ value: 'home', label: '本次研究' }, { value: 'catalog', label: '科研工具' }]
const RESEARCH_TOOL_TABS = [
  { value: 'workflow', label: '选流程' }, { value: 'methods', label: '用方法' },
  { value: 'database', label: '查来源' }, { value: 'mine', label: '我的' },
]

const RESEARCH_TEMPLATE_HISTORY_KEY = 'dsh-research-kit.template-history.v1'

function readResearchTemplateHistory(id) {
  try {
    const history = JSON.parse(window.localStorage.getItem(`${RESEARCH_TEMPLATE_HISTORY_KEY}.${id}`) || '[]')
    return Array.isArray(history) ? history : []
  } catch { return [] }
}

function ResearchPersonalTemplates({ inputActions }) {
  const provider = researchMethodProvider
  const [items, setItems] = React.useState([])
  const [draft, setDraft] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [selectedHistory, setSelectedHistory] = React.useState('')
  const [copyOpen, setCopyOpen] = React.useState(false)
  const [sourceQuery, setSourceQuery] = React.useState('')
  const [builtinMethods, setBuiltinMethods] = React.useState([])
  const [notice, setNotice] = React.useState('')
  const reload = async () => {
    const backup = JSON.parse(await provider.exportPrivateMethods())
    setItems(backup.methods)
  }
  React.useEffect(() => { reload().catch(error => setNotice(error.message)) }, [provider])
  const save = async event => {
    event.preventDefault()
    if (!draft?.title.trim() || !draft.prompt.trim() || busy) return
    setBusy(true)
    const fields = {
      title: draft.title, category: draft.category, purpose: draft.purpose, outcome: draft.outcome,
      tags: draft.tags?.join(', '), keywords: draft.triggerKeywords?.join(', '),
    }
    const metadata = Object.entries(fields).filter(([, value]) => value).map(([key, value]) => `${key}: ${String(value).replace(/[\r\n]+/g, ' ').trim()}`)
    const markdown = ['---', ...metadata, '---', '', draft.prompt].join('\n')
    try {
      const previous = items.find(item => item.id === draft.id)
      let savedHistory = true
      if (draft.id) await provider.updatePrivateMarkdown(draft.id, markdown)
      else await provider.importPrivateMarkdown(markdown)
      if (previous && (previous.title !== draft.title.trim() || previous.prompt !== draft.prompt.trim())) {
        const history = readResearchTemplateHistory(draft.id)
        try {
          window.localStorage.setItem(`${RESEARCH_TEMPLATE_HISTORY_KEY}.${draft.id}`, JSON.stringify(
            [{ at: Date.now(), title: previous.title, prompt: previous.prompt }, ...history].slice(0, 10),
          ))
        } catch { savedHistory = false }
      }
      setDraft(null)
      await reload()
      setNotice(savedHistory ? '已保存到我的模板。' : '模板已保存，客户端未能保留上一版本。')
    } catch (error) { setNotice(error.message) }
    finally { setBusy(false) }
  }
  const use = item => {
    if (!supportsSafeInsert(inputActions)) return setNotice('当前客户端无法安全插入，请从编辑框复制。')
    const span = inputActions.captureInsertion()
    const ok = inputActions.insertText(`\n\n${item.prompt}\n\n`, { ...span, start: span.end })
    setNotice(ok ? '已插入当前会话草稿。' : '草稿已变化，请重新尝试。')
  }
  const openCopy = () => {
    setCopyOpen(value => !value)
    if (!copyOpen) provider.list().then(methods => setBuiltinMethods(methods.filter(item => item.source !== 'private')))
      .catch(error => setNotice(error.message))
  }
  const query = sourceQuery.trim().toLowerCase()
  const sourceMethods = query ? builtinMethods.filter(item => `${item.title} ${item.purpose}`.toLowerCase().includes(query)).slice(0, 4) : []
  const sourceWorkflows = query ? searchCatalog({ type: 'workflow', query }).slice(0, 4) : []
  const newDraft = (category, item) => {
    setNotice('')
    setCopyOpen(false)
    setDraft({
      ...item, id: undefined, category,
      title: item ? `${item.title}（副本）` : '',
      prompt: item?.prompt || '',
    })
  }
  return h('section', { className: 'rk-personal-templates' }, [
    h('div', { key: 'head', className: 'rk-personal-head' }, [
      h('div', { key: 'titles' }, [
        h('h2', { key: 'title' }, '我的方法与流程'),
        h('p', { key: 'help' }, '保存常用提示词与研究步骤，在本客户端重复使用。'),
      ]),
      h('div', { key: 'actions', className: 'rk-compose-actions' }, [
        h(Button, { key: 'method', variant: 'primary', onClick: () => newDraft('我的方法') }, '新建方法'),
        h(Button, { key: 'workflow', variant: 'ghost', onClick: () => newDraft('我的工作流') }, '新建流程'),
        h(Button, { key: 'from', variant: 'ghost', 'aria-expanded': copyOpen, onClick: openCopy }, '从目录复制'),
      ]),
    ]),
    copyOpen ? h(Card, { key: 'catalog-copy' }, h('div', { className: 'rk-template-form' }, [
      h(Input, { key: 'q', value: sourceQuery, onChange: setSourceQuery, ariaLabel: '搜索可复制的模板', placeholder: '搜索内置流程或方法' }),
      ...sourceWorkflows.map(item => h(Button, {
        key: `workflow-${item.id}`, size: 'sm', variant: 'ghost',
        onClick: () => newDraft('我的工作流', {
          title: item.name, purpose: `复制自目录流程 · ${item.name}`,
          prompt: composeWorkflow(item, {}, { enforceRequired: false, extraSkillIds: item.suggestedSkillIds, extraDatabaseIds: item.suggestedDatabaseIds }).prompt,
        }),
      }, `复制流程 · ${item.name}`)),
      ...sourceMethods.map(item => h(Button, {
        key: `method-${item.id}`, size: 'sm', variant: 'ghost',
        onClick: () => newDraft('我的方法', { ...item, purpose: `复制自目录方法 · ${item.title}` }),
      }, `复制方法 · ${item.title}`)),
      query && !sourceWorkflows.length && !sourceMethods.length ? h('small', { key: 'empty', style: { color: C.muted } }, '未找到匹配的流程或方法。') : null,
    ])) : null,
    draft ? h(Card, { key: 'form' }, h('form', { onSubmit: save, className: 'rk-template-form' }, [
      h(Input, { key: 'title', value: draft.title, ariaLabel: '模板名称', placeholder: '模板名称', required: true, onChange: title => setDraft({ ...draft, title }) }),
      h(Textarea, { key: 'body', value: draft.prompt, ariaLabel: '模板内容', placeholder: '填写要交给 Agent 的提示词或研究步骤', rows: 8, required: true, onChange: prompt => setDraft({ ...draft, prompt }) }),
      h('div', { key: 'actions', className: 'rk-compose-actions' }, [
        h(Button, { key: 'save', type: 'submit', variant: 'primary', disabled: busy || !draft.title.trim() || !draft.prompt.trim() }, '保存模板'),
        h(Button, { key: 'cancel', variant: 'ghost', onClick: () => setDraft(null) }, '取消'),
      ]),
    ])) : null,
    notice ? h(Notice, { key: 'notice' }, notice) : null,
    ...items.map(item => h(Card, { key: item.id }, [
      h('div', { key: 'head', className: 'rk-personal-head' }, [
        h('div', { key: 'label' }, [
          h('strong', { key: 'title' }, item.title),
          h('div', { key: 'category', className: 'rk-compose-reason' }, item.category === '我的工作流' ? '流程' : '方法'),
          item.purpose?.startsWith('复制自目录') ? h('div', { key: 'source', className: 'rk-compose-reason' }, item.purpose) : null,
        ]),
        h('div', { key: 'actions', className: 'rk-compose-actions' }, [
          h(Button, { key: 'edit', size: 'sm', onClick: () => { setNotice(''); setDraft({ ...item }) } }, '查看或编辑'),
          h(Button, { key: 'copy', size: 'sm', variant: 'ghost', onClick: () => newDraft(item.category, item) }, '复制为新模板'),
          h(Button, { key: 'history', size: 'sm', variant: 'ghost', 'aria-expanded': selectedHistory === item.id, onClick: () => setSelectedHistory(current => current === item.id ? '' : item.id) }, '版本记录'),
          h(Button, { key: 'use', size: 'sm', variant: 'primary', onClick: () => use(item) }, '插入草稿'),
        ]),
      ]),
      selectedHistory === item.id ? h('div', { key: 'versions', className: 'rk-template-form' }, [
        h('small', { key: 'note', style: { color: C.muted } }, '最多保留 10 条本地历史。载入后可在编辑区查看，保存后成为新版本。'),
        ...readResearchTemplateHistory(item.id).map((version, index) => h(Button, {
          key: `${version.at}-${index}`, variant: 'ghost', size: 'sm',
          onClick: () => { setNotice('已载入历史版本，可在编辑区查看。'); setDraft({ ...item, title: version.title, prompt: version.prompt }) },
        }, `查看 ${new Date(version.at).toLocaleString()} · ${version.title}`)),
      ]) : null,
    ])),
    !items.length && !draft ? h('p', { key: 'empty', className: 'rk-compose-reason' }, '还没有个人模板。可以从一段常用提示词或可复用的研究步骤开始。') : null,
  ])
}

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
  const [section, setSection] = React.useState(readStoredSection)
  const [catalogLoaded, setCatalogLoaded] = React.useState(catalogReady)
  const [promptKitLoaded, setPromptKitLoaded] = React.useState(promptKitReady)
  const [catalogError, setCatalogError] = React.useState('')
  const [promptKitError, setPromptKitError] = React.useState('')
  const [vaultTab, setVaultTab] = React.useState('assets')
  const [initialWorkflowId, setInitialWorkflowId] = React.useState('')
  const [catalogType, setCatalogType] = React.useState('workflow')
  const [mine, setMine] = React.useState(false)
  const [transferOpen, setTransferOpen] = React.useState(false)
  const current = findConsoleSection(section, RESEARCH_CONSOLE_SECTIONS)
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
  const select = (id, options = {}) => {
    if (id === 'catalog') {
      setCatalogType(options.type || 'workflow')
      if (options.workflowId) setInitialWorkflowId(options.workflowId)
    }
    if (id === 'methods') setMine(Boolean(options.mine))
    if (options.tab) setVaultTab(options.tab)
    setSection(normalizeConsoleSection(id))
    persistSection(id)
  }
  const inTools = current.id === 'catalog' || current.id === 'methods'
  const goTool = value => {
    if (value === 'mine' || value === 'methods') select('methods', { mine: value === 'mine' })
    else select('catalog', { type: value })
  }
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
      h('div', { key: 'main', className: 'rk-console-main' }, [
        h(Segmented, { key: 'tabs', value: inTools ? 'catalog' : 'home', options: RESEARCH_HOME_TABS, onChange: id => select(id), ariaLabel: '科研工作台分区' }),
        inTools ? h(Segmented, { key: 'tools', value: current.id === 'methods' ? (mine ? 'mine' : 'methods') : catalogType, options: RESEARCH_TOOL_TABS, onChange: goTool, ariaLabel: '科研工具分类' }) : h('div', { key: 'research-actions', className: 'rk-compose-actions' }, [
          h(Button, { key: 'materials', size: 'sm', variant: 'ghost', onClick: () => select('vault', { tab: 'assets' }) }, '研究资料'),
          h(Button, { key: 'evidence', size: 'sm', variant: 'ghost', onClick: () => select('evidence') }, '证据关系'),
          current.id === 'vault' ? h(Button, { key: 'transfer', size: 'sm', variant: 'ghost', onClick: () => setTransferOpen(value => !value), 'aria-expanded': transferOpen }, '迁移到 App') : null,
        ]),
      ]),
    ]),
    transferOpen && promptKitLoaded ? h(ResearchTransferPanel, { key: 'transfer-panel', assetProvider: researchAssetProvider, onClose: () => setTransferOpen(false) }) : null,
    h('div', { key: 'section', 'data-section': current.id }, (current.id === 'home' || catalogLoaded) && (!needsPromptKit || promptKitLoaded)
      ? h(ResearchSectionBoundary, { key: current.id },
        view?.({ ...props, initialWorkflowId, catalogType, mine, vaultTab, onVaultTabChange: setVaultTab, onNavigate: select }))
      : resourceError
        ? h(Notice, { tone: 'error', style: { margin: 20 } }, resourceError)
        : h(Spinner, { text: '正在加载科研工作台……' })),
  ])
}
