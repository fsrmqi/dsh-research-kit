#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalogEntries } from './lib/catalog-entries.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = ['src/catalog.js', 'src/catalog-storage.js', 'src/research-selection-store.js', 'src/evidence-store.js', 'src/theme.js', 'src/lib/icons.js', 'src/ui.js', 'src/lib/enhance-output.js', 'src/lib/vault-core.js', 'src/lib/evidence-graph-core.js', 'src/lib/evidence-vault-core.js', 'src/lib/console-sections.js', 'src/lib/overlay-anchor.js', 'src/evidence-vault-store.js', 'src/research-evidence-vault.js', 'src/database-query-panel.js', 'src/composer-launcher.js', 'src/composer-overlay.js', 'src/research-vault.js', 'src/research-evidence-graph.js', 'src/research-workbench.js', 'dsh/slot-registry.js', 'dsh/prompt-studio-glue.js', 'dsh/prompt-enhancer-glue.js', 'src/research-console.js', 'dsh/standalone-glue.js']
// 目录数据从三个聚合入口（catalog/*/index.js）加载后内联：浏览器产物始终包含完整目录，
// 不增加任何动态文件请求。分片与入口的一致性由 scripts/lib/catalog-entries.mjs 的
// 登记检查与校验器/测试的「分片总数 == 聚合总数」断言守护。
const data = await loadCatalogEntries()
// 多行 import 先折叠成单行：剥离规则按行过滤 `import`，
// 若 import 跨行则只删掉首行，剩余行会残留成非法语句（产物语法错误）。
function collapseImports(source) {
  return source.replace(/^([ \t]*)import\s*\{([\s\S]*?)\}\s*from\s*([^\n]+)$/gm,
    (_, indent, names, tail) => `${indent}import {${names.replace(/\s+/g, ' ').trim()}} from ${tail}`)
}
function strip(source) {
  return collapseImports(source).split('\n').filter(line => !/^\s*import\s/.test(line)).map(line => line
    .replace(/^(\s*)export\s+const\s/, '$1const ')
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
let body = `${promptKitEmbedRewritten}\n\n${projects.map(entry => entry.source).join('\n\n')}`
// strip() 已按行剥离全部 import（含 catalog.js 的三个聚合入口 import），
// 这里以内联 const 补回同名符号，模块内引用无需感知数据来自分片还是产物。
body = `const workflows = ${JSON.stringify(data.workflows)}\nconst skills = ${JSON.stringify(data.skills)}\nconst resources = ${JSON.stringify(data.resources)}\nconst databaseMetadataConfig = ${JSON.stringify(data.databaseMetadataConfig)}\n\n${body}`
// 模块间没有 import：符号全部依赖 files 的拼接顺序可见。顺序一旦错位，
// node --check 查不出，只有运行时才 ReferenceError。这里在构建期把顺序约束固化：
// 下列符号的定义位置必须早于 standalone-glue 使用它们的位置。
const ORDERED_SYMBOLS = [
  'PromptKit',                     // vendor/promptkit-embed.js
  'h', 'C', 'GlobalStyle',         // src/theme.js
  'Icon',                          // src/lib/icons.js
  'Button', 'Panel', 'Modal',      // src/ui.js
  'catalog', 'composeWorkflow',    // src/catalog.js
  'RESEARCH_CONSOLE_SECTIONS', 'normalizeConsoleSection', 'findConsoleSection', // src/lib/console-sections.js
  'POPOVER_GAP', 'overlayMaxHeight', 'findScrollport', // src/lib/overlay-anchor.js
  'normalizeEvidenceEntry',                       // src/lib/evidence-vault-core.js
  'createEvidenceVaultStore',                     // src/evidence-vault-store.js
  'EvidenceSaveForm', 'EvidenceVaultPane',        // src/research-evidence-vault.js
  'researchMethodProvider', 'researchAssetProvider', 'ResearchPromptStudioHost', // dsh/prompt-studio-glue.js
  'ResearchVaultHost',             // src/research-vault.js
  'ResearchDraftEnhancerHost',     // dsh/prompt-enhancer-glue.js
  'ResearchWorkbench', 'ResearchComposerLauncher', 'ResearchComposerOverlay',
  'ResearchConsole',               // src/research-console.js
]
// vendor 唯一外露到拼接作用域的符号；它的其余内部声明都包在 `const PromptKit = (React => {…})`
// 的 IIFE 里，与项目模块不同作用域。顶层重名检查因此只覆盖项目模块，外加以此为保留名。
const RESERVED_EXTERNAL = ['PromptKit']
function assertSymbolOrder(body) {
  const glueStart = body.indexOf('function researchKitApply')
  if (glueStart < 0) throw new Error('构建产物缺少 researchKitApply；检查 files 列表是否包含 dsh/standalone-glue.js')
  for (const symbol of ORDERED_SYMBOLS) {
    const match = new RegExp(`(?:^|\\n)\\s*(?:const|function|class)\\s+${symbol}\\b`).exec(body)
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
// 只查项目模块：vendor 的内部声明都在 `const PromptKit = (React => {…})` 的 IIFE 作用域内，
// 不参与这条平铺拼接的作用域（它唯一外露的符号是 PromptKit，见 RESERVED_EXTERNAL）。
function assertUniqueTopLevelSymbols(entries) {
  const declared = new Map(RESERVED_EXTERNAL.map(name => [name, ['<vendor 作用域>']]))
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
console.log('Generated ui/client.js')
