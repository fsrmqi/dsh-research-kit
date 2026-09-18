
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// checkpoint-manager 在 import 时就固化 CHECKPOINT_DIR = ~/.dsh-research-kit/checkpoints，
// 所以必须先改 HOME 再动态 import，否则测试会写进用户真实目录。
process.env.HOME = await mkdtemp(path.join(os.tmpdir(), 'dsh-ckpt-'))

const {
  initializeCheckpoints,
  recordApproval,
  getCheckpointState,
} = await import('../mcp/state/checkpoint-manager.js')

const stateFile = runId => path.join(process.env.HOME, '.dsh-research-kit', 'checkpoints', `${runId}.json`)

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
