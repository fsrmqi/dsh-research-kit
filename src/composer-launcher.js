import React from 'react'
import { h, C, GlobalStyle } from './theme.js'
import { Button, CountValue } from './ui.js'

export const RESEARCH_COMPOSER_EVENT = 'dsh-research-kit:composer-open'
export const RESEARCH_RESOURCE_SELECTION_EVENT = 'dsh-research-kit:resource-selection-changed'

export const RESEARCH_ORGANIZE_EVENT = 'dsh-research-kit:organize-draft'

export function openResearchComposer(mode, sessionId) {
  window.dispatchEvent(new CustomEvent(RESEARCH_COMPOSER_EVENT, { detail: { mode, sessionId } }))
}

/** 输入框工具栏入口，选择器由对话输入浮层槽位承载。 */
export function ResearchComposerLauncher({ sessionId }) {
  const [status, setStatus] = React.useState(null)
  React.useEffect(() => {
    const onSelectionChange = event => {
      if (event.detail?.sessionId === sessionId) setStatus(event.detail)
    }
    window.addEventListener(RESEARCH_RESOURCE_SELECTION_EVENT, onSelectionChange)
    return () => window.removeEventListener(RESEARCH_RESOURCE_SELECTION_EVENT, onSelectionChange)
  }, [sessionId])
  const { count, enabled } = status?.sessionId === sessionId ? status || {} : {}
  return h(React.Fragment, null, [
    h(GlobalStyle, { key: 'style' }),
    h(Button, {
      key: 'research',
      size: 'sm', variant: 'ghost', icon: 'wand',
      onClick: event => {
        event.preventDefault()
        event.stopPropagation()
        openResearchComposer('workflows', sessionId)
      },
      onPointerDown: event => event.stopPropagation(),
      'aria-haspopup': 'dialog',
      'aria-label': '科研辅助',
      title: enabled ? '自动建议已开启' : '打开科研辅助',
      style: { color: enabled ? C.teal : C.ink, background: enabled ? C.tealTint : C.surface },
    }, ['科研辅助', count ? h(CountValue, { key: 'count', prefix: ' · ', value: count }) : '', enabled ? ' · 自动' : '']),
  ])
}
