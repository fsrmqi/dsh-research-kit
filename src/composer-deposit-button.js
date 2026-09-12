import React from 'react'
import { h, C } from './theme.js'
import { Icon } from './lib/icons.js'
import { depositLatestAssistantMessage } from './knowledge-deposition.js'

// 手动沉淀伴生钮：贴着对话增强器的浮动按钮停靠（用户要求「往对话增强器按钮上放一个」）。
// vendored QuickEnhancer 的触发钮是 44px 浮动圆钮、位置持久化在 localStorage；
// 本按钮读同一存储位置，算出「正上方（放不下翻到正下方）」的伴生位，不独立拖拽——
// 增强器挪，它跟着挪；拖拽结束（pointerup）与窗口尺寸变化时重算。
//
// 行为边界与图谱页的「沉淀最近回答」完全一致：同一提取链路、同一「待核验」起点、
// 显式点击才触发；点击结果以临时状态条反馈并自动消失，绝不注入输入框。

// 与 vendored useFloatingLauncher 的存储键逐字一致（storagePrefix + 'quick-action.position.v1'）。
export const QUICK_ENHANCER_POSITION_KEY = 'dsh-research-kit.promptkit.quick-action.position.v1'
// vendored 触发钮固定 44px（vendor 源码 buttonStyle）；伴生钮略小以示主从。
export const ENHANCER_BUTTON_SIZE = 44
export const DEPOSIT_BUTTON_SIZE = 38
export const DEPOSIT_BUTTON_GAP = 8
// vendored 的拖拽钳制范围（左上角坐标）：x ∈ [16, width-62]，y ∈ [58, height-62]。
const CLAMP_MIN_X = 16
const CLAMP_MAX_INSET_X = 62
const CLAMP_MIN_Y = 58
const CLAMP_MAX_INSET_Y = 62

// 纯位置解算（单测覆盖）：给出增强器按钮的左上坐标与视口，返回伴生钮左上坐标。
// stored 非法/缺省时按 vendored 默认位（右下角）推算，与增强器默认位对齐。
export function companionDepositPosition(stored, viewport, size = DEPOSIT_BUTTON_SIZE) {
  const width = Math.max(0, Number(viewport?.width) || 0)
  const height = Math.max(0, Number(viewport?.height) || 0)
  const usable = stored && Number.isFinite(Number(stored?.x)) && Number.isFinite(Number(stored?.y))
    ? { x: Number(stored.x), y: Number(stored.y) }
    : { x: Math.max(24, width - 86), y: Math.max(96, height - 158) }
  const anchorX = Math.min(Math.max(CLAMP_MIN_X, usable.x), Math.max(CLAMP_MIN_X, width - CLAMP_MAX_INSET_X))
  const anchorY = Math.min(Math.max(CLAMP_MIN_Y, usable.y), Math.max(CLAMP_MIN_Y, height - CLAMP_MAX_INSET_Y))
  // 与增强钮共享中轴；先试正上方，贴顶放不下翻到正下方，末端钳进视口。
  const x = anchorX + (ENHANCER_BUTTON_SIZE - size) / 2
  const above = anchorY - DEPOSIT_BUTTON_GAP - size
  if (above >= CLAMP_MIN_Y) return { x, y: above }
  const below = anchorY + ENHANCER_BUTTON_SIZE + DEPOSIT_BUTTON_GAP
  return { x, y: Math.min(below, Math.max(CLAMP_MIN_Y, height - size - 16)) }
}

const STATUS_TONE_STYLE = {
  ok: { color: C.teal, borderColor: C.tealLine },
  warn: { color: C.amber, borderColor: C.amber },
  busy: { color: C.muted, borderColor: C.line },
}

