import React from 'react'
import { h, C } from './theme.js'
import { GlobalStyle, Page, Segmented } from './ui.js'
import { RESEARCH_CONSOLE_SECTIONS, normalizeConsoleSection, findConsoleSection } from './lib/console-sections.js'
import { ResearchEvidenceGraphHost } from './research-evidence-graph.js'

// 统一容器：把原先三个并列的 conversation.view 标签（科研工作台 / 研究方法工坊 / 研究灵感库）
// 收敛为一个视图，内部用二级导航按「发现 → 构造 → 沉淀 → 证据」组织。
//
// 容器职责边界：只做导航与分区声明，不持有任何业务逻辑，也不读写子模块的数据。
// 三个旧分区组件原样复用（本仓库组件走 embedded 模式，vendored 工坊零改动），合并前后能力集合不变；
// 「研究证据图谱」是合并之后新增的第四分区，也是本容器唯一的增量。

const SECTION_STORAGE_KEY = 'dsh-research-kit.console.section'

// 分区 → 组件映射。key 与 console-sections.js 的 section.id 一一对应；
// 新增分区时必须同时在这里挂载组件，避免出现「有导航无内容」的空分区。
const SECTION_VIEWS = {
  catalog: props => h(ResearchWorkbench, { sessionId: props.sessionId, inputActions: props.inputActions, embedded: true }),
  methods: props => h(ResearchPromptStudioHost, props),
  // embedded 必须显式传入：容器已渲染 Page + GlobalStyle，
  // 分区若再渲染一次会出现嵌套 main.rk-page，min-height:100vh 叠加后内容被挤出可视区。
  vault: props => h(ResearchVaultHost, { embedded: true }),
  evidence: props => h(ResearchEvidenceGraphHost, { sessionId: props.sessionId, embedded: true }),
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

export function ResearchConsole(props) {
  const { sessionId, inputActions } = props
  const [section, setSection] = React.useState(readStoredSection)
  const navRef = React.useRef(null)
  // 二级吸顶偏移量 = 一级导航的实测高度。不能写死：窗口变窄时说明块换行、
  // 分区标签条在窄屏折行，都会改变导航高度（实测 149px @990px 宽，约 120px @窄屏）。
  // 取 ceil 而非 round：宁可让二级吸顶压住导航 1px 边框，也不要留出透缝。
  //
  // box 必须显式指定 border-box：ResizeObserver 默认只观察 content-box，
  // 因此「改内边距/边框导致视觉高度变化而内容框不变」不会触发回调
  // ——实测中表现为导航被撑高 40px 后二级吸顶仍停在旧位置，压进导航底下。
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
  const current = findConsoleSection(section)
  const select = id => {
    setSection(normalizeConsoleSection(id))
    persistSection(id)
  }
  const navOptions = RESEARCH_CONSOLE_SECTIONS.map(item => ({ value: item.id, label: item.label }))
  const view = SECTION_VIEWS[current.id]
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
        h('p', { key: 'position', style: { ...META_LINE, color: C.slate, fontWeight: 650 } }, `定位：${current.position}`),
        h('p', { key: 'purpose', style: { ...META_LINE, color: C.muted } }, `核心用途：${current.purpose}`),
        h('p', { key: 'boundary', style: { ...META_LINE, color: C.muted } }, `职责边界：${current.boundary}`),
      ]),
    ]),
    h('div', { key: 'section', 'data-section': current.id }, view ? view(props) : null),
  ])
}
