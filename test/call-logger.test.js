import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('readCallLogs 合并轮转日志与当前日志，并保持时间序', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'dsh-call-logger-'))
  process.env.DSH_RESEARCH_KIT_HOME = path.join(home, 'data')
  const { readCallLogs } = await import('../mcp/execution/call-logger.js')
  const logDir = path.join(home, 'data', 'logs')
  await mkdir(logDir, { recursive: true })
  await writeFile(path.join(logDir, 'calls.jsonl.1'), [
    JSON.stringify({ tool: 'research_help', run_id: 'run-rotated', at: '2026-01-01T00:00:00.000Z', ok: true }),
  ].join('\n') + '\n')
  await writeFile(path.join(logDir, 'calls.jsonl'), [
    JSON.stringify({ tool: 'research_run_start', run_id: 'run-current', at: '2026-01-02T00:00:00.000Z', ok: true }),
  ].join('\n') + '\n')

  const records = await readCallLogs({ limit: 10 })
  assert.deepEqual(records.map(record => record.run_id), ['run-current', 'run-rotated'])
  const filtered = await readCallLogs({ limit: 10, runId: 'run-rotated' })
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].tool, 'research_help')
  await rm(home, { recursive: true, force: true })
  delete process.env.DSH_RESEARCH_KIT_HOME
})
