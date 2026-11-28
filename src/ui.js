import React from 'react'
import { h, C } from './theme.js'
import { bodyPortal } from './lib/overlay-anchor.js'
import { Icon } from './lib/icons.js'
import { getToasts, subscribeToasts, dismissToast } from './lib/toast.js'

// 统一基础组件层。所有科研视图（工作台 / 资源选择器 / 研究资产库 / 数据库面板 / 输入框入口）
// 只从这里取组件，保证与 dsh-promptkit「研究方法工厂对话增强器」的视觉与交互一致：
// 同一套 teal 主色、12px 卡片圆角 / 8px 控件圆角、13px 正文、统一阴影刻度与悬浮反馈。
// 组件只负责外观与无障碍属性，不持有任何业务逻辑。

const FONT = { fontFamily: C.font }

export function Spinner({ text, size = 12 }) {
  return h('span', { className: 'rk-fade', style: { display: 'inline-flex', alignItems: 'center', gap: 7, color: C.muted, fontSize: 13, lineHeight: 1.5 } }, [
    h('span', {
      key: 'dot',
      'aria-hidden': 'true',
      className: 'rk-spinner-ring',
      style: {
        display: 'inline-block', width: size, height: size, borderRadius: '50%',
        border: `2px solid ${C.tealLine}`, borderTopColor: C.teal,
      },
    }),
    text,
  ])
}

export function CountValue({ value, suffix = '', prefix = '', style }) {
  const prevRef = React.useRef(value)
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value
      setTick(n => n + 1)
    }
  }, [value])
  return h('span', {
    key: tick ? `tick-${tick}` : 'init',
    className: tick ? 'rk-num-tick' : 'rk-tabular',
    style,
  }, `${prefix}${value}${suffix}`)
}

const BUTTON_VARIANTS = {
  primary: { border: `1px solid ${C.tealStrong}`, background: C.tealStrong, color: C.onInk },
  soft: { border: `1px solid ${C.tealLineStrong}`, background: C.tealTint, color: C.teal },
  ghost: { border: `1px solid ${C.line}`, background: C.surface, color: C.ink },
  quiet: { border: '1px solid transparent', background: 'transparent', color: C.muted },
  danger: { border: `1px solid ${C.line}`, background: C.surface, color: C.red },
}
const BUTTON_SIZES = {
  sm: { padding: '5px 10px', fontSize: 12, borderRadius: 7 },
  md: { padding: '10px 18px', fontSize: 13, borderRadius: 8 },
  smSoft: { padding: '5px 11px', fontSize: 12, borderRadius: 7 },
}

export function Button({ variant = 'soft', size = 'md', icon, disabled = false, onClick, type = 'button', title, className, style, children, ...rest }) {
  const prevIconRef = React.useRef(icon)
  const [iconChanged, setIconChanged] = React.useState(false)
  React.useEffect(() => {
    if (prevIconRef.current !== icon) {
      prevIconRef.current = icon
      setIconChanged(true)
    }
  }, [icon])
  const base = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.soft
  // 次要按钮本就比主按钮矮一档，避免「写入 / 发送 / 复制」三个出口等高时主次不分。
  const sizing = size === 'sm' ? (variant === 'primary' ? BUTTON_SIZES.smSoft : BUTTON_SIZES.sm) : BUTTON_SIZES.md
  const variantClass = `rk-btn rk-btn--${BUTTON_VARIANTS[variant] ? variant : 'soft'}`
  return h('button', {
    type,
    onClick,
    disabled,
    title,
    className: className ? `${variantClass} ${className}` : variantClass,
    ...rest,
    style: {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
      fontWeight: 600, ...FONT, ...sizing, ...base, ...style,
    },
  }, [icon ? h('span', {
    key: `i-${icon}`,
    className: iconChanged ? (icon === 'check' ? 'rk-check-pop' : 'rk-icon-swap') : undefined,
    style: { display: 'inline-flex' },
  }, h(Icon, { name: icon, size: 13 })) : null, children])
}

export function IconButton({ name, iconKey, size = 15, onClick, label, active = false, disabled = false, style, ...rest }) {
  return h('button', {
    type: 'button',
    onClick,
    disabled,
    title: label,
    'aria-label': label,
    'aria-pressed': active,
    className: 'rk-btn',
    ...rest,
    style: {
      width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: `1px solid ${active ? C.tealLineStrong : C.line}`, borderRadius: '50%',
      background: active ? C.tealTint : C.surfaceAlt, color: active ? C.teal : C.muted,
      cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0, ...style,
    },
  }, h(Icon, { key: iconKey, name, size }))
}

