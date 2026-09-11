import { h, C } from './theme.js'
import { Icon } from './lib/icons.js'

// 统一基础组件层。所有科研视图（工作台 / 资源选择器 / 研究资产库 / 数据库面板 / 输入框入口）
// 只从这里取组件，保证与 dsh-promptkit「研究方法工厂对话增强器」的视觉与交互一致：
// 同一套 teal 主色、12px 卡片圆角 / 8px 控件圆角、13px 正文、统一阴影刻度与悬浮反馈。
// 组件只负责外观与无障碍属性，不持有任何业务逻辑。

const FONT = { fontFamily: C.font }

export function Spinner({ text, size = 12 }) {
  return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, color: C.muted, fontSize: 13, lineHeight: 1.5 } }, [
    h('span', {
      key: 'dot',
      'aria-hidden': 'true',
      style: {
        display: 'inline-block', width: size, height: size, borderRadius: '50%',
        border: `2px solid ${C.tealLine}`, borderTopColor: C.teal,
        animation: 'rk-spin .7s linear infinite',
      },
    }),
    text,
  ])
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

export function Button({ variant = 'soft', size = 'md', icon, disabled = false, onClick, type = 'button', title, style, children, ...rest }) {
  const base = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.soft
  // 次要按钮本就比主按钮矮一档，避免「写入 / 发送 / 复制」三个出口等高时主次不分。
  const sizing = size === 'sm' ? (variant === 'primary' ? BUTTON_SIZES.smSoft : BUTTON_SIZES.sm) : BUTTON_SIZES.md
  return h('button', {
    type,
    onClick,
    disabled,
    title,
    className: 'rk-btn',
    ...rest,
    style: {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
      fontWeight: 600, ...FONT, ...sizing, ...base, ...style,
    },
  }, [icon ? h(Icon, { key: 'i', name: icon, size: 13 }) : null, children])
}

export function IconButton({ name, size = 15, onClick, label, active = false, disabled = false, style }) {
  return h('button', {
    type: 'button',
    onClick,
    disabled,
    title: label,
    'aria-label': label,
    'aria-pressed': active,
    className: 'rk-btn',
    style: {
      width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: `1px solid ${active ? C.tealLineStrong : C.line}`, borderRadius: '50%',
      background: active ? C.tealTint : C.surfaceAlt, color: active ? C.teal : C.muted,
      cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0, ...style,
    },
  }, h(Icon, { name, size }))
}

export function StarButton({ active, onClick, label }) {
  return h('button', {
    type: 'button',
    onClick,
    title: label,
    'aria-label': label,
    'aria-pressed': active,
    className: 'rk-btn',
    style: {
      width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: `1px solid ${active ? C.amberLine : C.line}`, borderRadius: '50%',
      background: active ? C.amberTint : C.surfaceAlt, color: active ? C.amber : C.muted,
      cursor: 'pointer', flexShrink: 0,
    },
  }, h(Icon, { name: 'star', size: 14, style: active ? { fill: 'currentColor' } : undefined }))
}

export function Card({ as = 'div', interactive = false, style, children, ...rest }) {
  return h(as, {
    ...rest,
    className: interactive ? 'rk-card' : undefined,
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
  return h('div', {
    role: 'tablist',
    'aria-label': ariaLabel,
    style: {
      display: 'inline-flex', gap: 3, padding: 4, flexWrap: 'wrap',
      border: `1px solid ${C.line}`, borderRadius: 12, background: C.surface, boxShadow: C.shadowCard,
    },
  }, options.map(option => {
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
        background: active ? C.tealTintDeep : 'transparent',
        color: active ? C.teal : C.muted,
        cursor: 'pointer', fontSize: 13, fontWeight: active ? 750 : 600, ...FONT,
      },
    }, option.label)
  }))
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

export function Input({ value, onChange, placeholder, ariaLabel, invalid, type = 'text', style, ...rest }) {
  return h('input', {
    type,
    value,
    onChange: event => onChange(event.target.value),
    placeholder,
    'aria-label': ariaLabel,
    'aria-invalid': invalid || undefined,
    style: { ...CONTROL_BASE, ...(invalid ? { borderColor: C.red } : {}), ...style },
    ...rest,
  })
}

export function Textarea({ value, onChange, placeholder, rows = 3, ariaLabel, mono = false, style, ...rest }) {
  return h('textarea', {
    value,
    onChange: event => onChange(event.target.value),
    placeholder,
    rows,
    'aria-label': ariaLabel,
    style: { ...CONTROL_BASE, lineHeight: 1.55, resize: 'vertical', ...(mono ? { fontFamily: C.fontMono, fontSize: 12 } : {}), ...style },
    ...rest,
  })
}

