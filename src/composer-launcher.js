import React from 'react'
import { h, C, GlobalStyle } from './theme.js'
import { Button } from './ui.js'

export const RESEARCH_COMPOSER_EVENT = 'dsh-research-kit:composer-open'
export const RESEARCH_RESOURCE_SELECTION_EVENT = 'dsh-research-kit:resource-selection-changed'

export function openResearchComposer(mode) {
  window.dispatchEvent(new CustomEvent(RESEARCH_COMPOSER_EVENT, { detail: { mode } }))
}

/** 输入框工具栏的紧凑入口；弹层本体由 conversation.input.overlay 承载。 */
export function ResearchComposerLauncher() {
  const [resourceCount, setResourceCount] = React.useState(0)
  React.useEffect(() => {
    const onSelectionChange = event => setResourceCount(Number(event.detail?.count) || 0)
    window.addEventListener(RESEARCH_RESOURCE_SELECTION_EVENT, onSelectionChange)
    return () => window.removeEventListener(RESEARCH_RESOURCE_SELECTION_EVENT, onSelectionChange)
  }, [])
  const open = mode => event => {
    event.preventDefault()
    event.stopPropagation()
    openResearchComposer(mode)
  }
  // 与增强器一致的紧凑按钮：8px 圆角、13px 字号、teal 描边淡底，选中态用 teal 文字强化。
  const launcherStyle = active => ({
    padding: '6px 11px',
    border: `1px solid ${active ? C.tealLineStrong : C.line}`,
    background: active ? C.tealTint : C.surface,
    color: active ? C.teal : C.ink,
    fontSize: 13,
    fontWeight: 600,
  })
  return h('div', { style: { display: 'flex', gap: 7, alignItems: 'center' } }, [
    h(GlobalStyle, { key: 'style' }),
    h(Button, {
      key: 'resources',
      size: 'sm',
      variant: 'ghost',
      icon: 'layers',
      onClick: open('resources'),
      onPointerDown: event => event.stopPropagation(),
      'aria-haspopup': 'dialog',
      style: launcherStyle(resourceCount > 0),
    }, resourceCount ? `资源 · ${resourceCount}` : '资源'),
    h(Button, {
      key: 'workflows',
      size: 'sm',
      variant: 'ghost',
      icon: 'wand',
      onClick: open('workflows'),
      onPointerDown: event => event.stopPropagation(),
      'aria-haspopup': 'dialog',
      style: launcherStyle(false),
    }, '工作流程'),
  ])
}
