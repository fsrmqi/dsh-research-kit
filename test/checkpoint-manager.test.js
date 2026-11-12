
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// checkpoint-manager 在 import 时就固化 CHECKPOINT_DIR = ~/.dsh-research-kit/checkpoints，
// 所以必须先改 HOME 再动态 import，否则测试会写进用户真实目录。
process.env.HOME = await mkdtemp(path.join(os.tmpdir(), 'dsh-ckpt-'))

const {
  initializeCheckpoints,
  recordApproval,
  getCheckpointState,
  explainRun,
} = await import('../mcp/state/checkpoint-manager.js')

const checkpointDir = path.join(process.env.HOME, '.dsh-research-kit', 'checkpoints')
const stateFile = runId => path.join(checkpointDir, `${runId}.json`)
const factsFile = runId => path.join(checkpointDir, `${runId}.facts.jsonl`)

const threeStageWorkflow = {
  checkpoints: [
    { after_stage: 'screening', action: 'review_sources', required: true },
    { after_stage: 'synthesis', action: 'human_review', required: true },
    { after_stage: 'drafting', action: 'final_check', required: true },
  ],
}

test.after(async () => {
  await rm(process.env.HOME, { recursive: true, force: true })
})

test('检查点：并发批准不得互相覆盖——人工闸门是安全机制，丢一条就等于没批', async () => {
  const runId = 'concurrent-approve'
  await initializeCheckpoints(runId, threeStageWorkflow, ['screening', 'synthesis', 'drafting'])

  const results = await Promise.all(
    ['screening', 'synthesis', 'drafting'].map(stage => recordApproval(runId, stage, { note: 'ok' })),
  )
  assert.equal(results.filter(r => r.approved).length, 3, '三次批准都应成功')

  const state = await getCheckpointState(runId)
  assert.deepEqual(
    [...state.approved].sort(),
    ['drafting', 'screening', 'synthesis'],
    '三次批准都必须落盘，不能只剩最后写入的那条',
  )
  assert.deepEqual(state.pending, [])
})

test('检查点：并发初始化不得丢检查点', async () => {
  const runId = 'concurrent-init'
  await Promise.all([
    initializeCheckpoints(runId, threeStageWorkflow, ['screening', 'synthesis', 'drafting']),
    initializeCheckpoints(runId, threeStageWorkflow, ['screening', 'synthesis', 'drafting']),
  ])
  const state = await getCheckpointState(runId)
  assert.deepEqual([...state.pending].sort(), ['drafting', 'screening', 'synthesis'])
})

test('检查点：状态文件损坏必须报错，不能静默当作"无待批项"放行', async () => {
  const runId = 'corrupt-state'
  await initializeCheckpoints(runId, threeStageWorkflow, ['screening'])
  const good = await readFile(stateFile(runId), 'utf8')
  await writeFile(stateFile(runId), good.slice(0, Math.floor(good.length / 2)))

  await assert.rejects(
    () => getCheckpointState(runId),
    /损坏|corrupt|无法解析/i,
    '撕裂的状态文件若被当成空状态，闸门会失败即放行',
  )
})

test('检查点：状态文件损坏时批准操作报"状态损坏"而非"检查点不存在"', async () => {
  const runId = 'corrupt-approve'
  await initializeCheckpoints(runId, threeStageWorkflow, ['screening'])
  await writeFile(stateFile(runId), '{"run_id":"corrupt-approve","checkpoints":{')

  await assert.rejects(
    () => recordApproval(runId, 'screening', {}),
    error => {
      assert.notEqual(error.code, 'CHECKPOINT_NOT_FOUND', '损坏不该伪装成"检查点不存在"，否则该 run 永久无法批准')
      return true
    },
  )
})

test('检查点：全新 run（无状态文件）仍是合法的"无闸门"，不该报错', async () => {
  const state = await getCheckpointState('never-initialized')
  assert.deepEqual(state.pending, [])
  assert.deepEqual(state.approved, [])
  assert.deepEqual(state.checkpoints, {})
})

test('检查点：run_id 不匹配的状态文件视为损坏，不得当作当前 run 的空状态', async () => {
  const runId = 'mismatched-run'
  await initializeCheckpoints(runId, threeStageWorkflow, ['screening'])
  await writeFile(stateFile(runId), JSON.stringify({ run_id: 'someone-else', checkpoints: { screening: { approved: true } } }))

  await assert.rejects(() => getCheckpointState(runId), /损坏|corrupt|不匹配/i)
})

test('检查点：同内容重复批准是幂等的——重试不该让「放行过几次」失真', async () => {
  const runId = 'idempotent-approve'
  await initializeCheckpoints(runId, threeStageWorkflow, ['screening'])
  const first = await recordApproval(runId, 'screening', { note: 'ok', evidence_ids: ['E1'] })
  const before = (await getCheckpointState(runId)).seq
  const retry = await recordApproval(runId, 'screening', { note: 'ok', evidence_ids: ['E1'] })

  assert.equal(retry.idempotent, true, '同内容重试必须被识别为幂等')
  assert.equal(retry.seq, before, '幂等重试不推进 seq')
  assert.equal(first.fact_seq, retry.seq, '重试返回的 seq 应指向第一次落盘的事实')
  assert.deepEqual((await getCheckpointState(runId)).approved, ['screening'])
})