export function StarButton({ active, onClick, label }) {
  return h('button', {
    type: 'button',
    onClick,
    title: label,
    'aria-label': label,
    'aria-pressed': active,
    className: `rk-btn${active ? ' rk-star-active' : ''}`,
    style: {
      width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: `1px solid ${active ? C.amberLine : C.line}`, borderRadius: '50%',
      background: active ? C.amberTint : C.surfaceAlt, color: active ? C.amber : C.muted,
      cursor: 'pointer', flexShrink: 0,
    },
  }, h(Icon, { name: 'star', size: 14, style: active ? { fill: 'currentColor' } : undefined }))
}

// 统一两段式危险操作按钮：首次点亮确认态，附带明确「取消」并在 4 秒无操作后自动复位，
// 避免不同页面各写一套删除确认（有的缺问号、有的不复位、有的无取消）。
export function ConfirmDangerButton({
  label = '删除',
  confirmLabel = '确认删除？',
  cancelLabel = '取消',
  title,
  confirmTitle,
  variant = 'danger',
  size = 'sm',
  icon = 'trash',
  disabled = false,
  resetMs = 4000,
  onConfirm,
  style,
}) {
  const [armed, setArmed] = React.useState(false)
  React.useEffect(() => {
    if (!armed || !resetMs) return undefined
    const timer = window.setTimeout(() => setArmed(false), resetMs)
    return () => window.clearTimeout(timer)
  }, [armed, resetMs])
  if (!armed) {
    return h(Button, {
      size, variant, icon, disabled, title, style,
      onClick: () => setArmed(true),
    }, label)
  }
  return h('span', {
    className: 'rk-reveal',
    style: { display: 'inline-flex', alignItems: 'center', gap: 5, ...style },
  }, [
    h(Button, {
      key: 'go', size, variant: 'danger', icon, disabled, title: confirmTitle || title,
      onClick: () => { setArmed(false); onConfirm?.() },
    }, confirmLabel),
    h(Button, {
      key: 'cancel', size, variant: 'ghost', disabled,
      onClick: () => setArmed(false),
    }, cancelLabel),
  ])
}

// 统一带即时勾选反馈的复制按钮：复制成功后切为 ✓ +「已复制」保持 2 秒。
export function CopyButton({
  getText,
  label = '复制',
  copiedLabel = '已复制',
  size = 'sm',
  variant = 'ghost',
  disabled = false,
  onCopied,
  onError,
  style,
}) {
  const [copied, setCopied] = React.useState(false)
  const timerRef = React.useRef(null)
  React.useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  const handleCopy = async () => {
    try {
      const text = typeof getText === 'function' ? await getText() : String(getText ?? '')
      if (!String(text).trim()) return
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 2000)
      onCopied?.()
    } catch (error) {
      onError?.(error)
    }
  }
  return h(Button, {
    size, variant: copied ? 'soft' : variant, icon: copied ? 'check' : 'copy', disabled, style,
    onClick: handleCopy,
  }, copied ? copiedLabel : label)
}

// 统一弹层/展开区的 Esc 与外点收起钩子。
export function useDismissable(open, onClose, containerRef, { disabled = false } = {}) {
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose
  React.useEffect(() => {
    if (!open || disabled || typeof window === 'undefined') return undefined
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current?.()
      }
    }
    const onPointerDown = event => {
      if (!containerRef?.current) return
      if (containerRef.current.contains(event.target)) return
      onCloseRef.current?.()
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, disabled, containerRef])
}

export function Card({ as = 'div', interactive = false, className, style, children, ...rest }) {
  return h(as, {
    ...rest,
    className: [interactive && 'rk-card', className].filter(Boolean).join(' ') || undefined,
    style: { padding: 16, border: `1px solid ${C.line}`, borderRadius: 12, background: C.surface, boxShadow: C.shadowCard, ...FONT, ...style },
  }, children)
}

export function Panel({ style, children, ...rest }) {
  return h('section', {
    ...rest,
    style: { overflow: 'hidden', border: `1px solid ${C.line}`, borderRadius: 12, background: C.surface, boxShadow: C.shadowPanel, ...FONT, ...style },
  }, children)
}