export function Select({ value, onChange, options, ariaLabel, style }) {
  return h('select', {
    value,
    onChange: event => onChange(event.target.value),
    'aria-label': ariaLabel,
    style: { ...CONTROL_BASE, cursor: 'pointer', ...style },
  }, options.map(option => h('option', { key: option.value, value: option.value }, option.label)))
}

export function Chip({ children, color = C.teal, onRemove, removeLabel }) {
  return h('span', {
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 6px 3px 9px', border: `1px solid ${color}33`, borderRadius: 999,
      background: `${color}15`, color, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
    },
  }, [
    children,
    onRemove ? h('button', {
      key: 'x',
      type: 'button',
      onClick: onRemove,
      'aria-label': removeLabel,
      style: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 3px', opacity: .7 },
    }, '×') : null,
  ])
}

export function Badge({ children, color = C.muted }) {
  return h('span', {
    style: {
      display: 'inline-block', padding: '2px 7px', borderRadius: 999,
      background: `${color}15`, color, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
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

export function EmptyState({ icon = 'search', text, hint, style }) {
  return h('div', {
    style: {
      display: 'grid', gap: 8, justifyItems: 'center', textAlign: 'center',
      padding: '30px 18px', background: C.surfaceAlt, color: C.muted,
      fontSize: 13, lineHeight: 1.6, ...FONT, ...style,
    },
  }, [
    h('span', { key: 'i', style: { color: C.tealLineStrong } }, h(Icon, { name: icon, size: 22 })),
    h('p', { key: 't', style: { margin: 0 } }, text),
    hint ? h('p', { key: 'h', style: { margin: 0, fontSize: 12, color: C.muted, opacity: .85 } }, hint) : null,
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
    className: 'rk-fade',
    style: {
      display: 'flex', gap: 8, alignItems: 'flex-start', margin: 0,
      padding: '10px 13px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
      color: palette.color, background: palette.background, border: `1px solid ${palette.line}`, ...FONT, ...style,
    },
  }, [icon ? h(Icon, { key: 'i', name: icon, size: 14, style: { marginTop: 2 } }) : null, h('span', { key: 'c' }, children)])
}

export function Modal({ title, subtitle, onClose, footer, children, width = 660, labelledBy }) {
  return h('div', {
    role: 'presentation',
    onMouseDown: onClose,
    style: {
      position: 'fixed', inset: 0, zIndex: 20020, display: 'grid', placeItems: 'center',
      padding: 20, background: 'rgba(15, 23, 42, .42)',
    },
  }, h('section', {
    role: 'dialog',
    'aria-modal': true,
    'aria-label': labelledBy ? undefined : title,
    'aria-labelledby': labelledBy,
    className: 'rk-pop',
    onMouseDown: event => event.stopPropagation(),
    style: {
      width: `min(${width}px, 100%)`, maxHeight: 'min(760px, calc(100vh - 40px))',
      overflow: 'auto', padding: 24, borderRadius: 16,
      background: C.surface, color: C.ink, boxShadow: C.shadowLg, ...FONT,
    },
  }, [
    h('div', { key: 'head', style: { display: 'flex', gap: 16, justifyContent: 'space-between', alignItems: 'start' } }, [
      h('div', { key: 'text', style: { minWidth: 0 } }, [
        h('h2', { key: 't', style: { margin: 0, fontSize: 23, letterSpacing: '-.02em', fontWeight: 700 } }, title),
        subtitle ? h('p', { key: 's', style: { margin: '6px 0 0', color: C.muted, fontSize: 13, lineHeight: 1.55 } }, subtitle) : null,
      ]),
      h(IconButton, { key: 'x', name: 'close', size: 18, label: '关闭', onClick: onClose }),
    ]),
    h('div', { key: 'body', style: { display: 'grid', gap: 15, marginTop: 20 } }, children),
    footer ? h('div', {
      key: 'foot',
      style: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22, alignItems: 'center', flexWrap: 'wrap' },
    }, footer) : null,
  ]))
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
    actions ? h('div', { key: 'a', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 } }, actions) : null,
  ])
}

// sticky：把检索/筛选行吸在统一容器的分区导航之下（二级吸顶）。
// 吸顶偏移量取容器实测写入的 --rk-console-nav-h，不写死像素。
// 吸顶态下外边距交由 .rk-sticky-toolbar 的内边距承接：外边距区域不参与背景绘制，
// 直接吸顶会让滚动内容从边距缝隙里透出来。
export function Toolbar({ children, style, sticky = false }) {
  return h('div', {
    className: sticky ? 'rk-sticky-toolbar' : undefined,
    style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: sticky ? 0 : '18px 0 14px', ...style },
  }, children)
}

export { C, Icon }