test('检查点：不同内容再次批准追加事实，次数单独计数——审计要能看出放过两次', async () => {
  const runId = 'reapprove'
  await initializeCheckpoints(runId, threeStageWorkflow, ['screening'])
  const first = await recordApproval(runId, 'screening', { note: '第一次' })
  const second = await recordApproval(runId, 'screening', { note: '改了结论再放行' })

  assert.equal(first.attempt, 1)
  assert.equal(second.attempt, 2, 'attempt 按关计次，不与全局 seq 混同')
  const state = await getCheckpointState(runId)
  assert.equal(state.seq, 3, '初始化 + 两次放行 = 三条事实')
  assert.deepEqual(state.approved, ['screening'])
})

test('检查点：用过期 seq 提交必须冲突——不能用旧快照覆盖别人的放行', async () => {
  const runId = 'stale-write'
  await initializeCheckpoints(runId, threeStageWorkflow, ['screening'])
  const stale = (await getCheckpointState(runId)).seq
  await recordApproval(runId, 'screening', { note: '先到的一笔' })

  await assert.rejects(
    () => recordApproval(runId, 'screening', { note: '拿旧 seq 来的', expected_seq: stale }),
    error => {
      assert.equal(error.code, 'CHECKPOINT_CONFLICT')
      assert.equal(error.expected_seq, stale)
      assert.equal(error.current_seq, stale + 1)
      return true
    },
  )
})

test('检查点：投影丢失或落后时按事实恢复——崩溃在「事实已落盘、投影未写」之间不该丢闸门', async () => {
  const runId = 'crash-recover'
  await initializeCheckpoints(runId, threeStageWorkflow, ['screening'])
  await recordApproval(runId, 'screening', { note: '已放行' })
  await unlink(stateFile(runId))

  const recovered = await getCheckpointState(runId)
  assert.deepEqual(recovered.approved, ['screening'], '投影丢了也必须从事实里恢复出放行状态')
  assert.equal(recovered.seq, 2)
})

test('检查点：事实日志被改过必须报错——摘要链是投影的信任前提', async () => {
  const runId = 'tampered-facts'
  await initializeCheckpoints(runId, threeStageWorkflow, ['screening'])
  await recordApproval(runId, 'screening', { note: 'ok' })
  const lines = (await readFile(factsFile(runId), 'utf8')).trim().split('\n')
  const tampered = lines.map((line, index) => index === 1
    ? line.replace('"stage":"screening"', '"stage":"drafting"')
    : line)
  await writeFile(factsFile(runId), `${tampered.join('\n')}\n`)

  await assert.rejects(() => getCheckpointState(runId), /损坏|corrupt|摘要/i)
})

test('run-why：能按事实解释每一次推进，且投影与事实一致', async () => {
  const runId = 'why'
  await initializeCheckpoints(runId, threeStageWorkflow, ['screening', 'synthesis'])
  await recordApproval(runId, 'screening', { note: '过了' })
  await recordApproval(runId, 'synthesis', { note: '也过了' })

  const why = await explainRun(runId)
  assert.equal(why.consistent, true)
  assert.equal(why.fact_count, 4, '两次初始化 + 两次放行')
  assert.deepEqual(why.events.map(event => event.stage), ['screening', 'synthesis', 'screening', 'synthesis'])
  assert.deepEqual(why.events.map(event => event.seq), [1, 2, 3, 4])
  const approvals = why.events.filter(event => event.type === 'checkpoint.approved')
  assert.equal(approvals.length, 2)
  assert.ok(approvals.every(event => event.receipt_digest), '每条放行都要留下可核对的摘要')
  assert.ok(why.events.filter(event => event.type === 'checkpoint.initialized').every(event => event.attempt === 1))
})

test('检查点：旧版只有投影的 run 首次写事实时不被覆盖——升级不能把已放行的闸门丢掉', async () => {
  const runId = 'legacy-projection'
  const legacy = {
    run_id: runId,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    checkpoints: {
      screening: { approved: true, approved_by: 'user', approved_at: '2026-01-01T00:00:00.000Z' },
      synthesis: { approved: false, action: 'human_review', required: true },
    },
  }
  await writeFile(stateFile(runId), JSON.stringify(legacy))

  // 升级后第一次写事实：追加新闸门之前，老条目要先补成事实。
  await recordApproval(runId, 'synthesis', { note: '升级后放行' })
  const state = await getCheckpointState(runId)
  assert.deepEqual([...state.approved].sort(), ['screening', 'synthesis'], '老版本已放行的闸门必须保留')

  const why = await explainRun(runId)
  assert.deepEqual(why.events.map(event => event.stage), ['screening', 'synthesis', 'synthesis'])
  assert.equal(why.events[0].type, 'checkpoint.approved', '补录要保留原来的已放行语义')
})
