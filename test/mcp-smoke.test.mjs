
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
  assert.equal(tools.length, 22)
  for (const expected of ['search_workflows', 'save_evidence', 'generate_figure', 'approve_checkpoint']) {
    assert.ok(tools.some(tool => tool.name === expected), `缺少工具 ${expected}`)
  }
})

test('MCP 边界：search_workflows 命中中文查询，且 schema 默认值真的生效', async () => {
  const parsed = await callTool('search_workflows', { query: '审阅论文', limit: 2 })
  assert.ok(parsed.data.workflows.length > 0)
  assert.ok(parsed.data.workflows[0].id)
  assert.ok(parsed.meta.confidence)

  const defaulted = await callTool('search_workflows', {})
  assert.equal(defaulted.data.workflows.length, 10, 'limit 未传时应回落到 schema 默认的 10 条')
})

test('MCP 边界：compose_workflow 产出可用 prompt', async () => {
  const { data } = await callTool('search_workflows', { query: '审阅论文', limit: 1 })
  const parsed = await callTool('compose_workflow', { workflow_id: data.workflows[0].id, params: { focus: '统计' } })
  assert.ok(parsed.data.prompt.length > 0)
})

test('MCP 边界：save_evidence 后能被 list_evidence 读回', async () => {
  const saved = await callTool('save_evidence', {
    identifier_type: 'doi',
    identifier: '10.9999/smoke-test',
    title: 'MCP Smoke Test Entry',
    note: 'Automated smoke test',
    project: 'mcp-test',
  })
  assert.equal(saved.error, undefined, saved.message)

  const listed = await callTool('list_evidence', { project: 'mcp-test' })
  assert.equal(listed.data.entries.length, 1)
  assert.equal(listed.data.entries[0].identifier, '10.9999/smoke-test')
})