export function ResearchDepositButton() {
  const [position, setPosition] = React.useState(null)
  const [status, setStatus] = React.useState(null)
  const statusTimer = React.useRef(null)

  const measure = React.useCallback(() => {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return
    let stored = null
    try { stored = JSON.parse(window.localStorage.getItem(QUICK_ENHANCER_POSITION_KEY) || 'null') } catch { stored = null }
    setPosition(companionDepositPosition(stored, { width: window.innerWidth, height: window.innerHeight }))
  }, [])

  React.useEffect(() => {
    measure()
    // 拖拽结束（vendored 在 pointerup 落盘位置）与窗口变化后重算，保持贴合增强器按钮。
    window.addEventListener('resize', measure)
    window.addEventListener('pointerup', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('pointerup', measure)
      if (statusTimer.current) window.clearTimeout(statusTimer.current)
    }
  }, [measure])

  const deposit = async () => {
    if (status?.tone === 'busy') return
    if (statusTimer.current) { window.clearTimeout(statusTimer.current); statusTimer.current = null }
    setStatus({ tone: 'busy', text: '正在沉淀…' })
    let next = null
    try {
      const result = await depositLatestAssistantMessage()
      if (result?.error === 'no-sessions') next = { tone: 'warn', text: '当前环境未提供会话服务' }
      else if (result?.error === 'no-session') next = { tone: 'warn', text: '没有可读取的当前会话' }
      else if (result?.error === 'empty') next = { tone: 'warn', text: '会话里没有可沉淀的回答' }
      else if (!result?.summary?.extracted) next = { tone: 'warn', text: '最近一条回答没有研究内容' }
      else {
        next = {
          tone: 'ok',
          text: `已沉淀：+${result.summary.addedNodes} 节点 · 证据 ${result.summary.savedEvidence} · 资产 ${result.summary.savedAssets}`,
          detail: `消息 #${result.seq ?? '?'}${result.interrupted ? '（曾被中断，内容可能不完整）' : ''}；全部以待核验状态入库，可在「研究证据图谱」分区查看。`,
        }
      }
    } catch (error) {
      next = { tone: 'warn', text: `沉淀失败：${error?.message || error}` }
    }
    setStatus(next)
    statusTimer.current = window.setTimeout(() => setStatus(null), 6000)
  }

  if (!position) return null
  return h(React.Fragment, null, [
    status ? h('div', {
      key: 'status',
      role: 'status',
      title: status.detail || status.text,
      style: {
        position: 'fixed', left: Math.max(8, position.x - 40), bottom: 'auto',
        top: Math.max(8, position.y - 34), zIndex: 20012,
        maxWidth: 'min(340px, calc(100vw - 24px))',
        padding: '5px 9px', border: `1px solid ${STATUS_TONE_STYLE[status.tone].borderColor}`,
        borderRadius: 8, background: C.surface, boxShadow: C.shadowCard,
        fontSize: 11, lineHeight: 1.45, color: STATUS_TONE_STYLE[status.tone].color,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none',
      },
    }, status.text) : null,
    h('button', {
      key: 'deposit',
      type: 'button',
      'aria-label': '沉淀当前会话最近一条助手回答',
      title: '把当前会话最近一条助手回答提取入库（本地完成，待核验起步；不开自动沉淀也可用）',
      onClick: deposit,
      style: {
        position: 'fixed', left: position.x, top: position.y, zIndex: 20011,
        width: DEPOSIT_BUTTON_SIZE, height: DEPOSIT_BUTTON_SIZE, padding: 0,
        border: `1px solid ${C.tealLineStrong}`, borderRadius: '50%',
        background: C.tealTint, color: C.teal, cursor: status?.tone === 'busy' ? 'wait' : 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 6px 16px var(--pk-shadow-faint, rgba(15,40,60,.14))',
        transition: 'transform .16s ease, box-shadow .16s ease',
      },
      onMouseEnter: event => { event.currentTarget.style.transform = 'scale(1.06)' },
      onMouseLeave: event => { event.currentTarget.style.transform = 'none' },
    }, h(Icon, { name: 'sparkles', size: 18 })),
  ])
}
