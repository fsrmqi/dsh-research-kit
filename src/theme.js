import React from 'react'

const h = React.createElement

// 视觉系统单一真源。色值与 dsh-promptkit「研究方法工厂对话增强器」（--pk-*）逐项对齐，
// 仅变量名前缀改为 --rk，避免与宿主或其他插件冲突；改这里即可整体换肤。
//
// 对齐要点：teal #0f766e 主色、#0b5f58 主按钮底、12px 卡片圆角、8px 控件圆角、
// 13px 正文字号、14px 面板标题、27px 页面标题、统一的三级阴影刻度。
const GLOBAL_CSS = `
:root {
  --rk-ink: #17212b; --rk-muted: #607080; --rk-slate: #52606d;
  --rk-line: #d8e1e8; --rk-line-strong: #b6c6d1; --rk-divide: #edf1f4;
  --rk-canvas: #f4f7f9; --rk-surface: #fff; --rk-surface-alt: #fcfdff; --rk-track: #e8eef2;
  --rk-teal: #0f766e; --rk-teal-strong: #0b5f58;
  --rk-teal-line: #cce8e2; --rk-teal-line-strong: #8acbbd; --rk-teal-line-active: #67b9aa;
  --rk-teal-tint: #f1faf8; --rk-teal-tint-deep: #effaf7;
  --rk-on-ink: #ffffff;
  --rk-blue: #2563eb; --rk-amber: #b45309; --rk-amber-line: #f1d4a5; --rk-amber-tint: #fff7ed;
  --rk-red: #b91c1c; --rk-red-tint: #fdecec;
  --rk-status-verified: #15803d; --rk-status-inferred: #2563eb; --rk-status-toverify: #b45309;
  --rk-status-preference: #7c3aed; --rk-status-refuted: #b91c1c;
  --rk-shadow-card: 0 1px 2px rgba(17,38,60,.04),0 8px 22px rgba(17,38,60,.035);
  --rk-shadow-panel: 0 1px 2px rgba(17,38,60,.04),0 10px 24px rgba(17,38,60,.025);
  --rk-shadow-fab: 0 4px 14px rgba(17,38,60,.18);
  --rk-shadow-lg: 0 20px 50px rgba(17,38,60,.20);
  --rk-font: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --rk-font-mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, "Liberation Mono", monospace;
}
/* ── 暗色调色板：唯一定义处（单一真源）。系统暗色与 DSH 暗色两路触发都引用这里的 --rk-d-*。 ── */
:root {
  --rk-d-ink: #e8eaed; --rk-d-muted: #9aa0a6; --rk-d-slate: #8a9199;
  --rk-d-line: #3c4043; --rk-d-line-strong: #4a4f59; --rk-d-divide: #2d3139;
  --rk-d-canvas: #181a20; --rk-d-surface: #242830; --rk-d-surface-alt: #1e2127; --rk-d-track: #2d3139;
  --rk-d-teal: #3dbdb4; --rk-d-teal-strong: #2a9d94;
  --rk-d-teal-line: #1a3d38; --rk-d-teal-line-strong: #2a6a60; --rk-d-teal-line-active: #3a9a8a;
  --rk-d-teal-tint: #1a2e2c; --rk-d-teal-tint-deep: #162a28;
  --rk-d-on-ink: #f4f7f9;
  --rk-d-blue: #5c9dff; --rk-d-amber: #f0a040; --rk-d-amber-line: #5a3a10; --rk-d-amber-tint: #2a1f10;
  --rk-d-red: #ff6b6b; --rk-d-red-tint: #3a1a1a;
  --rk-d-status-verified: #34d399; --rk-d-status-inferred: #5c9dff; --rk-d-status-toverify: #f0a040;
  --rk-d-status-preference: #b794f6; --rk-d-status-refuted: #ff6b6b;
  --rk-d-shadow-card: 0 1px 2px rgba(0,0,0,.35),0 8px 22px rgba(0,0,0,.30);
  --rk-d-shadow-panel: 0 1px 2px rgba(0,0,0,.30),0 10px 24px rgba(0,0,0,.22);
  --rk-d-shadow-fab: 0 4px 14px rgba(0,0,0,.50),0 0 0 1px rgba(0,0,0,.30);
  --rk-d-shadow-lg: 0 20px 50px rgba(0,0,0,.55);
}
@media (prefers-color-scheme: dark) {
  :root {
    --rk-ink: var(--rk-d-ink); --rk-muted: var(--rk-d-muted); --rk-slate: var(--rk-d-slate);
    --rk-line: var(--rk-d-line); --rk-line-strong: var(--rk-d-line-strong); --rk-divide: var(--rk-d-divide);
    --rk-canvas: var(--rk-d-canvas); --rk-surface: var(--rk-d-surface); --rk-surface-alt: var(--rk-d-surface-alt); --rk-track: var(--rk-d-track);
    --rk-teal: var(--rk-d-teal); --rk-teal-strong: var(--rk-d-teal-strong);
    --rk-teal-line: var(--rk-d-teal-line); --rk-teal-line-strong: var(--rk-d-teal-line-strong); --rk-teal-line-active: var(--rk-d-teal-line-active);
    --rk-teal-tint: var(--rk-d-teal-tint); --rk-teal-tint-deep: var(--rk-d-teal-tint-deep);
    --rk-on-ink: var(--rk-d-on-ink);
    --rk-blue: var(--rk-d-blue); --rk-amber: var(--rk-d-amber); --rk-amber-line: var(--rk-d-amber-line); --rk-amber-tint: var(--rk-d-amber-tint);
    --rk-red: var(--rk-d-red); --rk-red-tint: var(--rk-d-red-tint);
    --rk-status-verified: var(--rk-d-status-verified); --rk-status-inferred: var(--rk-d-status-inferred); --rk-status-toverify: var(--rk-d-status-toverify);
    --rk-status-preference: var(--rk-d-status-preference); --rk-status-refuted: var(--rk-d-status-refuted);
    --rk-shadow-card: var(--rk-d-shadow-card); --rk-shadow-panel: var(--rk-d-shadow-panel); --rk-shadow-fab: var(--rk-d-shadow-fab); --rk-shadow-lg: var(--rk-d-shadow-lg);
  }
}
body[data-ds-dark-theme] {
  --rk-ink: var(--rk-d-ink); --rk-muted: var(--rk-d-muted); --rk-slate: var(--rk-d-slate);
  --rk-line: var(--rk-d-line); --rk-line-strong: var(--rk-d-line-strong); --rk-divide: var(--rk-d-divide);
  --rk-canvas: var(--rk-d-canvas); --rk-surface: var(--rk-d-surface); --rk-surface-alt: var(--rk-d-surface-alt); --rk-track: var(--rk-d-track);
  --rk-teal: var(--rk-d-teal); --rk-teal-strong: var(--rk-d-teal-strong);
  --rk-teal-line: var(--rk-d-teal-line); --rk-teal-line-strong: var(--rk-d-teal-line-strong); --rk-teal-line-active: var(--rk-d-teal-line-active);
  --rk-teal-tint: var(--rk-d-teal-tint); --rk-teal-tint-deep: var(--rk-d-teal-tint-deep);
  --rk-on-ink: var(--rk-d-on-ink);
  --rk-blue: var(--rk-d-blue); --rk-amber: var(--rk-d-amber); --rk-amber-line: var(--rk-d-amber-line); --rk-amber-tint: var(--rk-d-amber-tint);
  --rk-red: var(--rk-d-red); --rk-red-tint: var(--rk-d-red-tint);
  --rk-status-verified: var(--rk-d-status-verified); --rk-status-inferred: var(--rk-d-status-inferred); --rk-status-toverify: var(--rk-d-status-toverify);
  --rk-status-preference: var(--rk-d-status-preference); --rk-status-refuted: var(--rk-d-status-refuted);
  --rk-shadow-card: var(--rk-d-shadow-card); --rk-shadow-panel: var(--rk-d-shadow-panel); --rk-shadow-fab: var(--rk-d-shadow-fab); --rk-shadow-lg: var(--rk-d-shadow-lg);
}
/* ── 布局令牌：统一容器内四个分区共用的水平内边距（流式，随窗口宽度自适应）。 ──
   上限 34px 与既有视觉一致（视口 ≥1133px 时 3vw 恰好达到上限），窄窗口线性收缩至下限 16px；
   880px 以下由媒体查询直接锁定 16px，避免四个分区各自硬编码 34px 后在窄窗口挤占内容。 */
:root { --rk-gutter: clamp(16px, 3vw, 34px) }
/* ── 方法工坊分区：解绑 vendored PromptStudio 的阅读宽度上限。 ──
   该组件根 <main> 内联了 width: min(1240px, max(100%, calc(100vw - 280px))) 与 margin: 0 auto，
   这是「独立插件页 + 为宿主侧栏预留 280px」场景的写法。嵌入统一容器后，父容器已经是
   扣除侧栏后的可视区，再叠一次 1240px 上限就会让本分区收成居中窄栏，
   与铺满的「资源与工作流 / 研究资产库」两个分区视觉不一致。
   vendor 是 SHA 锁定的参考实现不可改，故在此以 !important 覆盖内联宽度（内联声明非
   !important 时会被 author 级 !important 规则覆盖）：宽度交还给 100%（相对父容器，
   随窗口自适应，不再受 1240px 与 100vw-280px 约束），内边距改用与其他分区同一枚流式令牌。 */
.rk-studio-host { min-width: 0; display: block }
.rk-studio-host > main {
  width: 100% !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 20px var(--rk-gutter) 48px !important;
  background: transparent !important;
  /* overflow 必须解绑：S.page 里写了 overflow: auto（独立插件页时 main 就是滚动容器）。
     嵌入统一容器后真正的滚动容器是宿主 scrollBody，而这层 overflow:auto 会成为一个
     不再滚动的内层滚动盒，把 <main> 内所有 position: sticky 的参照系锁死在它自己身上
     ——实测方法工坊的筛选块因此 1:1 跟随滚动、吸顶完全失效（祖先链上 MAIN of=auto）。 */
  overflow: visible !important;
  min-height: 0 !important;
}
/* ── 二级吸顶带：各分区「随时要用的操作」（检索 / 筛选 / 模式 / 主操作）。 ──
   分层原则：吸顶只放「随时要用的操作」，不放「读一次就够的内容」。
   一级吸顶是统一容器的分区导航（.rk-console-nav），二级是各分区自己的操作行；
   分区标题与导语留在封面、随页面滚走——标题与导航里的当前分区标签重复，导语只读一次，
   吸住要多占约 87px 且放大重复感。四个分区一律按此分层，不再有「一个吸、其余不吸」。
   偏移量一律引用容器的实测高度 --rk-console-nav-h，不写死像素：导航高度会随窗口
   变窄换行而变化，写死必然错位。
   背景必须不透明，否则滚动内容会从吸顶带下方透出。 */
.rk-sticky-toolbar {
  position: sticky;
  top: var(--rk-console-nav-h, 0px);
  z-index: 15;
  background: var(--rk-canvas);
  padding: 18px 0 14px;
  margin: 0;
}
/* ── 方法工坊分区的二级吸顶带：vendored 组件的「搜索 + 分类」筛选块。 ──
   该组件把筛选块与整个方法列表放进同一列 <aside>，并给这一列写了 position: sticky;
   top: 14px。但左列是栅格中最高的项（实测 910px，高于视口），align-items: start 下
   它的包含块与自身等高、没有滑动余量，那条 sticky 是死代码——实测滚 700px 后左列
   top=-355（1:1 跟随滚走），检索框彻底消失。退一步说，即使它能生效，top: 14px 也会把
   检索框压到分区导航（149px 高、z-index 20）底下。
   修法：取消整列吸顶，只让筛选块吸顶，偏移量复用同一枚实测令牌。
   左列总高（910px）远大于视口，故筛选块在其整个范围内常驻，不会中途解除吸顶。 */
.rk-studio-host aside { position: static !important }
.rk-studio-host aside > div:first-child {
  position: sticky !important;
  top: var(--rk-console-nav-h, 0px) !important;
  z-index: 15;
  background: var(--rk-canvas) !important;
  padding: 18px 0 14px !important;
  margin-bottom: 0 !important;
}
/* 与增强器一致的交互反馈：按钮位移、卡片悬浮抬升、统一焦点环。 */
.rk-btn { transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease, background .15s ease, opacity .15s ease }
.rk-btn:hover:not(:disabled) { transform: translateY(-1px) }
.rk-btn:active:not(:disabled) { transform: translateY(0) scale(.98) }
.rk-btn:disabled { opacity: .5; cursor: not-allowed }
.rk-card { transition: transform .18s ease, box-shadow .18s ease }
.rk-card:hover { transform: translateY(-1px); box-shadow: var(--rk-shadow-card) }
.rk-row { transition: background .15s ease }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid rgba(15,118,110,.45); outline-offset: 2px }
@keyframes rk-spin { to { transform: rotate(360deg) } }
@keyframes rk-pop { from { opacity: 0; transform: translateY(6px) scale(.985) } to { opacity: 1; transform: none } }
@keyframes rk-fade { from { opacity: 0 } to { opacity: 1 } }
.rk-pop { animation: rk-pop .18s ease both }
.rk-fade { animation: rk-fade .16s ease both }
.rk-scroll::-webkit-scrollbar { width: 8px; height: 8px }
.rk-scroll::-webkit-scrollbar-thumb { background: #cdd8df; border-radius: 999px }
.rk-scroll::-webkit-scrollbar-track { background: transparent }
@media (prefers-reduced-motion: reduce) {
  .rk-btn, .rk-card, .rk-pop, .rk-fade { transition: none; animation: none }
}
/* 窄屏单列：两栏布局与表单网格统一塌陷，避免并排挤压。 */
@media (max-width: 880px) {
  /* 窄屏锁定内边距下限，四个分区同刻度收敛，左缘保持对齐。 */
  :root { --rk-gutter: 16px }
  .rk-layout, .rk-diff, .rk-meta, .rk-form-grid { grid-template-columns: minmax(0, 1fr) !important }
  .rk-page { padding: 20px var(--rk-gutter) 40px !important }
  /* 统一容器的分区导航条同样收敛内边距，保证与内容左缘对齐。 */
  .rk-console-nav { padding: 16px var(--rk-gutter) 12px !important }
  /* 方法工坊分区跟随同一内边距刻度，避免窄屏下比相邻分区更宽。 */
  .rk-studio-host > main { padding: 20px var(--rk-gutter) 40px !important }
  /* 方法工坊的吸顶筛选块同步收敛节奏。 */
  .rk-studio-host aside > div:first-child { padding: 14px 0 12px !important }
  /* 方法工坊的双栏栅格是 vendored 内联样式，同样在窄屏塌陷为单列，
     否则其他分区已单列、它仍并排挤压，四分区不一致。 */
  .rk-studio-host main > div { grid-template-columns: minmax(0, 1fr) !important }
}
`