export function PanelHead({ title, hint, actions, style }) {
  return h('div', {
    style: {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
      padding: '15px 18px', borderBottom: `1px solid ${C.line}`, background: C.surfaceAlt, ...style,
    },
  }, [
    h('div', { key: 'text', style: { minWidth: 0 } }, [
      h('h2', { key: 't', style: { margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: '-.01em', color: C.ink } }, title),
      hint ? h('p', { key: 'h', style: { margin: '3px 0 0', fontSize: 12, color: C.muted, lineHeight: 1.5 } }, hint) : null,
    ]),
    actions ? h('div', { key: 'a', style: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 } }, actions) : null,
  ])
}

export function Segmented({ value, options, onChange, ariaLabel }) {
  const containerRef = React.useRef(null)
  const mountedRef = React.useRef(false)
  const [indicator, setIndicator] = React.useState(null)
  const optionSig = options.map(o => `${o.value}:${o.label}`).join('|')
  React.useLayoutEffect(() => {
    const host = containerRef.current
    if (!host || typeof window === 'undefined') return undefined
    const measure = () => {
      const activeBtn = host.querySelector('button[aria-selected="true"]')
      if (!activeBtn) { setIndicator(null); return }
      const instant = !mountedRef.current
      mountedRef.current = true
      setIndicator({ x: activeBtn.offsetLeft, y: activeBtn.offsetTop, w: activeBtn.offsetWidth, h: activeBtn.offsetHeight, instant })
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(host)
    return () => observer?.disconnect()
  }, [value, optionSig])
  return h('div', {
    ref: containerRef,
    role: 'tablist',
    'aria-label': ariaLabel,
    className: 'rk-seg',
    style: {
      display: 'inline-flex', gap: 3, padding: 4, flexWrap: 'wrap',
      border: `1px solid ${C.line}`, borderRadius: 12, background: C.surface, boxShadow: C.shadowCard,
    },
  }, [
    indicator ? h('span', {
      key: '__indicator',
      'aria-hidden': 'true',
      className: 'rk-seg-indicator',
      'data-instant': indicator.instant ? 'true' : undefined,
      style: { width: indicator.w, height: indicator.h, transform: `translate3d(${indicator.x}px, ${indicator.y}px, 0)` },
    }) : null,
    ...options.map(option => {
      const active = option.value === value
      return h('button', {
        key: option.value,
        type: 'button',
        role: 'tab',
        'aria-selected': active,
        onClick: () => onChange(option.value),
        className: 'rk-btn',
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '8px 13px', border: 0, borderRadius: 8,
          background: active && !indicator ? C.tealTintDeep : 'transparent',
          color: active ? C.teal : C.muted,
          cursor: 'pointer', fontSize: 13, fontWeight: active ? 750 : 600, ...FONT,
        },
      }, option.label)
    }),
  ])
}

export function Field({ label, hint, error, required, children, style }) {
  return h('label', { style: { display: 'grid', gap: 6, ...style } }, [
    h('span', {
      key: 'l',
      style: { fontSize: 12, fontWeight: 700, color: error ? C.red : C.ink },
    }, [label, required ? h('span', { key: 'r', style: { color: C.red, marginLeft: 4 } }, '必填') : null]),
    children,
    error ? h('span', { key: 'e', style: { fontSize: 12, color: C.red } }, error)
      : hint ? h('span', { key: 'h', style: { fontSize: 12, color: C.muted } }, hint) : null,
  ])
}

const CONTROL_BASE = {
  width: '100%', boxSizing: 'border-box', padding: '10px 11px',
  border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 13,
  background: C.surface, color: C.ink, ...FONT,
}

export function Input({ value, onChange, placeholder, ariaLabel, invalid, type = 'text', className, style, ...rest }) {
  return h('input', {
    type,
    value,
    onChange: event => onChange(event.target.value),
    placeholder,
    'aria-label': ariaLabel,
    'aria-invalid': invalid || undefined,
    className: className ? `rk-control ${className}` : 'rk-control',
    style: { ...CONTROL_BASE, ...(invalid ? { borderColor: C.red } : {}), ...style },
    ...rest,
  })
}

export function Textarea({ value, onChange, placeholder, rows = 3, ariaLabel, mono = false, className, style, ...rest }) {
  return h('textarea', {
    value,
    onChange: event => onChange(event.target.value),
    placeholder,
    rows,
    'aria-label': ariaLabel,
    className: className ? `rk-control ${className}` : 'rk-control',
    style: { ...CONTROL_BASE, lineHeight: 1.55, resize: 'vertical', ...(mono ? { fontFamily: C.fontMono, fontSize: 12 } : {}), ...style },
    ...rest,
  })
}

