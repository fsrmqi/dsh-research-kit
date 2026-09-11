import { h } from '../theme.js'
// 图标 path 与 dsh-promptkit「研究方法工厂对话增强器」同源（ICON_PATHS 逐项复刻），
// 保证两处图标形状、线宽与视觉重量完全一致；不引入图标库。
const ICON_PATHS = {
  sparkles: 'M12 3.2l1.7 4.1 4.1 1.7-4.1 1.7L12 14.8l-1.7-4.1-4.1-1.7 4.1-1.7L12 3.2zM18.8 13.5l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9.9-2.2z',
  sparkle: 'M12 3.2l1.7 4.1 4.1 1.7-4.1 1.7L12 14.8l-1.7-4.1-4.1-1.7 4.1-1.7L12 3.2z',
  wand: 'M14.5 5.5 18.5 9.5M4 20 13.5 10.5M13.5 10.5l1.5-1.5a2.12 2.12 0 0 1 3 3L16.5 13.5',
  close: 'M6 6l12 12M18 6 6 18',
  star: 'M12 3.2l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3.2z',
  check: 'M4.5 12.5l5 5L19.5 7',
  send: 'M4 12 20 4l-6 16-3-6-7-2z',
  copy: 'M9 9h10v10H9zM5 15V5h10v2',
  history: 'M12 7v5l3 2M21 12a9 9 0 1 1-2.6-6.4M21 4v4h-4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.6-3.6',
  edit: 'M4 20h4L18.5 9.5l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  refresh: 'M20 11a8 8 0 1 0-1.8 5M20 5v6h-6',
  document: 'M6 3h8l4 4v14H6zM14 3v4h4',
  chevronDown: 'M6 9l6 6 6-6',
  link: 'M9 15l6-6M10.5 6.5l1-1a4 4 0 0 1 5.6 5.6l-1 1M13.5 17.5l-1 1a4 4 0 0 1-5.6-5.6l1-1',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  file: 'M14 3v5h5M6 3h8l5 5v13H6zM8 13h8M8 17h5',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  variable: 'M8 4C5 8 5 16 8 20M16 4c3 4 3 12 0 16M9.5 9.5 12 12l-2.5 2.5M14.5 9.5 12 12l2.5 2.5',
  shield: 'M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6l8-3zM9 12l2 2 4-4',
  gauge: 'M12 13l4-4M4.5 19a9 9 0 1 1 15 0M12 21h.01',
  layers: 'M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  database: 'M12 3c4.4 0 8 1.1 8 2.5S16.4 8 12 8 4 6.9 4 5.5 7.6 3 12 3zM4 5.5v13C4 19.9 7.6 21 12 21s8-1.1 8-2.5v-13M20 12c0 1.4-3.6 2.5-8 2.5S4 13.4 4 12',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 13l5-5 5 5M5 4h14',
  filter: 'M4 5h16M7 12h10M10 19h4',
  bookmark: 'M6 4h12v17l-6-4-6 4V4z',
  branch: 'M6 4v10a3 3 0 0 0 3 3h6M6 4a2 2 0 1 0 0-.001M18 8a2 2 0 1 0 0-.001M18 17a2 2 0 1 0 0-.001',
}

const Icon = ({ name, size = 14, style, strokeWidth = 1.7 }) =>
  h('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    style: { flexShrink: 0, ...style },
  }, ICON_PATHS[name] ? h('path', { key: name, d: ICON_PATHS[name] }) : null)

export { Icon, ICON_PATHS }
