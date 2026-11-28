import React from 'react'
import { h, C } from './theme.js'
import { Icon } from './lib/icons.js'
import { ResearchMessageDepositAction } from './message-deposit-action.js'
import { bodyPortal } from './lib/overlay-anchor.js'

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

export function ResearchDepositButton() {
  const [position, setPosition] = React.useState(null)
  const mountedRef = React.useRef(false)
  const [instant, setInstant] = React.useState(true)
  const measure = React.useCallback(() => {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return
    let stored = null
    try { stored = JSON.parse(window.localStorage.getItem(QUICK_ENHANCER_POSITION_KEY) || 'null') } catch { stored = null }
    const next = companionDepositPosition(stored, { width: window.innerWidth, height: window.innerHeight })
    if (mountedRef.current) setInstant(false)
    else mountedRef.current = true
    setPosition(next)
  }, [])

  React.useEffect(() => {
    measure()
    // 拖拽结束（vendored 在 pointerup 落盘位置）与窗口变化后重算，保持贴合增强器按钮。
    window.addEventListener('resize', measure)
    window.addEventListener('pointerup', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('pointerup', measure)
    }
  }, [measure])

  if (!position) return null
  return bodyPortal(h(ResearchMessageDepositAction, {
    triggerLabel: '保存最近回答',
    triggerContent: h(Icon, { name: 'sparkles', size: 18 }),
    triggerClassName: 'rk-fab-btn rk-deposit-fab',
    triggerDataInstant: instant,
    triggerStyle: {
      position: 'fixed', left: 0, top: 0, zIndex: 20011,
      transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
      width: DEPOSIT_BUTTON_SIZE, height: DEPOSIT_BUTTON_SIZE, padding: 0,
      border: `1px solid ${C.tealLineStrong}`, borderRadius: '50%',
      background: C.tealTint, color: C.teal, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 6px 16px var(--pk-shadow-faint, rgba(15,40,60,.14))',
    },
  }))
}
