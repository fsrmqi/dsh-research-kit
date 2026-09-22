import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tools } from '../mcp/tools/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const toolsDir = path.join(root, 'mcp/tools')

const EXPECTED_TOOL_ORDER = [
  'research_help',
  'research_catalog_search',
  'research_workflow_compose',
  'research_source_query',
  'research_citation_verify',
  'research_literature_search',
  'research_evidence_save',
  'research_evidence_list',
  'research_evidence_grade',
  'research_evidence_assess',
  'research_evidence_review',
  'research_evidence_save_batch',
  'research_evidence_grade_apply',
  'research_usage_stats',
  'research_run_start',
  'research_run_status',
  'research_run_export',
  'research_run_import',
  'research_evidence_link',
  'research_figure_generate',
  'research_figure_list_styles',
  'research_run_checkpoint_status',
  'research_run_checkpoint_approve',
  'research_review_output',
  'research_review_claims',
  'research_literature_link',
  'research_review_anomalies',
  'research_review_writing',
  'research_disclosure_generate',
  'research_disclosure_list_policies',
  'research_review_hedging',
  'research_metadata_openalex_fetch',
]

test('MCP 工具顺序保持稳定', () => {
  assert.deepEqual(tools.map(tool => tool.name), EXPECTED_TOOL_ORDER)
})

test('每个 MCP 工具只在一个领域模块中定义', async () => {
  const files = (await readdir(toolsDir)).filter(file => file.endsWith('.js') && file !== 'index.js')
  const definitions = []
  for (const file of files) {
    const source = await readFile(path.join(toolsDir, file), 'utf8')
    for (const match of source.matchAll(/\bname:\s*'(research_[a-z0-9_]+)'/g)) {
      definitions.push({ name: match[1], file })
    }
  }

  assert.equal(definitions.length, EXPECTED_TOOL_ORDER.length)
  const byName = new Map()
  for (const definition of definitions) {
    const owners = byName.get(definition.name) || []
    owners.push(definition.file)
    byName.set(definition.name, owners)
  }
  assert.deepEqual([...byName.keys()].sort(), [...EXPECTED_TOOL_ORDER].sort())
  assert.deepEqual([...byName].filter(([, owners]) => owners.length !== 1), [])
})

test('MCP 工具入口只负责领域数组聚合', async () => {
  const source = await readFile(path.join(toolsDir, 'index.js'), 'utf8')
  assert.ok(source.split('\n').length <= 50, 'index.js 不应重新膨胀为工具实现文件')
  assert.ok(!source.includes("name: 'research_"), 'index.js 不应直接定义工具')
  assert.ok(!source.includes('async execute'), 'index.js 不应包含工具执行逻辑')
  assert.match(source, /export \{ tools, DISCOVERY_ROUTES \}/)
})
