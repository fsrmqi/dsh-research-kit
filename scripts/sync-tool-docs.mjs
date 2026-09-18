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
const QUICK_START = '<!-- quick-start:start -->'
const QUICK_END = '<!-- quick-start:end -->'

// 按任务组织的最短路径（P2-7）：每条任务给工具链 + 参数示例，示例取自注册表 example 字段。
const TASK_GUIDES = [
  {
    task: '启动一次研究运行',
    chain: ['research_catalog_search', 'research_run_start', 'research_run_status'],
  },
  {
    task: '检索并保存文献',
    chain: ['research_literature_search', 'research_evidence_save_batch', 'research_evidence_review'],
  },
  {
    task: '审阅研究草稿',
    chain: ['research_review_output', 'research_review_claims'],
  },
  {
    task: '生成论文图表',
    chain: ['research_figure_list_styles', 'research_figure_generate'],
  },
  {
    task: '恢复或推进运行',
    chain: ['research_run_status', 'research_run_checkpoint_approve', 'research_run_export'],
  },
  {
    task: '生成 AI 使用披露',
    chain: ['research_disclosure_list_policies', 'research_disclosure_generate'],
  },
]

function buildQuickStart() {
  const byName = new Map(TOOL_REGISTRY.map(tool => [tool.name, tool]))
  const sections = TASK_GUIDES.map(guide => {
    const steps = guide.chain.map((name, index) => {
      const tool = byName.get(name)
      if (!tool) throw new Error(`任务指南引用了未注册的工具 ${name}`)
      return `${index + 1}. \`${name}\` — 参数示例：\`${tool.example || '{}'}\``
    })
    return [`**${guide.task}**`, ...steps].join('\n')
  })
  return sections.join('\n\n')
}

function buildTable() {
  const rows = TOOL_REGISTRY.map(tool =>
    `| \`${tool.name}\` | ${tool.summaryZh}${tool.tier === 'entry' ? '（默认入口）' : ''} |`,
  )
  return [`| Tool | 功能 |`, `|------|------|`, ...rows].join('\n')
}

function replaceSection(doc, startMark, endMark, content, label) {
  const start = doc.indexOf(startMark)
  const end = doc.indexOf(endMark)
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`docs/MCP-SETUP.md 缺少 ${startMark} / ${endMark} 标记，无法同步${label}。`)
  }
  return doc.slice(0, start + startMark.length) + '\n' + content + '\n' + doc.slice(end)
}

function buildDoc() {
  let doc = readFileSync(docPath, 'utf8')
  doc = replaceSection(doc, START, END, buildTable(), '工具表格')
  doc = replaceSection(doc, QUICK_START, QUICK_END, buildQuickStart(), '快速上手')
  return doc
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
