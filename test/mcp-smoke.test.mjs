
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// MCP 工具会往 DSH_RESEARCH_KIT_HOME 写证据库与调用日志，测试必须落到沙箱目录，
// 否则会污染用户真实数据（还会触发日志轮转，把真实历史转走）。
let home
let client
let transport

test.before(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'dsh-mcp-smoke-'))
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ['mcp/server.js'],
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, HOME: home, USERPROFILE: home, DSH_RESEARCH_KIT_HOME: path.join(home, 'data'), NODE_OPTIONS: '' },
  })
  client = new Client({ name: 'smoke-test', version: '0.1.0' })
  await client.connect(transport)
})

test.after(async () => {
  await client?.close()
  if (home) await rm(home, { recursive: true, force: true })
})

async function callTool(name, args) {
  const result = await client.callTool({ name, arguments: args })
  assert.equal(result.isError, undefined, `${name} 不应以 isError 返回`)
  return JSON.parse(result.content[0].text)
}

test('MCP 边界：server 能启动并注册全部工具', async () => {
  const { tools } = await client.listTools()
  assert.equal(tools.length, 31)
  for (const expected of ['research_help', 'research_catalog_search', 'research_literature_search', 'research_evidence_save', 'research_evidence_review', 'research_figure_generate', 'research_run_start', 'research_run_status', 'research_evidence_save_batch', 'research_evidence_grade_apply', 'research_usage_stats', 'research_run_checkpoint_approve', 'research_review_output']) {
    assert.ok(tools.some(tool => tool.name === expected), `缺少工具 ${expected}`)
  }
})

test('MCP 边界：工具 annotations 暴露只读、外呼与写入语义', async () => {
  const { tools } = await client.listTools()
  const readTool = tools.find(tool => tool.name === 'research_catalog_search')
  const writeTool = tools.find(tool => tool.name === 'research_evidence_save')
  const externalTool = tools.find(tool => tool.name === 'research_literature_search')
  assert.equal(readTool.annotations.readOnlyHint, true)
  assert.equal(readTool.annotations.openWorldHint, false)
  assert.equal(writeTool.annotations.readOnlyHint, false)
  assert.equal(writeTool.annotations.destructiveHint, false)
  assert.equal(externalTool.annotations.openWorldHint, true)
})

test('MCP 边界：结构化业务错误必须带 isError，且输出保持紧凑 JSON', async () => {
  const result = await client.callTool({ name: 'research_workflow_compose', arguments: { workflow_id: 'not-exists' } })
  assert.equal(result.isError, true)
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.error, true)
  assert.equal(parsed.code, 'TOOL_ERROR')
  assert.equal(result.content[0].text, JSON.stringify(parsed))
})

test('MCP 边界：research_catalog_search 命中中文查询，且 schema 默认值真的生效', async () => {
  const parsed = await callTool('research_catalog_search', { query: '审阅论文', limit: 2 })
  assert.ok(parsed.data.workflows.length > 0)
  assert.ok(parsed.data.workflows[0].id)
  assert.ok(parsed.meta.confidence)

  const defaulted = await callTool('research_catalog_search', {})
  assert.equal(defaulted.data.workflows.length, 10, 'limit 未传时应回落到 schema 默认的 10 条')
})

test('MCP 边界：research_help 为自然语言目标返回最短工具链', async () => {
  const parsed = await callTool('research_help', { goal: '我想找相关文献并保存关键来源' })
  assert.equal(parsed.data.recommended.id, 'literature')
  assert.equal(parsed.data.recommended.recommended_chain[0].tool, 'research_literature_search')
  assert.ok(parsed.data.available_routes.length >= 7)
})

test('MCP 边界：research_workflow_compose 产出可用 prompt', async () => {
  const { data } = await callTool('research_catalog_search', { query: '审阅论文', limit: 1 })
  const parsed = await callTool('research_workflow_compose', { workflow_id: data.workflows[0].id, params: { focus: '统计' } })
  assert.ok(parsed.data.prompt.length > 0)
})

test('MCP 边界：research_literature_search 可对不可直查来源如实降级', async () => {
  const parsed = await callTool('research_literature_search', { query: 'test query', source_ids: ['not-configured'] })
  assert.equal(parsed.data.total, 0)
  assert.equal(parsed.data.searched_sources[0].availability, 'requires-host-mcp')
  assert.equal(parsed.meta.confidence, 'api')
})

test('MCP 边界：research_evidence_review 在空项目中如实返回空盘点', async () => {
  const parsed = await callTool('research_evidence_review', { project: 'mcp-empty-review', run_id: 'run-empty-review' })
  assert.equal(parsed.data.summary.total, 0)
  assert.equal(parsed.data.summary.missing_traceability, 0)
  assert.ok(parsed.data.next_actions[0].includes('没有证据条目'))
})

