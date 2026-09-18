
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// MCP 工具会往 ~/.dsh-research-kit 写证据库与调用日志，测试必须落到沙箱目录，
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
    env: { ...process.env, HOME: home, USERPROFILE: home, NODE_OPTIONS: '' },
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
  assert.equal(tools.length, 26)
  for (const expected of ['research_catalog_search', 'research_literature_search', 'research_evidence_save', 'research_evidence_review', 'research_figure_generate', 'research_run_start', 'research_run_checkpoint_approve', 'research_review_output']) {
    assert.ok(tools.some(tool => tool.name === expected), `缺少工具 ${expected}`)
  }
})

test('MCP 边界：research_catalog_search 命中中文查询，且 schema 默认值真的生效', async () => {
  const parsed = await callTool('research_catalog_search', { query: '审阅论文', limit: 2 })
  assert.ok(parsed.data.workflows.length > 0)
  assert.ok(parsed.data.workflows[0].id)
  assert.ok(parsed.meta.confidence)

  const defaulted = await callTool('research_catalog_search', {})
  assert.equal(defaulted.data.workflows.length, 10, 'limit 未传时应回落到 schema 默认的 10 条')
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
