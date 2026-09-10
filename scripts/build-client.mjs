#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = ['src/catalog.js', 'src/catalog-storage.js', 'src/research-selection-store.js', 'src/evidence-store.js', 'src/theme.js', 'src/lib/icons.js', 'src/ui.js', 'src/lib/enhance-output.js', 'src/lib/vault-core.js', 'src/lib/evidence-graph-core.js', 'src/lib/evidence-vault-core.js', 'src/lib/console-sections.js', 'src/lib/overlay-anchor.js', 'src/evidence-vault-store.js', 'src/research-evidence-vault.js', 'src/database-query-panel.js', 'src/composer-launcher.js', 'src/composer-overlay.js', 'src/research-vault.js', 'src/research-evidence-graph.js', 'src/research-workbench.js', 'dsh/slot-registry.js', 'dsh/prompt-studio-glue.js', 'dsh/prompt-enhancer-glue.js', 'src/research-console.js', 'dsh/standalone-glue.js']
const data = {
  workflows: JSON.parse(readFileSync(resolve(root, 'catalog/workflows.json'), 'utf8')),
  skills: JSON.parse(readFileSync(resolve(root, 'catalog/skills.json'), 'utf8')),
  databases: JSON.parse(readFileSync(resolve(root, 'catalog/databases.json'), 'utf8')),
  databaseMetadataConfig: JSON.parse(readFileSync(resolve(root, 'catalog/database-metadata.json'), 'utf8'))
}
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
let body = `${promptKitEmbedRewritten}\n\n${files.map(file => strip(readFileSync(resolve(root, file), 'utf8'))).join('\n\n')}`
body = body.replace("import workflows from '../catalog/workflows.json' with { type: 'json' }\nimport skills from '../catalog/skills.json' with { type: 'json' }\nimport databases from '../catalog/databases.json' with { type: 'json' }", '')
body = `const workflows = ${JSON.stringify(data.workflows)}\nconst skills = ${JSON.stringify(data.skills)}\nconst databases = ${JSON.stringify(data.databases)}\nconst databaseMetadataConfig = ${JSON.stringify(data.databaseMetadataConfig)}\n\n${body}`
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

const output = `/* eslint-disable */\n/* Generated by scripts/build-client.mjs. Do not edit directly. */\nwindow.__ModuleLoader__.load({\n  id: 'dsh-research-kit',\n  factory: require => {\n    const React = require('react')\n${body.split('\n').map(line => line ? `    ${line}` : '').join('\n')}\n    return { inject: ['slots', 'sessions'], apply: researchKitApply }\n  }\n})\n`
writeFileSync(resolve(root, 'ui/client.js'), output)
console.log('Generated ui/client.js')
