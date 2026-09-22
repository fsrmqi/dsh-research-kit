#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalogEntries } from './lib/catalog-entries.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogData = await loadCatalogEntries()
const files = ['src/catalog.js', 'src/catalog-storage.js', 'src/research-selection-store.js', 'src/research-context-store.js', 'src/evidence-store.js', 'src/theme.js', 'src/lib/icons.js', 'src/ui.js', 'src/promptkit-loader.js', 'src/catalog-category-filter.js', 'src/lib/enhance-output.js', 'src/lib/vault-core.js', 'src/lib/knowledge-extract.js', 'src/lib/asset-evidence-links.js', 'src/lib/evidence-graph-core.js', 'src/lib/evidence-vault-core.js', 'src/lib/console-sections.js', 'src/lib/overlay-anchor.js', 'src/lib/input-actions.js', 'src/host-capabilities-client.js', 'vendor/archify/i18n.mjs', 'src/lib/archify-adapter.js', 'src/evidence-vault-store.js', 'src/knowledge-store.js', 'src/research-evidence-vault.js', 'src/database-query-panel.js', 'src/composer-launcher.js', 'src/composer-overlay.js', 'src/research-vault.js', 'src/research-evidence-graph.js', 'src/knowledge-deposition.js', 'src/composer-deposit-button.js', 'src/route-replay.js', 'src/research-workbench.js', 'mcp/tool-registry.js', 'dsh/slot-registry.js', 'dsh/prompt-studio-glue.js', 'dsh/prompt-enhancer-glue.js', 'src/plugin-status.js', 'src/agent-activity.js', 'src/research-console.js', 'dsh/standalone-glue.js']
// 多行 import 先折叠成单行：剥离规则按行过滤 `import`，
// 若 import 跨行则只删掉首行，剩余行会残留成非法语句（产物语法错误）。
function collapseImports(source) {
  return source.replace(/^([ \t]*)import\s*\{([\s\S]*?)\}\s*from\s*([^\n]+)$/gm,
    (_, indent, names, tail) => `${indent}import {${names.replace(/\s+/g, ' ').trim()}} from ${tail}`)
}
function strip(source) {
  return collapseImports(source).split('\n').filter(line => !/^\s*import\s/.test(line)).map(line => line
    .replace(/^(\s*)export\s+const\s/, '$1const ')
    .replace(/^(\s*)export\s+let\s/, '$1let ')
    // async 必须单独一条且排在普通 function 之前：`export async function` 不匹配
    // `^export function`，漏掉会让产物里残留 export 关键字，直接语法错误。
    .replace(/^(\s*)export\s+async\s+function\s/, '$1async function ')
    .replace(/^(\s*)export\s+function\s/, '$1function ')
    .replace(/^export\s+\{[^}]*\}\s*$/, '')
  ).join('\n')
}
const promptKitEmbed = readFileSync(resolve(root, 'vendor/promptkit-embed.js'), 'utf8')
// vendored 工件保持与源仓库逐字节一致（vendor-manifest.json 锁定 SHA-256）。
// 工件内置的 DshSessionEnhancer 是未接线的死代码，但硬编码了 PromptKit 独立插件路由；
// 构建时统一改写为本插件路由，保证产物内不出现跨插件 fetch 路径。
const promptKitEmbedRewritten = promptKitEmbed.replaceAll('/dsh-promptkit/semantic-enhance', '/dsh-research-kit/semantic-enhance')
const projects = files.map(file => ({ file, source: strip(readFileSync(resolve(root, file), 'utf8')) }))
let body = projects.map(entry => entry.source).join('\n\n')
// 大目录由 Node half 的同源路由按需提供。空壳保持源码模块契约不变，首次视图挂载后
// catalog.js 会原子替换 live binding，并通知所有已挂载消费者。
body = `const workflows = []\nconst skills = []\nconst resources = []\nconst databaseMetadataConfig = { groups: [], accessOverrides: {} }\n\n${body}`
// 模块间没有 import：符号全部依赖 files 的拼接顺序可见。顺序一旦错位，
// node --check 查不出，只有运行时才 ReferenceError。这里在构建期把顺序约束固化：
// 下列符号的定义位置必须早于 standalone-glue 使用它们的位置。
const ORDERED_SYMBOLS = [
  'h', 'C', 'GlobalStyle',         // src/theme.js
  'Icon',                          // src/lib/icons.js
  'Button', 'Panel', 'Modal',      // src/ui.js
  'catalog', 'composeWorkflow',    // src/catalog.js
  'currentResearchContext', 'startResearchRun', // src/research-context-store.js
  'RESEARCH_CONSOLE_SECTIONS', 'normalizeConsoleSection', 'findConsoleSection', // src/lib/console-sections.js
  'POPOVER_GAP', 'overlayMaxHeight', 'findScrollport', // src/lib/overlay-anchor.js
  'normalizeEvidenceEntry',                       // src/lib/evidence-vault-core.js
  'createEvidenceVaultStore',                     // src/evidence-vault-store.js
  'EvidenceSaveForm', 'EvidenceVaultPane',        // src/research-evidence-vault.js
  'knowledgeStore', 'publishKnowledge',           // src/knowledge-store.js（图谱面板）
  'researchMethodProvider', 'researchAssetProvider', 'ResearchPromptStudioHost', // dsh/prompt-studio-glue.js
  'ResearchVaultHost',             // src/research-vault.js
  'ResearchDraftEnhancerHost',     // dsh/prompt-enhancer-glue.js
  'ResearchWorkbench', 'ResearchComposerLauncher', 'ResearchComposerOverlay',
  'ResearchPluginStatusSection',   // src/plugin-status.js（standalone-glue 注册状态区）
  'attachKnowledgeDeposition',     // src/knowledge-deposition.js（standalone-glue 接线）
  'ResearchDepositButton',         // src/composer-deposit-button.js（增强器伴生钮，prompt-enhancer-glue 渲染）
  'ResearchConsole',               // src/research-console.js
]
function assertSymbolOrder(body) {
  const glueStart = body.indexOf('function researchKitApply')
  if (glueStart < 0) throw new Error('构建产物缺少 researchKitApply；检查 files 列表是否包含 dsh/standalone-glue.js')
  for (const symbol of ORDERED_SYMBOLS) {
    const match = new RegExp(`(?:^|\\n)\\s*(?:const|let|function|class)\\s+${symbol}\\b`).exec(body)
    if (!match) throw new Error(`构建产物缺少符号定义：${symbol}（检查 scripts/build-client.mjs 的 files 列表）`)
    if (match.index > glueStart) throw new Error(`符号 ${symbol} 的定义晚于 standalone-glue：拼接顺序错误，请调整 files 列表`)
  }
}
assertSymbolOrder(body)