export function Select({ value, onChange, options, ariaLabel, style, className, ...rest }) {
  return h('select', {
    value,
    onChange: event => onChange(event.target.value),
    'aria-label': ariaLabel,
    className: className ? `rk-control ${className}` : 'rk-control',
    style: { ...CONTROL_BASE, cursor: 'pointer', ...style },
    ...rest,
  }, options.map(option => h('option', { key: option.value, value: option.value }, option.label)))
}

export function Chip({ children, color = C.teal, onRemove, removeLabel }) {
  return h('span', {
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 6px 3px 9px', border: `1px solid ${color}33`, borderRadius: 999,
      background: `${color}15`, color, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
    },
  }, [
    children,
    onRemove ? h('button', {
      key: 'x',
      type: 'button',
      onClick: onRemove,
      'aria-label': removeLabel,
      className: 'rk-chip-x',
      style: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 3px', opacity: .7 },
    }, '×') : null,
  ])
}

export function Badge({ children, color = C.muted }) {
  return h('span', {
    style: {
      display: 'inline-block', padding: '2px 7px', borderRadius: 999,
      background: `${color}15`, color, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
    },
  }, children)
}

// 列表行：主体可点击，「行尾操作」用 trailing 传入（如收藏星标），
// 避免每个视图各自拼一套内联行样式。
export function ListRow({ active = false, onClick, trailing, children, style, ...rest }) {
  const main = onClick ? h('button', {
    key: 'main',
    type: 'button',
    onClick,
    'aria-pressed': active,
    style: {
      flex: 1, minWidth: 0, border: 0, background: 'transparent', color: C.ink,
      textAlign: 'left', padding: '13px 15px', cursor: 'pointer', ...FONT,
    },
  }, children) : h('div', { key: 'main', style: { flex: 1, minWidth: 0, padding: '13px 15px' } }, children)
  return h('div', {
    ...rest,
    className: 'rk-row',
    'data-clickable': onClick ? 'true' : undefined,
    style: {
      display: 'flex', alignItems: 'stretch', gap: 4,
      borderBottom: `1px solid ${C.divide}`,
      background: active ? C.tealTint : 'transparent',
      boxShadow: active ? `inset 3px 0 0 ${C.teal}` : undefined,
      ...style,
    },
  }, trailing
    ? [main, h('div', { key: 'trailing', style: { display: 'flex', alignItems: 'center', paddingRight: 10, flexShrink: 0 } }, trailing)]
    : main)
}

export function GroupLabel({ children, count }) {
  return h('div', {
    style: {
      padding: '10px 15px', background: C.canvas, color: C.muted,
      fontSize: 12, fontWeight: 750, borderBottom: `1px solid ${C.line}`,
    },
  }, [children, count !== undefined ? `　${count}` : null])
}

export function EmptyState({ icon = 'search', text, hint, action, style }) {
  return h('div', {
    className: 'rk-fade',
    style: {
      display: 'grid', gap: 8, justifyItems: 'center', textAlign: 'center',
      padding: '30px 18px', background: C.surfaceAlt, color: C.muted,
      fontSize: 13, lineHeight: 1.6, ...FONT, ...style,
    },
  }, [
    h('span', { key: 'i', style: { color: C.tealLineStrong } }, h(Icon, { name: icon, size: 22 })),
    h('p', { key: 't', style: { margin: 0 } }, text),
    hint ? h('p', { key: 'h', style: { margin: 0, fontSize: 12, color: C.muted, opacity: .85 } }, hint) : null,
    action ? h('div', { key: 'a', style: { marginTop: 4 } }, action) : null,
  ])
}

const NOTICE_TONES = {
  info: { color: C.teal, background: C.tealTint, line: C.tealLine },
  warn: { color: C.amber, background: C.amberTint, line: C.amberLine },
  error: { color: C.red, background: C.redTint, line: C.red },
}