test('MCP 边界：research_run_start 创建可追溯运行与 checkpoint 状态', async () => {
  const parsed = await callTool('research_run_start', {
    workflow_id: 'review-paper', project: 'mcp-start-test', run_id: 'run-smoke-start', current_stage: 'planning',
  })
  assert.equal(parsed.data.run_id, 'run-smoke-start')
  assert.equal(parsed.data.workflow.id, 'review-paper')
  assert.equal(parsed.data.checkpoint_state.run_id, 'run-smoke-start')
  assert.ok(parsed.data.passport.yaml.includes('run_id: run-smoke-start'))
  assert.ok(parsed.data.next_actions[0].includes('research_run_status'), 'run_start 应把 run_status 作为首选下一步')
})

test('MCP 边界：research_run_status 无 run_id 时列出最近运行', async () => {
  const parsed = await callTool('research_run_status', {})
  assert.ok(Array.isArray(parsed.data.runs), 'runs 应为数组')
  const started = parsed.data.runs.find(run => run.run_id === 'run-smoke-start')
  assert.ok(started, '先前启动的 run 应出现在列表中')
  assert.equal(started.project, 'mcp-start-test')
  assert.equal(started.current_stage, 'planning')
  assert.ok(parsed.data.next_actions.length > 0)
})

test('MCP 边界：research_run_status 汇总阶段、检查点与证据盘点', async () => {
  const parsed = await callTool('research_run_status', { run_id: 'run-smoke-start' })
  assert.equal(parsed.data.run_id, 'run-smoke-start')
  assert.equal(parsed.data.project, 'mcp-start-test')
  assert.equal(parsed.data.current_stage, 'planning')
  assert.ok(['active', 'waiting_review'].includes(parsed.data.status))
  assert.ok(Array.isArray(parsed.data.checkpoints.pending))
  assert.equal(parsed.data.evidence.total, 0, '尚无关联证据时应为 0')
  // 契约约定：空产物数组按需携带；该 run 无产物时字段可缺席
  if (parsed.data.artifacts !== undefined) assert.ok(Array.isArray(parsed.data.artifacts))
  assert.ok(parsed.data.next_actions.length > 0)
  assert.ok(parsed.meta.disclaimer.includes('不代表'))
})

test('MCP 边界：research_review_output 聚合多个审阅维度', async () => {
  const parsed = await callTool('research_review_output', {
    text: '在本研究中，我们初步的结果可能提示该干预有效，但样本量和统计方法尚未报告。众所周知，这一结论具有重要意义。'.repeat(3),
    max_claims: 1,
    run_id: 'run-smoke-review',
  })
  assert.ok(parsed.data.claims)
  assert.ok(parsed.data.anomalies)
  assert.ok(parsed.data.writing)
  assert.ok(parsed.data.hedging)
})

test('MCP 边界：research_evidence_save 后能被 research_evidence_list 读回', async () => {
  const saved = await callTool('research_evidence_save', {
    identifier_type: 'doi',
    identifier: '10.9999/smoke-test',
    title: 'MCP Smoke Test Entry',
    note: 'Automated smoke test',
    project: 'mcp-test',
  })
  assert.equal(saved.error, undefined, saved.message)

  const listed = await callTool('research_evidence_list', { project: 'mcp-test' })
  assert.equal(listed.data.entries.length, 1)
  assert.equal(listed.data.entries[0].identifier, '10.9999/smoke-test')
  assert.ok(existsSync(path.join(home, 'data', 'evidence', 'mcp-test', 'entries.jsonl')), 'DSH_RESEARCH_KIT_HOME 应重定向证据库')
})

test('MCP 边界：passport、checkpoint 与证据可复用同一研究运行 ID', async () => {
  const runId = 'run-smoke-link'
  const passport = await callTool('research_run_export', {
    run_id: runId, project: 'mcp-run-test', current_stage: 'screening', workflow_id: 'review-paper', completed: [{ stage: 'screening', tool: 'research_source_query', summary: '候选来源已取得' }],
  })
  assert.equal(passport.data.run_id, runId)
  assert.equal(passport.data.checkpoint_state.run_id, runId)
  await callTool('research_evidence_save', { identifier_type: 'doi', identifier: '10.9999/run-smoke', title: 'Run evidence', project: 'mcp-run-test', run_id: runId })
  const listed = await callTool('research_evidence_list', { project: 'mcp-run-test', run_id: runId })
  assert.equal(listed.data.entries.length, 1)
})
