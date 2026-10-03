import React from 'react'
import { h, C } from './theme.js'
import { Segmented } from './ui.js'

// 草稿增强的「入口形态」是本机偏好，不是插件配置：改完即时生效——不必重启 profile
// 重载插件（插件配置要重开才生效），重装插件也不受影响。
//   inline   输入框右侧纯图标钮（紧挨模型选择器），面板贴着按钮弹出 —— 默认，占用最小；
//   floating 右下角可拖拽悬浮钮（位置自动记忆）+「沉淀最近回答」伴生圆钮 —— 与旧版一致。
export const ENTRY_MODE_KEY = 'dsh-research-kit.entry-mode.v1'
export const ENTRY_MODE_INLINE = 'inline'
export const ENTRY_MODE_FLOATING = 'floating'
export const ENTRY_MODE_OPTIONS = [
  { value: ENTRY_MODE_INLINE, label: '输入框图标钮' },
  { value: ENTRY_MODE_FLOATING, label: '悬浮伴生钮' },
]
export const ENTRY_MODE_HINTS = {
  [ENTRY_MODE_INLINE]: '输入框右侧一个纯图标钮（悬停显示说明），面板贴着它弹出；不占右下角，也不再另放沉淀圆钮——手动沉淀走每条助手回答下方的操作区。',
  [ENTRY_MODE_FLOATING]: '右下角可拖拽的悬浮钮，位置自动记忆；旁边恢复「沉淀最近回答」伴生圆钮，与本次改版前的行为一致。',
}

const entryModeListeners = new Set()

/** 只认两个合法值：任何脏数据（null / 旧值 / 手改）一律回落到默认的内联形态。 */
export function normalizeEntryMode(value) {
  return value === ENTRY_MODE_FLOATING ? ENTRY_MODE_FLOATING : ENTRY_MODE_INLINE
}

export function readEntryMode() {
  try {
    return normalizeEntryMode(window.localStorage.getItem(ENTRY_MODE_KEY))
  } catch {
    return ENTRY_MODE_INLINE // 存储不可用（隐私模式等）时用默认形态，不报错
  }
}

/** 写入并广播：输入框那一侧的槽位与设置区同一次渲染就换过来，无需刷新页面。 */
export function writeEntryMode(value) {
  const mode = normalizeEntryMode(value)
  try { window.localStorage.setItem(ENTRY_MODE_KEY, mode) } catch { /* 写不了也仍然即时生效 */ }
  for (const listener of [...entryModeListeners]) {
    try { listener(mode) } catch { /* 单个订阅者出错不牵连其它 */ }
  }
  return mode
}

export function subscribeEntryMode(listener) {
  entryModeListeners.add(listener)
  return () => entryModeListeners.delete(listener)
}

export function useEntryMode() {
  const [mode, setMode] = React.useState(readEntryMode)
  React.useEffect(() => subscribeEntryMode(setMode), [])
  return mode
}

/** Plugins 详情页里的设置项：悬浮伴生钮 ↔ 输入框图标钮，二选一。 */
export function EntryModeSetting() {
  const mode = useEntryMode()
  return h('section', {
    'aria-label': '草稿增强入口',
    'data-research-kit': 'entry-mode-setting',
    style: { display: 'grid', gap: 8, padding: '12px 14px', border: `1px solid ${C.line}`, borderRadius: 12, background: C.surfaceAlt },
  }, [
    h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' } }, [
      h('div', { key: 'copy', style: { display: 'grid', gap: 2 } }, [
        h('strong', { key: 'title', style: { fontSize: 13 } }, '草稿增强入口'),
        h('span', { key: 'scope', style: { color: C.muted, fontSize: 12 } }, '本机设置 · 改完即时生效'),
      ]),
      h(Segmented, {
        key: 'segmented', value: mode, options: ENTRY_MODE_OPTIONS, onChange: writeEntryMode, ariaLabel: '草稿增强入口形态',
      }),
    ]),
    h('p', { key: 'hint', style: { margin: 0, color: C.muted, fontSize: 12, lineHeight: 1.6 } }, ENTRY_MODE_HINTS[mode]),
  ])
}