export function Notice({ tone = 'info', icon, children, style }) {
  const palette = NOTICE_TONES[tone] || NOTICE_TONES.info
  return h('p', {
    role: 'status',
    className: tone === 'error' ? 'rk-shake' : 'rk-reveal',
    style: {
      display: 'flex', gap: 8, alignItems: 'flex-start', margin: 0,
      padding: '10px 13px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
      color: palette.color, background: palette.background, border: `1px solid ${palette.line}`, ...FONT, ...style,
    },
  }, [icon ? h(Icon, { key: 'i', name: icon, size: 14, style: { marginTop: 2 } }) : null, h('span', { key: 'c' }, children)])
}

export function Modal({ title, subtitle, onClose, footer, children, width = 660, labelledBy }) {
  const [leaving, setLeaving] = React.useState(false)
  const dialogRef = React.useRef(null)
  const closeTimerRef = React.useRef(null)
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose
  const requestClose = React.useCallback(() => {
    if (closeTimerRef.current !== null) return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (reduce || typeof window === 'undefined') {
      onCloseRef.current?.()
      return
    }
    setLeaving(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      onCloseRef.current?.()
    }, 145)
  }, [])
  React.useEffect(() => {
    const prev = typeof document !== 'undefined' ? document.activeElement : null
    dialogRef.current?.focus?.({ preventScroll: true })
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        requestClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      if (prev && typeof prev.focus === 'function' && prev.isConnected) prev.focus({ preventScroll: true })
    }
  }, [requestClose])
  // 弹层是 position: fixed 的全屏遮罩：必须 portal 到 body。DSH 0.2.2-rc.1 起 composer seat
  // 有 will-change: transform，会成为 fixed 后代的 containing block；composer 槽里的选择器弹窗
  // 若留在原位会被裁成输入卡片大小（见 src/lib/overlay-anchor.js 的 bodyPortal）。
  return bodyPortal(h('div', {
    role: 'presentation',
    className: leaving ? 'rk-backdrop-leave rk-modal-backdrop' : 'rk-backdrop rk-modal-backdrop',
    onMouseDown: requestClose,
    style: {
      position: 'fixed', inset: 0, zIndex: 20020, display: 'grid', placeItems: 'center',
      padding: 20, background: 'rgba(15, 23, 42, .42)',
    },
  }, h('section', {
    ref: dialogRef,
    tabIndex: -1,
    role: 'dialog',
    'aria-modal': true,
    'aria-label': labelledBy ? undefined : title,
    'aria-labelledby': labelledBy,
    className: leaving ? 'rk-pop-leave' : 'rk-pop',
    onMouseDown: event => event.stopPropagation(),
    style: {
      width: `min(${width}px, 100%)`, maxHeight: 'min(760px, calc(100vh - 40px))',
      overflow: 'auto', padding: 24, borderRadius: 16, outline: 'none',
      background: C.surface, color: C.ink, boxShadow: C.shadowLg, ...FONT,
    },
  }, [
    h('div', { key: 'head', style: { display: 'flex', gap: 16, justifyContent: 'space-between', alignItems: 'start' } }, [
      h('div', { key: 'text', style: { minWidth: 0 } }, [
        h('h2', { key: 't', style: { margin: 0, fontSize: 23, letterSpacing: '-.02em', fontWeight: 700 } }, title),
        subtitle ? h('p', { key: 's', style: { margin: '6px 0 0', color: C.muted, fontSize: 13, lineHeight: 1.55 } }, subtitle) : null,
      ]),
      h(IconButton, { key: 'x', name: 'close', size: 18, label: '关闭', disabled: leaving, onClick: requestClose }),
    ]),
    h('div', { key: 'body', style: { display: 'grid', gap: 15, marginTop: 20 } }, children),
    footer ? h('div', {
      key: 'foot',
      style: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22, alignItems: 'center', flexWrap: 'wrap' },
    }, footer) : null,
  ])))
}

export function Page({ children, style }) {
  return h('main', {
    className: 'rk-page',
    style: { minHeight: '100vh', boxSizing: 'border-box', padding: '30px var(--rk-gutter) 48px', background: C.canvas, color: C.ink, ...FONT, ...style },
  }, children)
}

