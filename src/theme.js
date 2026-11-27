import React from 'react'

const h = React.createElement

// 沿用 DSH 的语义色，旧客户端和独立预览使用内置蓝灰配色。
const GLOBAL_CSS = `
:root, body {
  --rk-ink: var(--dsw-alias-label-primary, #17212b); --rk-muted: var(--dsw-alias-label-secondary, #607080); --rk-slate: var(--dsw-alias-label-secondary, #52606d);
  --rk-line: var(--dsw-alias-border-l1, #d8e1e8); --rk-line-strong: var(--dsw-alias-border-l2, #b6c6d1); --rk-divide: var(--dsw-alias-border-l1, #edf1f4);
  --rk-canvas: var(--dsw-alias-bg-layer-1, #f4f7f9); --rk-surface: var(--dsw-alias-bg-base, #fff); --rk-surface-alt: var(--dsw-alias-bg-layer-1, #fcfdff); --rk-track: var(--dsw-alias-bg-layer-2, #e8eef2);
  --rk-teal: var(--dsw-alias-state-business-primary, #315fc4); --rk-teal-strong: var(--dsw-alias-button-info-fill, #2d58bc);
  --rk-teal-line: #d9e4fa; --rk-teal-line-strong: #a4bcef; --rk-teal-line-active: var(--dsw-alias-state-business-primary, #4774d6);
  --rk-teal-tint: #edf3ff; --rk-teal-tint-deep: #e5edfd;
  --rk-on-ink: var(--dsw-alias-label-on-color, #ffffff);
  --rk-blue: #2563eb; --rk-amber: #b45309; --rk-amber-line: #f1d4a5; --rk-amber-tint: #fff7ed;
  --rk-red: #b91c1c; --rk-red-tint: #fdecec;
  --rk-status-verified: #15803d; --rk-status-inferred: #2563eb; --rk-status-toverify: #b45309;
  --rk-status-preference: #7c3aed; --rk-status-refuted: #b91c1c;
  --rk-shadow-card: 0 1px 2px rgba(17,38,60,.04),0 8px 22px rgba(17,38,60,.035);
  --rk-shadow-panel: 0 1px 2px rgba(17,38,60,.04),0 10px 24px rgba(17,38,60,.025);
  --rk-shadow-fab: 0 4px 14px rgba(17,38,60,.18);
  --rk-shadow-lg: 0 20px 50px rgba(17,38,60,.20);
  --rk-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --rk-ease-spring: cubic-bezier(0.32, 1.28, 0.52, 1);
  --rk-ease-in: cubic-bezier(0.4, 0, 1, 1);
  --rk-dur-instant: 90ms;
  --rk-dur-fast: 140ms;
  --rk-dur-base: 210ms;
  --rk-dur-slow: 280ms;
  --rk-font: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --rk-font-mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, "Liberation Mono", monospace;
}
/* ── 暗色调色板：唯一定义处（单一真源）。系统暗色与 DSH 暗色两路触发都引用这里的 --rk-d-*。 ── */
:root {
  --rk-d-ink: #e8eaed; --rk-d-muted: #9aa0a6; --rk-d-slate: #8a9199;
  --rk-d-line: #3c4043; --rk-d-line-strong: #4a4f59; --rk-d-divide: #2d3139;
  --rk-d-canvas: #181a20; --rk-d-surface: #242830; --rk-d-surface-alt: #1e2127; --rk-d-track: #2d3139;
  --rk-d-teal: #8db6ff; --rk-d-teal-strong: #9cbfff;
  --rk-d-teal-line: #2a3b58; --rk-d-teal-line-strong: #425d86; --rk-d-teal-line-active: #8db6ff;
  --rk-d-teal-tint: #1d2b43; --rk-d-teal-tint-deep: #243652;
  --rk-d-on-ink: #131b2a;
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
  :root, body {
    --rk-ink: var(--dsw-alias-label-primary, var(--rk-d-ink)); --rk-muted: var(--dsw-alias-label-secondary, var(--rk-d-muted)); --rk-slate: var(--dsw-alias-label-secondary, var(--rk-d-slate));
    --rk-line: var(--dsw-alias-border-l1, var(--rk-d-line)); --rk-line-strong: var(--dsw-alias-border-l2, var(--rk-d-line-strong)); --rk-divide: var(--dsw-alias-border-l1, var(--rk-d-divide));
    --rk-canvas: var(--dsw-alias-bg-layer-1, var(--rk-d-canvas)); --rk-surface: var(--dsw-alias-bg-base, var(--rk-d-surface)); --rk-surface-alt: var(--dsw-alias-bg-layer-1, var(--rk-d-surface-alt)); --rk-track: var(--dsw-alias-bg-layer-2, var(--rk-d-track));
    --rk-teal: var(--dsw-alias-state-business-primary, var(--rk-d-teal)); --rk-teal-strong: var(--dsw-alias-button-info-fill, var(--rk-d-teal-strong));
    --rk-teal-line: var(--rk-d-teal-line); --rk-teal-line-strong: var(--rk-d-teal-line-strong); --rk-teal-line-active: var(--dsw-alias-state-business-primary, var(--rk-d-teal-line-active));
    --rk-teal-tint: var(--rk-d-teal-tint); --rk-teal-tint-deep: var(--rk-d-teal-tint-deep);
    --rk-on-ink: var(--dsw-alias-label-on-color, var(--rk-d-on-ink));
    --rk-blue: var(--rk-d-blue); --rk-amber: var(--rk-d-amber); --rk-amber-line: var(--rk-d-amber-line); --rk-amber-tint: var(--rk-d-amber-tint);
    --rk-red: var(--rk-d-red); --rk-red-tint: var(--rk-d-red-tint);
    --rk-status-verified: var(--rk-d-status-verified); --rk-status-inferred: var(--rk-d-status-inferred); --rk-status-toverify: var(--rk-d-status-toverify);
    --rk-status-preference: var(--rk-d-status-preference); --rk-status-refuted: var(--rk-d-status-refuted);
    --rk-shadow-card: var(--rk-d-shadow-card); --rk-shadow-panel: var(--rk-d-shadow-panel); --rk-shadow-fab: var(--rk-d-shadow-fab); --rk-shadow-lg: var(--rk-d-shadow-lg);
  }
}
body[data-ds-dark-theme] {
  --rk-ink: var(--dsw-alias-label-primary, var(--rk-d-ink)); --rk-muted: var(--dsw-alias-label-secondary, var(--rk-d-muted)); --rk-slate: var(--dsw-alias-label-secondary, var(--rk-d-slate));
  --rk-line: var(--dsw-alias-border-l1, var(--rk-d-line)); --rk-line-strong: var(--dsw-alias-border-l2, var(--rk-d-line-strong)); --rk-divide: var(--dsw-alias-border-l1, var(--rk-d-divide));
  --rk-canvas: var(--dsw-alias-bg-layer-1, var(--rk-d-canvas)); --rk-surface: var(--dsw-alias-bg-base, var(--rk-d-surface)); --rk-surface-alt: var(--dsw-alias-bg-layer-1, var(--rk-d-surface-alt)); --rk-track: var(--dsw-alias-bg-layer-2, var(--rk-d-track));
  --rk-teal: var(--dsw-alias-state-business-primary, var(--rk-d-teal)); --rk-teal-strong: var(--dsw-alias-button-info-fill, var(--rk-d-teal-strong));
  --rk-teal-line: var(--rk-d-teal-line); --rk-teal-line-strong: var(--rk-d-teal-line-strong); --rk-teal-line-active: var(--dsw-alias-state-business-primary, var(--rk-d-teal-line-active));
  --rk-teal-tint: var(--rk-d-teal-tint); --rk-teal-tint-deep: var(--rk-d-teal-tint-deep);
  --rk-on-ink: var(--dsw-alias-label-on-color, var(--rk-d-on-ink));
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
/* 方法库和手动整理面板共享宿主语义色。 */
.rk-studio-host, .rk-enhancer-theme {
  --pk-ink: var(--rk-ink); --pk-muted: var(--rk-muted); --pk-slate: var(--rk-slate);
  --pk-line: var(--rk-line); --pk-surface: var(--rk-surface); --pk-surface-alt: var(--rk-surface-alt);
  --pk-canvas: var(--rk-canvas); --pk-paper-warm: var(--rk-canvas);
  --pk-teal: var(--rk-teal); --pk-teal-strong: var(--rk-teal-strong);
  --pk-teal-line: var(--rk-teal-line); --pk-teal-line-strong: var(--rk-teal-line-strong);
  --pk-teal-line-active: var(--rk-teal-line-active); --pk-teal-tint: var(--rk-teal-tint);
  --pk-teal-tint-deep: var(--rk-teal-tint-deep); --pk-action-bg: var(--rk-teal-strong); --pk-action-fg: var(--rk-on-ink);
}
/* 内联增强器按输入卡片边界停靠，覆盖工件里以固定像素计算的垂直偏移。 */
.rk-enhancer-theme[data-inline-placement] section[role="dialog"][aria-label="对话增强器"] {
  top: var(--rk-enhancer-top) !important;
  bottom: var(--rk-enhancer-bottom) !important;
  max-height: var(--rk-enhancer-max-height) !important;
}
.rk-console-main, .rk-compose-actions, .rk-personal-head {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
}
.rk-console-main, .rk-personal-head { justify-content: space-between }
.rk-composer-picker {
  z-index: 20010;
  box-sizing: border-box;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--rk-line-strong) transparent;
  border: 1px solid var(--rk-line);
  border-radius: 12px;
  background: var(--rk-surface);
  color: var(--rk-ink);
  box-shadow: var(--rk-shadow-lg);
  font: 13px/1.4 var(--rk-font);
}
.rk-picker-header { position: sticky; top: 0; z-index: 1; background: var(--rk-surface); border-bottom: 1px solid var(--rk-line) }
.rk-composer-picker[data-short] .rk-picker-header { position: relative }
.rk-picker-top, .rk-picker-filters { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 8px 10px }
.rk-picker-top { padding-bottom: 0; flex-wrap: wrap }
.rk-picker-filters { padding-bottom: 8px }
.rk-picker-tabs, .rk-picker-actions { display: inline-flex; align-items: center; gap: 4px }
.rk-picker-tabs { padding: 2px; border: 1px solid var(--rk-line); border-radius: 8px; background: var(--rk-surface-alt) }
.rk-picker-actions { margin-inline-start: auto }
.rk-picker-tabs button, .rk-picker-text-action {
  min-height: 26px; padding: 3px 7px; border: 0; border-radius: 6px;
  background: transparent; color: var(--rk-muted); font: 600 12px/1.35 var(--rk-font);
  cursor: pointer; white-space: nowrap;
  transition: background var(--rk-dur-fast) var(--rk-ease-out), color var(--rk-dur-fast) var(--rk-ease-out), transform var(--rk-dur-instant) var(--rk-ease-out);
}
.rk-picker-tabs button:active, .rk-picker-text-action:active { transform: scale(.97) }
.rk-picker-tabs button[aria-selected="true"], .rk-picker-done { background: var(--rk-teal-tint-deep); color: var(--rk-teal) }
.rk-picker-tabs button:hover, .rk-picker-text-action:hover { background: var(--rk-teal-tint); color: var(--rk-teal) }
.rk-picker-organize { min-height: 32px; border: 1px solid var(--rk-line); color: var(--rk-ink); background: var(--rk-surface-alt) }
.rk-picker-switch {
  position: relative; display: inline-flex; align-items: center; gap: 6px; min-height: 28px;
  padding: 0 3px; color: var(--rk-ink); white-space: nowrap; cursor: pointer; font-size: 12px;
}
.rk-picker-switch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer }
.rk-picker-switch-track { width: 28px; height: 16px; padding: 2px; box-sizing: border-box; border-radius: 999px; background: var(--rk-track); box-shadow: inset 0 0 0 1px var(--rk-line-strong); transition: background var(--rk-dur-fast) var(--rk-ease-out), box-shadow var(--rk-dur-fast) var(--rk-ease-out) }
.rk-picker-switch-track::before { content: ''; width: 12px; height: 12px; display: block; border-radius: 50%; background: var(--rk-muted); transition: transform var(--rk-dur-base) var(--rk-ease-spring), background var(--rk-dur-fast) var(--rk-ease-out) }
.rk-picker-switch:active .rk-picker-switch-track::before { transform: scaleX(1.16) }
.rk-picker-switch input:checked + .rk-picker-switch-track { background: var(--rk-teal-strong); box-shadow: none }
.rk-picker-switch input:checked + .rk-picker-switch-track::before { transform: translateX(12px); background: var(--rk-on-ink) }
.rk-picker-switch:active input:checked + .rk-picker-switch-track::before { transform: translateX(10px) scaleX(1.16) }
.rk-picker-switch input:focus-visible + .rk-picker-switch-track { outline: 2px solid var(--rk-teal); outline-offset: 2px }
.rk-picker-search { position: relative; flex: 1; min-width: 0 }
.rk-picker-filter { flex: 0 1 132px; min-width: 0; max-width: 42%; text-overflow: ellipsis }
.rk-picker-results { display: grid; grid-template-columns: minmax(0, 1fr); gap: 5px; padding: 6px 10px 10px }
.rk-picker-row {
  width: 100%; min-width: 0; min-height: 45px; display: flex; align-items: center; gap: 8px; box-sizing: border-box;
  padding: 5px 9px; border: 1px solid var(--rk-line); border-radius: 8px; background: var(--rk-surface-alt);
  color: var(--rk-ink); font: inherit; text-align: left; cursor: pointer;
  transition: border-color var(--rk-dur-fast) var(--rk-ease-out), background var(--rk-dur-fast) var(--rk-ease-out), transform var(--rk-dur-instant) var(--rk-ease-out);
}
.rk-picker-row:hover, .rk-picker-row[data-selected] { border-color: var(--rk-teal-line-strong); background: var(--rk-teal-tint) }
.rk-picker-row:active { transform: scale(.99) }
.rk-picker-row:focus-visible { outline-offset: -2px }
.rk-picker-row input { flex: none; margin: 0; accent-color: var(--rk-teal) }
.rk-picker-row-text { flex: 1; min-width: 0 }
.rk-picker-row-text strong { display: block; font-weight: 650 }
.rk-picker-desc { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.rk-picker-desc, .rk-picker-meta, .rk-picker-selected, .rk-picker-empty { color: var(--rk-muted); font-size: 11px }
.rk-picker-meta { max-width: 28%; padding: 2px 6px; border-radius: 6px; background: var(--rk-surface); white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.rk-picker-row[data-material] .rk-picker-meta { background: var(--rk-teal-tint); color: var(--rk-teal) }
.rk-picker-selected { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; padding: 4px 8px }
.rk-picker-empty { margin: 0; padding: 10px 8px }
.rk-compose-suggestion > section {
  position: absolute; bottom: calc(100% + 8px); width: min(550px, 100%); left: 0; z-index: 20009;
  display: grid; gap: 8px; box-sizing: border-box; padding: 11px 14px;
  border: 1px solid var(--rk-teal-line); border-radius: 12px;
  background: var(--rk-surface); color: var(--rk-ink); box-shadow: var(--rk-shadow-panel);
  font: 13px/1.5 var(--rk-font);
  animation: rk-pop var(--rk-dur-base) var(--rk-ease-out) both;
}
.rk-compose-reason { color: var(--rk-muted); font-size: 12px; line-height: 1.5 }
.rk-personal-templates { display: grid; gap: 12px; padding: 24px var(--rk-gutter) 48px; color: var(--rk-ink) }
.rk-personal-head h2, .rk-personal-head p { margin: 0 }
.rk-personal-head p { color: var(--rk-muted); margin-top: 6px; font-size: 13px }
.rk-template-form { display: grid; gap: 10px }
.rk-research-home-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 12px }
.rk-research-home-grid > * { align-content: start }
.rk-home-page { box-sizing: border-box; padding: 14px var(--rk-gutter) 144px; display: grid; gap: 14px }
.rk-sidebar-main-shell { box-sizing: border-box; width: 100%; height: 100%; min-height: 0; overflow-y: auto; background: var(--rk-canvas) }
[data-platform="darwin"] .rk-sidebar-main-shell { padding-top: var(--dsh-frame-top-clearance, 0px) }
.rk-sidebar-main-shell .rk-home-page { padding-bottom: 48px }
.rk-sidebar-main-shell .rk-toast-stack { bottom: 28px }
.rk-home-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap }
.rk-home-launch-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px }
.rk-home-launch-card {
  display: grid; gap: 8px; padding: 15px 16px; border-radius: 12px;
  border: 1px solid var(--rk-line); background: var(--rk-surface); color: var(--rk-ink);
  text-align: left; cursor: pointer; font-family: var(--rk-font);
  transition: transform var(--rk-dur-fast) var(--rk-ease-out), border-color var(--rk-dur-fast) var(--rk-ease-out), box-shadow var(--rk-dur-base) var(--rk-ease-out), background var(--rk-dur-fast) var(--rk-ease-out);
}
.rk-home-launch-card:hover { transform: translateY(-2px); border-color: var(--rk-teal-line-strong); box-shadow: var(--rk-shadow-card) }
.rk-home-launch-card:active { transform: translateY(0) scale(.985); transition-duration: var(--rk-dur-instant) }
.rk-home-launch-card--primary { border-color: var(--rk-teal-line-strong); background: linear-gradient(180deg, var(--rk-teal-tint) 0%, var(--rk-surface) 72%) }
.rk-home-launch-head { display: flex; align-items: center; justify-content: space-between; gap: 8px }
.rk-home-launch-head > svg { transition: transform var(--rk-dur-fast) var(--rk-ease-out), color var(--rk-dur-fast) var(--rk-ease-out) }
.rk-home-launch-card:hover .rk-home-launch-head > svg { transform: translateX(3px); color: var(--rk-teal) }
.rk-home-launch-icon {
  width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--rk-teal-tint); color: var(--rk-teal);
  transition: transform var(--rk-dur-fast) var(--rk-ease-out);
}
.rk-home-launch-card:hover .rk-home-launch-icon { transform: scale(1.04) }
.rk-home-launch-card--primary .rk-home-launch-icon { background: var(--rk-teal); color: var(--rk-on-ink) }
.rk-home-quiet-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px; border-radius: 10px; background: var(--rk-surface);
  border: 1px solid var(--rk-divide); font-size: 12px; color: var(--rk-muted);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 760px) {
  .rk-home-launch-grid { grid-template-columns: minmax(0, 1fr) }
}
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
/* 统一交互反馈语言：一套减速曲线、四档克制节奏、仅动合成层属性。 */
.rk-page { font-variant-numeric: tabular-nums }
.rk-btn {
  transition: transform var(--rk-dur-fast) var(--rk-ease-out), box-shadow var(--rk-dur-fast) var(--rk-ease-out),
    border-color var(--rk-dur-fast) var(--rk-ease-out), background var(--rk-dur-fast) var(--rk-ease-out),
    color var(--rk-dur-fast) var(--rk-ease-out), opacity var(--rk-dur-fast) var(--rk-ease-out);
}
.rk-btn:hover:not(:disabled) { transform: translateY(-0.5px) }
.rk-btn:active:not(:disabled) { transform: scale(.97); transition-duration: var(--rk-dur-instant) }
.rk-btn:disabled { opacity: .48; cursor: not-allowed }
.rk-fab-btn {
  transition: transform var(--rk-dur-fast) var(--rk-ease-out), box-shadow var(--rk-dur-fast) var(--rk-ease-out),
    background var(--rk-dur-fast) var(--rk-ease-out), border-color var(--rk-dur-fast) var(--rk-ease-out);
}
.rk-fab-btn:hover { transform: scale(1.06); box-shadow: var(--rk-shadow-fab) }
.rk-fab-btn:active { transform: scale(.95); transition-duration: var(--rk-dur-instant) }
.rk-fab-btn[data-busy="true"] svg { animation: rk-spin 900ms linear infinite }
.rk-control {
  transition: border-color var(--rk-dur-fast) var(--rk-ease-out), box-shadow var(--rk-dur-fast) var(--rk-ease-out),
    background var(--rk-dur-fast) var(--rk-ease-out);
}
.rk-control:focus { border-color: var(--rk-teal-line-active) !important; box-shadow: 0 0 0 3px var(--rk-teal-tint-deep) }
/* 分段控件滑动胶囊：以实测位移平滑滑向目标选项，首次挂载无飞行。 */
.rk-seg { position: relative; font-variant-numeric: tabular-nums }
.rk-seg-indicator {
  position: absolute; top: 0; left: 0; pointer-events: none; border-radius: 8px;
  background: var(--rk-teal-tint-deep);
  transition: transform var(--rk-dur-base) var(--rk-ease-out), width var(--rk-dur-base) var(--rk-ease-out), height var(--rk-dur-base) var(--rk-ease-out);
}
.rk-seg-indicator[data-instant] { transition: none }
.rk-seg > button { position: relative; z-index: 1 }
.rk-seg > button:hover:not([aria-selected="true"]) { color: var(--rk-ink) !important }
.rk-star-active svg { animation: rk-star-pop 240ms var(--rk-ease-spring) both }
.rk-spin-once svg { animation: rk-spin 420ms var(--rk-ease-out) both }
/* 宿主的通用 select 样式可能会把控件拉满整行；分类下拉必须按分类栏的紧凑节奏布局。 */
.rk-workflow-category-select {
  width: clamp(88px, 10vw, 116px) !important;
  min-width: 88px !important;
  max-width: 116px !important;
  height: 34px !important;
  min-height: 34px !important;
  flex: 0 0 auto !important;
  box-sizing: border-box;
  line-height: 1.2;
}
.rk-research-mode-select {
  width: clamp(144px, 19vw, 196px) !important;
  min-width: 144px !important;
  max-width: min(100%, 196px) !important;
  flex: 0 1 auto !important;
}
.rk-card { transition: transform var(--rk-dur-base) var(--rk-ease-out), box-shadow var(--rk-dur-base) var(--rk-ease-out), border-color var(--rk-dur-fast) var(--rk-ease-out) }
.rk-card:hover { transform: translateY(-1px); box-shadow: var(--rk-shadow-card) }
.rk-row { transition: background var(--rk-dur-fast) var(--rk-ease-out), box-shadow var(--rk-dur-fast) var(--rk-ease-out) }
.rk-row:hover { background: var(--rk-surface-alt) }
.rk-tabular { font-variant-numeric: tabular-nums }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--rk-teal-line-active); outline-offset: 2px }
details[open] > :not(summary) { animation: rk-reveal var(--rk-dur-base) var(--rk-ease-out) both }
@keyframes rk-spin { to { transform: rotate(360deg) } }
@keyframes rk-pop { from { opacity: 0; transform: translateY(8px) scale(.975) } to { opacity: 1; transform: none } }
@keyframes rk-toast-leave { from { opacity: 1; transform: none } to { opacity: 0; transform: translateY(6px) scale(.97) } }
@keyframes rk-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes rk-reveal { from { opacity: 0; transform: translateY(-4px) scale(.995) } to { opacity: 1; transform: none } }
@keyframes rk-content-swap { from { opacity: .35; transform: translateY(3px) } to { opacity: 1; transform: none } }
@keyframes rk-section-enter { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
@keyframes rk-star-pop { 0% { transform: scale(.86) } 55% { transform: scale(1.16) } 100% { transform: scale(1) } }
@keyframes rk-check-pop { 0% { opacity: 0; transform: scale(.72) } 65% { opacity: 1; transform: scale(1.08) } 100% { opacity: 1; transform: scale(1) } }
@keyframes rk-shake { 0%, 100% { transform: translateX(0) } 25% { transform: translateX(-3px) } 75% { transform: translateX(3px) } }
@keyframes rk-graph-flow { to { stroke-dashoffset: -36 } }
.rk-graph-edge { stroke-linecap: round; opacity: .72; transition: opacity var(--rk-dur-fast) var(--rk-ease-out) }
.rk-graph-edge-flow { stroke: var(--rk-teal) !important; stroke-dasharray: 7 11; animation: rk-graph-flow 1.25s linear infinite }
.rk-graph-node { filter: drop-shadow(0 2px 5px rgba(15, 23, 42, .09)); cursor: pointer; transition: opacity var(--rk-dur-fast) var(--rk-ease-out), filter var(--rk-dur-fast) var(--rk-ease-out) }
.rk-graph-node:hover { filter: drop-shadow(0 4px 10px rgba(15, 23, 42, .16)) }
.rk-graph-node rect { transition: stroke var(--rk-dur-fast) var(--rk-ease-out), stroke-width var(--rk-dur-fast) var(--rk-ease-out) }
.rk-graph-node:hover rect { stroke-width: 2.2px }
.rk-graph-node-focus rect { stroke: var(--rk-teal) !important; stroke-width: 3px; filter: drop-shadow(0 0 8px color-mix(in srgb, var(--rk-teal) 42%, transparent)) }
.rk-pop { animation: rk-pop var(--rk-dur-slow) var(--rk-ease-out) both }
.rk-backdrop { animation: rk-fade var(--rk-dur-base) var(--rk-ease-out) both }
.rk-modal-backdrop { backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px) }
.rk-fade { animation: rk-fade var(--rk-dur-base) var(--rk-ease-out) both }
.rk-reveal { animation: rk-reveal var(--rk-dur-base) var(--rk-ease-out) both }
.rk-content-swap { animation: rk-content-swap 160ms var(--rk-ease-out) both }
.rk-section-enter { animation: rk-section-enter var(--rk-dur-base) var(--rk-ease-out) both }
.rk-check-pop { animation: rk-check-pop 220ms var(--rk-ease-spring) both }
.rk-shake { animation: rk-shake 220ms var(--rk-ease-out) both }
.rk-toast-stack {
  position: fixed; left: 50%; bottom: 112px; transform: translateX(-50%);
  z-index: 20030; display: grid; gap: 8px; width: min(520px, calc(100vw - 24px));
  pointer-events: none; font-family: var(--rk-font); font-variant-numeric: tabular-nums;
}
.rk-toast {
  pointer-events: auto; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border: 1px solid var(--rk-line); border-radius: 10px;
  box-shadow: var(--rk-shadow-lg); font-size: 13px;
}
.rk-toast-leave { animation: rk-toast-leave var(--rk-dur-fast) var(--rk-ease-in) both; pointer-events: none }
.rk-selection-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 10px 14px; border: 1px solid var(--rk-teal-line-strong); border-radius: 10px;
  background: var(--rk-teal-tint); box-shadow: var(--rk-shadow-card);
}
.rk-danger-zone {
  display: grid; gap: 8px; padding: 12px; border: 1px solid var(--rk-red);
  border-radius: 9px; background: var(--rk-red-tint);
}
.rk-scroll::-webkit-scrollbar { width: 8px; height: 8px }
.rk-scroll::-webkit-scrollbar-thumb { background: #cdd8df; border-radius: 999px }
.rk-scroll::-webkit-scrollbar-track { background: transparent }
@media (prefers-reduced-motion: reduce) {
  .rk-btn, .rk-fab-btn, .rk-fab-btn svg, .rk-control, .rk-card, .rk-row, .rk-home-launch-card,
  .rk-home-launch-head > svg, .rk-home-launch-icon, .rk-seg-indicator, .rk-picker-row,
  .rk-picker-tabs button, .rk-picker-text-action, .rk-picker-switch-track, .rk-picker-switch-track::before,
  .rk-graph-node, .rk-graph-node rect, .rk-graph-edge, .rk-compose-suggestion > section,
  details[open] > :not(summary),
  .rk-pop, .rk-backdrop, .rk-fade, .rk-reveal, .rk-content-swap, .rk-section-enter,
  .rk-toast-leave, .rk-check-pop, .rk-spin-once svg, .rk-shake, .rk-star-active svg, .rk-graph-edge-flow {
    transition: none !important; animation: none !important;
  }
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
