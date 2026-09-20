#!/usr/bin/env node
// 校验对外文档里的统计数字与实测一致，失败时非零退出（挂接 npm run check）。
//
// 为什么要它：此前的门禁覆盖目录契约、vendored 工件、MCP 工具表与 diagram IR，
// 却没有一处看守「门面数字」——于是 package.json 描述停在 317/86/122、
// 两份 README 写「其余 111 个数据源」、正文写「二十四个流程族」而表格列 28 行，
// 三处同时漂移且都靠人工发现。
//
// 真值来源只有两个：catalog/（实测条目）与 mcp/tool-registry.js（实测工具数）。
// 规则按「规范句式」匹配：句式不存在不算错（文档可以换写法），数字不符即失败，
// 未被命中的规则会在末尾列出，避免「检查静默失效」被当成通过。
// 刻意不检查 CHANGELOG 与 docs-internal/ —— 历史条目里的旧数字是合法的历史记录。
// 测试用例数走「跨文档一致性」检查：其真值需运行测试套件，不由本脚本承担。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalogEntries } from './lib/catalog-entries.mjs'
import { TOOL_REGISTRY, toolCount } from '../mcp/tool-registry.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const uncovered = []

const { workflows, skills, resources } = await loadCatalogEntries()

const direct = resources.filter(r => r.availability === 'available-in-plugin').length
const fallback = resources.length - direct
const total = workflows.length + skills.length + resources.length
const guidance = skills.filter(s => s.availability === 'prompt-guidance').length
const capability = skills.filter(s => s.availability === 'requires-host-capability').length
const families = readdirSync(resolve(root, 'catalog/workflows')).filter(f => f.endsWith('.json')).length

// 论文工作手册用的派生量：按类目切分，而不是按分片数——类目是读者在界面里筛选时看到的口径。
const PAPER_CATEGORIES = ['论文与手稿', '论文写作']
const paperWorkflows = workflows.filter(w => PAPER_CATEGORIES.includes(w.category)).length
const paperFileWorkflows = workflows.filter(w => PAPER_CATEGORIES.includes(w.category) && w.requiresFiles).length
const literatureWorkflows = workflows.filter(w => w.category === '文献研究').length
const literatureResources = resources.filter(r => r.category === '文献研究').length

const read = rel => readFileSync(resolve(root, rel), 'utf8')
const cache = new Map()
const readOnce = rel => {
  if (!cache.has(rel)) cache.set(rel, read(rel))
  return cache.get(rel)
}