export function PageHead({ kicker, title, lead, actions }) {
  return h('header', { style: { display: 'flex', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' } }, [
    h('div', { key: 'text', style: { minWidth: 0 } }, [
      kicker ? h('p', { key: 'k', style: { margin: 0, color: C.teal, fontSize: 12, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase' } }, kicker) : null,
      h('h1', { key: 't', style: { margin: kicker ? '8px 0 0' : 0, fontSize: 27, letterSpacing: '-.035em', fontWeight: 760, lineHeight: 1.2 } }, title),
      lead ? h('p', { key: 'l', style: { margin: '8px 0 0', color: C.muted, fontSize: 14, lineHeight: 1.55 } }, lead) : null,
    ]),
    // actions 容器必须允许收缩到视口宽（maxWidth），否则窄屏下整体被撑宽、
    // 内部的 flexWrap 永远不触发——390px 实测曾把 8 个按钮铺到 968px。
    actions ? h('div', { key: 'a', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 1, flexBasis: 'auto', maxWidth: '100%', minWidth: 0, justifyContent: 'flex-end' } }, actions) : null,
  ])
}

// sticky：把检索/筛选行吸在统一容器的分区导航之下（二级吸顶）。
// 吸顶偏移量取容器实测写入的 --rk-console-nav-h，不写死像素。
// 吸顶态下外边距交由 .rk-sticky-toolbar 的内边距承接：外边距区域不参与背景绘制，
// 直接吸顶会让滚动内容从边距缝隙里透出来。
export function Toolbar({ children, style, sticky = false, innerRef }) {
  // innerRef：供分区实测二级吸顶带高度（左列 sticky 的偏移量来源），不参与样式。
  return h('div', {
    ref: innerRef,
    className: sticky ? 'rk-sticky-toolbar' : undefined,
    style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: sticky ? 0 : '18px 0 14px', ...style },
  }, children)
}

export function ToastHost() {
  const [rendered, setRendered] = React.useState(() => getToasts().map(item => ({ ...item, leaving: false })))
  const exitTimers = React.useRef(new Map())
  React.useEffect(() => {
    const sync = next => {
      const nextIds = new Set(next.map(item => item.id))
      const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      setRendered(current => {
        const staying = []
        for (const row of current) {
          if (nextIds.has(row.id)) continue
          if (reduce) continue
          if (!row.leaving) {
            const id = row.id
            const timer = setTimeout(() => {
              exitTimers.current.delete(id)
              setRendered(list => list.filter(entry => entry.id !== id))
            }, 155)
            exitTimers.current.set(id, timer)
          }
          staying.push({ ...row, leaving: true })
        }
        for (const item of next) {
          const existingTimer = exitTimers.current.get(item.id)
          if (existingTimer) { clearTimeout(existingTimer); exitTimers.current.delete(item.id) }
          staying.push({ ...item, leaving: false })
        }
        return staying
      })
    }
    const unsub = subscribeToasts(sync)
    return () => {
      unsub()
      for (const timer of exitTimers.current.values()) clearTimeout(timer)
      exitTimers.current.clear()
    }
  }, [])
  if (typeof document === 'undefined' || !rendered.length) return null
  return bodyPortal(h('div', {
    className: 'rk-toast-stack',
    role: 'region',
    'aria-label': '操作反馈',
    'aria-live': 'polite',
  }, rendered.map(item => {
    const palette = NOTICE_TONES[item.tone] || NOTICE_TONES.info
    const iconName = item.tone === 'error' || item.tone === 'warn' ? 'shield' : 'check'
    return h('div', {
      key: item.id,
      role: item.leaving ? undefined : 'status',
      'aria-hidden': item.leaving || undefined,
      className: item.leaving ? 'rk-toast rk-toast-leave' : 'rk-pop rk-toast',
      style: {
        borderColor: palette.line,
        background: C.surface,
        color: C.ink,
      },
    }, [
      h('span', { key: 'icon', className: iconName === 'check' ? 'rk-check-pop' : undefined, style: { color: palette.color, display: 'inline-flex', flexShrink: 0 } }, h(Icon, { name: iconName, size: 14 })),
      h('span', { key: 'msg', style: { flex: 1, minWidth: 0, lineHeight: 1.45 } }, item.message),
      item.onAction && item.actionLabel ? h(Button, {
        key: 'action', size: 'sm', variant: 'soft', disabled: item.leaving,
        onClick: () => {
          if (!dismissToast(item.id)) return
          try { item.onAction() } catch { /* 撤销异常不阻塞关闭 */ }
        },
      }, item.actionLabel) : null,
      h(IconButton, {
        key: 'close', name: 'close', size: 13, label: '关闭提示', disabled: item.leaving,
        onClick: () => dismissToast(item.id),
        style: { width: 22, height: 22, border: 0, background: 'transparent' },
      }),
    ])
  })))
}

export { C, Icon }