// 顶层符号必须全局唯一 —— 与上面的「顺序」约束是一对：顺序错位会 ReferenceError，
// 重名则是更安静的失败。重名 const/let/class 直接 SyntaxError（至少构建期可见），
// 而重名 function 声明合法、**后者静默覆盖前者**，产物照样通过 node --check，
// 只在运行到调用点才炸。实测血案：src/research-selection-store.js 与 src/evidence-store.js
// 各定义了一个 stateFor，返回的 state 形状不同（后者没有 ids 字段），覆盖后 state.ids
// 不可迭代，统一视图与输入框浮层渲染即抛错、整屏空白。故在构建期硬失败。
//
function assertUniqueTopLevelSymbols(entries) {
  const declared = new Map()
  for (const { file, source } of entries) {
    source.split('\n').forEach((line, index) => {
      const match = /^(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(line)
      if (!match) return
      const owners = declared.get(match[1]) || []
      owners.push(`${file}:${index + 1}`)
      declared.set(match[1], owners)
    })
  }
  const clashes = [...declared].filter(([, owners]) => owners.length > 1)
  if (!clashes.length) return
  throw new Error('构建产物存在顶层重名符号（拼进同一作用域后会静默覆盖，请改名）：'
    + clashes.map(([name, owners]) => `${name} @ ${owners.join(' / ')}`).join('；'))
}
assertUniqueTopLevelSymbols(projects)

const output = `/* eslint-disable */\n/* Generated by scripts/build-client.mjs. Do not edit directly. */\nwindow.__ModuleLoader__.load({\n  id: 'dsh-research-kit',\n  factory: require => {\n    const React = require('react')\n${body.split('\n').map(line => line ? `    ${line}` : '').join('\n')}\n    return { inject: ['slots', 'sessions'], apply: researchKitApply }\n  }\n})\n`
writeFileSync(resolve(root, 'ui/client.js'), output)
writeFileSync(resolve(root, 'ui/catalog-data.json'), JSON.stringify({ ok: true, data: catalogData }))
const promptKitOutput = `/* eslint-disable */\n/* Generated by scripts/build-client.mjs. Do not edit directly. */\n(() => {\n  const React = window.__DSH_RESEARCH_REACT__\n  if (!React) throw new Error('PromptKit 缺少 React 运行时。')\n${promptKitEmbedRewritten.split('\n').map(line => line ? `  ${line}` : '').join('\n')}\n  window.__DSH_RESEARCH_PROMPTKIT__ = PromptKit\n})()\n`
writeFileSync(resolve(root, 'ui/promptkit.js'), promptKitOutput)
console.log('Generated ui/client.js, ui/catalog-data.json and ui/promptkit.js')
