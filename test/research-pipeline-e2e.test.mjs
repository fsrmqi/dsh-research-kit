
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// 端到端研究旅程：启动 run → 状态总览 → 检索 → 保存 → 盘点 → 审阅 → 交接。
// 与 mcp-smoke.test.mjs 相同的沙箱模式：HOME 重定向，避免污染真实 ~/.dsh-research-kit。
let home
let client
let transport

test.before(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'dsh-pipeline-e2e-'))
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ['mcp/server.js'],
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, HOME: home, USERPROFILE: home, NODE_OPTIONS: '' },
  })
  client = new Client({ name: 'pipeline-e2e', version: '0.1.0' })
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

const RUN_ID = 'run-pipeline-e2e'
const PROJECT = 'pipeline-e2e'

test('研究旅程：启动 run 并通过 run_status 看到阶段与检查点', async () => {
  const started = await callTool('research_run_start', {
    workflow_id: 'review-paper',
    project: PROJECT,
    run_id: RUN_ID,
    current_stage: 'literature_search',
  })
  assert.equal(started.data.run_id, RUN_ID)
  assert.equal(started.data.workflow.id, 'review-paper')
  // 统一契约：聚合入口返回 next_actions 而非静态 recommended_tools
  assert.ok(Array.isArray(started.data.next_actions) && started.data.next_actions.length > 0)
  assert.ok(started.meta.source)

  const status = await callTool('research_run_status', { run_id: RUN_ID })
  assert.equal(status.data.run_id, RUN_ID)
  assert.equal(status.data.project, PROJECT)
  assert.equal(status.data.current_stage, 'literature_search')
  assert.equal(status.data.workflow.id, 'review-paper', '护照应携带 workflow_id')
  assert.equal(status.data.status, 'active', '尚无 pending checkpoint 时应为 active')
  assert.equal(status.data.evidence.total, 0, '启动后还没有证据')
  assert.ok(status.data.next_actions.some(action => action.includes('research_literature_search')),
    '空证据时应建议先检索')
})

test('研究旅程：检索（不可配置来源如实降级）→ 显式保存 → 盘点出现该证据', async () => {
  const search = await callTool('research_literature_search', {
    query: 'sleep deprivation memory',
    source_ids: ['not-configured'],
    run_id: RUN_ID,
  })
  assert.equal(search.data.total, 0, '不可配置来源应如实降级为 0 条')
  assert.equal(search.data.searched_sources[0].availability, 'requires-host-mcp')

  const saved = await callTool('research_evidence_save', {
    identifier_type: 'doi',
    identifier: '10.9999/pipeline-e2e',
    title: 'Pipeline E2E Evidence',
    project: PROJECT,
    run_id: RUN_ID,
  })
  assert.equal(saved.error, undefined, saved.message)

  const status = await callTool('research_run_status', { run_id: RUN_ID })
  assert.equal(status.data.evidence.total, 1, 'run_status 应能看到 run 关联的证据')
  assert.ok(status.data.evidence.unverified >= 1, '新保存的证据默认未核验')
})

test('研究旅程：证据盘点与 run_status 的盘点口径一致', async () => {
  const review = await callTool('research_evidence_review', { project: PROJECT, run_id: RUN_ID })
  const status = await callTool('research_run_status', { run_id: RUN_ID })
  assert.equal(review.data.summary.total, status.data.evidence.total)
  assert.equal(review.data.summary.missing_traceability, status.data.evidence.missing_traceability)
  assert.equal(review.data.summary.unverified, status.data.evidence.unverified)
  assert.ok(review.data.next_actions.length > 0)
})

test('研究旅程：聚合审阅产出产物，run_status 投影出最近产物', async () => {
  const review = await callTool('research_review_output', {
    text: '本研究初步结果显示干预可能有效，但样本量与统计方法尚未报告，结论仍有待验证。'.repeat(4),
    max_claims: 5,
    run_id: RUN_ID,
  })
  assert.ok(review.data.claims)
  assert.ok(review.data.anomalies)
  assert.ok(review.data.writing)
  assert.ok(review.data.hedging)

  const status = await callTool('research_run_status', { run_id: RUN_ID })
  const kinds = status.data.artifacts.map(artifact => artifact.kind)
  assert.ok(kinds.includes('review-report'), 'run_status 的产物投影应包含综合审阅')
})

test('研究旅程：导出护照交接，run_status 保持可查', async () => {
  const exported = await callTool('research_run_export', {
    run_id: RUN_ID,
    project: PROJECT,
    current_stage: 'synthesis',
    workflow_id: 'review-paper',
    completed: [{ stage: 'literature_search', tool: 'research_literature_search', summary: '候选来源已保存' }],
  })
  assert.equal(exported.data.run_id, RUN_ID)
  assert.ok(exported.data.passport_yaml || exported.data.file_path)

  const status = await callTool('research_run_status', { run_id: RUN_ID })
  assert.equal(status.data.current_stage, 'synthesis', '导出后的阶段应反映在总览中')
  assert.ok(['active', 'waiting_review'].includes(status.data.status))
})

test('研究旅程：无 run_id 的 run_status 列出该 run 摘要', async () => {
  const listed = await callTool('research_run_status', {})
  const row = listed.data.runs.find(run => run.run_id === RUN_ID)
  assert.ok(row, '刚跑完整条链的 run 应出现在最近运行列表')
  assert.equal(row.project, PROJECT)
  assert.equal(row.workflow_id, 'review-paper')
  assert.ok(row.pending_checkpoints !== null, '该工作流建过 checkpoint，应能报告 pending 数')
})