const rules = [
  { file: 'README.md', re: /(\d+) 条人工审核的(?:科研)?工作流/, expect: [workflows.length], label: '工作流数' },
  { file: 'README.md', re: /(\d+) 个技能条目：(\d+) 个指导模块 \+ (\d+) 个能力目录/, expect: [skills.length, guidance, capability], label: '技能数（含两类拆分）' },
  { file: 'README.md', re: /(\d+) 个科学数据源，其中 (\d+) 个支持插件直查/, expect: [resources.length, direct], label: '数据源数 / 直查数' },
  { file: 'README.md', re: /科研能力目录（(\d+) 项）/, expect: [total], label: '目录总条目' },
  { file: 'README.md', re: /搜索或按类型筛选 (\d+) 项资源/, expect: [total], label: '目录总条目' },
  { file: 'README.md', re: /等 (\d+) 个流程族/, expect: [families], label: '流程族数' },
  { file: 'README.md', re: /其余 (\d+) 个数据源标记为/, expect: [fallback], label: '回退来源数' },
  { file: 'README.md', re: /另有 (\d+) 项技能/, expect: [skills.length], label: '技能数' },
  { file: 'README.md', re: /(\d+) 个 `research_\*` 工具/, expect: [toolCount], label: 'MCP 工具数' },

  { file: 'README.en.md', re: /(\d+) human-reviewed (?:research )?workflows/, expect: [workflows.length], label: 'workflow count' },
  { file: 'README.en.md', re: /(\d+) skill entries: (\d+) guidance modules \+ (\d+) capability entries/, expect: [skills.length, guidance, capability], label: 'skill counts' },
  { file: 'README.en.md', re: /(\d+) scientific data sources, (\d+) of them queryable in-plugin/, expect: [resources.length, direct], label: 'data source / direct counts' },
  { file: 'README.en.md', re: /Research capability catalog \((\d+) entries\)/, expect: [total], label: 'catalog total' },
  { file: 'README.en.md', re: /search or filter the (\d+) catalog entries/, expect: [total], label: 'catalog total' },
  { file: 'README.en.md', re: /Across (\d+) workflow families/, expect: [families], label: 'workflow families' },
  { file: 'README.en.md', re: /The remaining (\d+) sources are marked/, expect: [fallback], label: 'fallback sources' },
  { file: 'README.en.md', re: /Plus (\d+) skills/, expect: [skills.length], label: 'skill count' },
  { file: 'README.en.md', re: /(\d+) `research_\*` tools/, expect: [toolCount], label: 'MCP tool count' },

  { file: 'docs/PRODUCT.md', re: /科研能力目录（(\d+) 项）/, expect: [total], label: '目录总条目' },
  { file: 'docs/PRODUCT.md', re: /(\d+) 个数据源中有 (\d+) 个由插件内置适配器直接查询/, expect: [resources.length, direct], label: '数据源数 / 直查数' },
  { file: 'docs/PRODUCT.md', re: /其余 (\d+) 个如实标注接入前提/, expect: [fallback], label: '回退来源数' },
  { file: 'docs/PRODUCT.md', re: /工作流按流程族分 (\d+) 个类目/, expect: [families], label: '流程族数' },
  { file: 'docs/PRODUCT.md', re: /(\d+) 项资源（(\d+) 工作流 \+ (\d+) 技能 \+ (\d+) 数据源/, expect: [total, workflows.length, skills.length, resources.length], label: '规模拆分' },

  { file: 'docs/ARCHITECTURE.md', re: /按流程族分片（(\d+) 条 \/ (\d+) 个类目）/, expect: [workflows.length, families], label: '工作流数 / 类目数' },
  { file: 'docs/ARCHITECTURE.md', re: /host-capabilities (\d+)，共 (\d+) 条）/, expect: [capability, skills.length], label: '技能数' },
  { file: 'docs/ARCHITECTURE.md', re: /general-science，共 (\d+) 条）/, expect: [resources.length], label: '数据源数' },
  { file: 'docs/ARCHITECTURE.md', re: /`reference-only`，(\d+) 个）/, expect: [fallback], label: '回退来源数' },
  { file: 'docs/ARCHITECTURE.md', re: /工作流 (\d+) 个类目/, expect: [families], label: '类目数' },
  { file: 'docs/ARCHITECTURE.md', re: /(\d+) 个 research_\* 工具的注册/, expect: [toolCount], label: 'MCP 工具数' },

  { file: 'docs/DEVELOPMENT.md', re: /(\d+) 工作流 \+ (\d+) 技能 \+ (\d+) 数据源，共 (\d+) 项/, expect: [workflows.length, skills.length, resources.length, total], label: '规模拆分' },
  { file: 'docs/DEVELOPMENT.md', re: /当前 (\d+) 条工作流（(\d+) 个类目/, expect: [workflows.length, families], label: '工作流数 / 类目数' },
  { file: 'docs/DEVELOPMENT.md', re: /(\d+) 项技能（`catalog\/skills\/`）与 (\d+) 个数据源/, expect: [skills.length, resources.length], label: '技能数 / 数据源数' },
  { file: 'docs/DEVELOPMENT.md', re: /MCP Server（(\d+) 个 research_\* 工具）/, expect: [toolCount], label: 'MCP 工具数' },
  { file: 'docs/DEVELOPMENT.md', re: /(\d+) 项目录资产、统一视图四分区/, expect: [total], label: '目录总条目' },

  { file: 'docs/MCP-SETUP.md', re: /直接调用 (\d+) 个科研 Tool/, expect: [toolCount], label: 'MCP 工具数' },
  { file: 'docs/MCP-SETUP.md', re: /应列出 (\d+) 个 dsh-research-kit 的 Tool/, expect: [toolCount], label: 'MCP 工具数' },

  { file: 'docs/PAPER-WORKFLOW.md', re: /两个类目合计 (\d+) 条论文类工作流/, expect: [paperWorkflows], label: '论文类工作流数' },
  { file: 'docs/PAPER-WORKFLOW.md', re: /其中 (\d+) 条声明了材料依赖/, expect: [paperFileWorkflows], label: '论文类需文件工作流数' },
  { file: 'docs/PAPER-WORKFLOW.md', re: /文献研究类目另有 (\d+) 条工作流、(\d+) 个数据源条目/, expect: [literatureWorkflows, literatureResources], label: '文献研究工作流数 / 数据源数' },
  { file: 'docs/PAPER-WORKFLOW.md', re: /(\d+) 个 `research_\*` 工具/, expect: [toolCount], label: 'MCP 工具数' },
]

