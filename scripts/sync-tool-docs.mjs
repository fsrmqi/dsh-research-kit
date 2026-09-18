#!/usr/bin/env node
// 从 mcp/tool-registry.js 生成 docs/MCP-SETUP.md 的「Tool 清单速查」表格。
// 表格写在 <!-- tool-table:start --> / <!-- tool-table:end --> 标记之间；
// 不带参数时原地更新，--check 仅校验漂移（内容不一致则退出码 1，供 npm run check 挂接）。

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOL_REGISTRY, toolCount } from '../mcp/tool-registry.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docPath = resolve(root, 'docs/MCP-SETUP.md')
const START = '<!-- tool-table:start -->'
const END = '<!-- tool-table:end -->'

function buildTable() {
  const rows = TOOL_REGISTRY.map(tool =>
    `| \`${tool.name}\` | ${tool.summaryZh}${tool.tier === 'entry' ? '（默认入口）' : ''} |`,
  )
  return [`| Tool | 功能 |`, `|------|------|`, ...rows].join('\n')
}

function buildDoc() {
  const doc = readFileSync(docPath, 'utf8')
  const start = doc.indexOf(START)
  const end = doc.indexOf(END)
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`docs/MCP-SETUP.md 缺少 ${START} / ${END} 标记，无法同步工具表格。`)
  }
  return doc.slice(0, start + START.length) + '\n' + buildTable() + '\n' + doc.slice(end)
}

const updated = buildDoc()
if (process.argv.includes('--check')) {
  if (updated !== readFileSync(docPath, 'utf8')) {
    console.error('docs/MCP-SETUP.md 的工具表格与 mcp/tool-registry.js 不一致；运行 `node scripts/sync-tool-docs.mjs` 更新。')
    process.exit(1)
  }
  console.log(`工具文档表格与注册表一致（${toolCount} 个工具）。`)
} else {
  writeFileSync(docPath, updated)
  console.log(`docs/MCP-SETUP.md 工具表格已从注册表重新生成（${toolCount} 个工具）。`)
}