const GlobalStyle = () => h('style', { key: 'rk-global-css', dangerouslySetInnerHTML: { __html: GLOBAL_CSS } })

// 组件样式全部走 CSS 变量；深浅主题切换只影响变量取值，不改动布局。
// accent 系列是 teal 的语义别名，供既有代码平滑过渡，新代码直接用 teal。
const C = {
  ink: 'var(--rk-ink)', muted: 'var(--rk-muted)', slate: 'var(--rk-slate)',
  line: 'var(--rk-line)', lineStrong: 'var(--rk-line-strong)', divide: 'var(--rk-divide)',
  canvas: 'var(--rk-canvas)', surface: 'var(--rk-surface)', surfaceAlt: 'var(--rk-surface-alt)', track: 'var(--rk-track)',
  teal: 'var(--rk-teal)', tealStrong: 'var(--rk-teal-strong)',
  tealLine: 'var(--rk-teal-line)', tealLineStrong: 'var(--rk-teal-line-strong)', tealLineActive: 'var(--rk-teal-line-active)',
  tealTint: 'var(--rk-teal-tint)', tealTintDeep: 'var(--rk-teal-tint-deep)',
  onInk: 'var(--rk-on-ink)',
  accent: 'var(--rk-teal)', accentTint: 'var(--rk-teal-tint)', accentLine: 'var(--rk-teal-line)',
  blue: 'var(--rk-blue)',
  amber: 'var(--rk-amber)', amberTint: 'var(--rk-amber-tint)', amberLine: 'var(--rk-amber-line)',
  red: 'var(--rk-red)', redTint: 'var(--rk-red-tint)',
  statusVerified: 'var(--rk-status-verified)', statusInferred: 'var(--rk-status-inferred)', statusToVerify: 'var(--rk-status-toverify)',
  statusPreference: 'var(--rk-status-preference)', statusRefuted: 'var(--rk-status-refuted)',
  shadowCard: 'var(--rk-shadow-card)', shadowPanel: 'var(--rk-shadow-panel)', shadowFab: 'var(--rk-shadow-fab)', shadowLg: 'var(--rk-shadow-lg)',
  font: 'var(--rk-font)', fontMono: 'var(--rk-font-mono)'
}

export { h, C, GlobalStyle }