const descChecks = [
  [/(\d+) 条工作流/, workflows.length, '工作流数'],
  [/(\d+) 个技能条目/, skills.length, '技能数'],
  [/(\d+) 个科学数据源/, resources.length, '数据源数'],
]
const descLine = readOnce('package.json').split('\n').findIndex(l => /"description"/.test(l)) + 1
const desc = (JSON.parse(readOnce('package.json')).description) || ''
for (const [re, expected, label] of descChecks) {
  const m = re.exec(desc)
  if (!m) errors.push(`package.json:${descLine} 的 description 缺少「${label}」陈述（npm 页面的门面）`)
  else if (Number(m[1]) !== expected) errors.push(`package.json:${descLine} description 的${label}写作 ${m[1]}，实测 ${expected}`)
}

for (const rule of rules) {
  const lines = readOnce(rule.file).split('\n')
  const hits = []
  lines.forEach((line, index) => {
    const m = rule.re.exec(line)
    if (!m) return
    hits.push(index + 1)
    rule.expect.forEach((expected, k) => {
      const got = Number(m[k + 1])
      if (got !== expected) errors.push(`${rule.file}:${index + 1} 的${rule.label}写作 ${got}，实测 ${expected}`)
    })
  })
  rule.hits = hits
  if (!hits.length) uncovered.push(`${rule.file}：${rule.label}`)
}

// 工具摘要里的数量词：注册表声明自己是「纯数据模块，无 Node 专属依赖」，因此无法
// 从 catalog/ 或适配器清单派生任何规模数字，写死一个就必然随内容漂移。这不是假设——
// 摘要曾写「列出 8 个可用图表风格」，而 mcp/execution/figure-styles 实际已有 11 个，
// 且没有任何门禁看得见它。此处禁止在摘要里写数量词；要给出规模就让工具在调用时返回。
for (const tool of TOOL_REGISTRY) {
  const m = /(\d+)\s*(?:个|条|种|篇|类)/.exec(tool.summaryZh || '')
  if (m) errors.push(`mcp/tool-registry.js 的 ${tool.name}.summaryZh 写死了数量「${m[0]}」——注册表无法派生目录规模，会随内容漂移；请改为不含数量的措辞`)
}

// 测试用例数：真值需运行测试套件，这里只查「各文档彼此一致」，抓的是 168/152 那类互相矛盾。
const testPat = [
  [/(\d+) 项回归测试（(\d+) 个测试文件/, 'README.md'],
  [/(\d+) 项 \/ (\d+) 个测试文件/, 'README.md'],
  [/(\d+) 项 \/ (\d+) 个测试文件/, 'README.en.md'],
  [/(\d+) regression tests in (\d+) files/, 'README.en.md'],
  [/(\d+) 项测试（(\d+) 个测试文件）/, 'docs/README.md'],
  [/(\d+) 项测试（(\d+) 个测试文件/, 'docs/ARCHITECTURE.md'],
  [/(\d+) 项 \/ (\d+) 个测试文件/, 'docs/DEVELOPMENT.md'],
  [/仓库内 (\d+) 项测试/, 'docs/DEVELOPMENT.md'],
]
const testValues = new Set()
const fileValues = new Set()
for (const [re, file] of testPat) {
  const m = re.exec(readOnce(file))
  if (!m) continue
  testValues.add(Number(m[1]))
  if (m[2] !== undefined) fileValues.add(Number(m[2]))
}
if (testValues.size > 1) errors.push(`测试用例数在各文档间不一致：${[...testValues].join(' / ')}`)
if (fileValues.size > 1) errors.push(`测试文件数在各文档间不一致：${[...fileValues].join(' / ')}`)

if (process.argv.includes('--verbose')) {
  console.log('被看守的数字（规则 → 命中行号）：')
  for (const rule of rules) {
    console.log(`  ${rule.hits.length ? '✓' : '✗'} ${rule.file} ${rule.label} → ${rule.hits.join(', ') || '未命中（该数字本轮无人看守）'}`)
  }
}

if (process.argv.includes('--print')) {
  console.log(JSON.stringify({ workflows: workflows.length, skills: skills.length, resources: resources.length, total, direct, fallback, families, toolCount, guidance, capability, testValues: [...testValues], fileValues: [...fileValues] }, null, 2))
  process.exit(errors.length ? 1 : 0)
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`)
  console.error(`文档统计校验失败（${errors.length} 处）：文档里的规模数字与 catalog/ / 工具注册表实测不符。`)
  process.exit(1)
}
console.log(`文档统计校验通过：工作流 ${workflows.length} / 技能 ${skills.length} / 数据源 ${resources.length}（共 ${total} 项、流程族 ${families}、回退来源 ${fallback}、MCP 工具 ${toolCount}）；测试数跨文档一致（${[...testValues].join('/')} 项 / ${[...fileValues].join('/')} 个文件）。`)
if (uncovered.length) console.log(`提示：${uncovered.length} 条规则未命中规范句式，本轮未校验：${[...new Set(uncovered)].join('、')}`)
