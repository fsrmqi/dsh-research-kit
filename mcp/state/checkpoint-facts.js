// 检查点事实日志：同一 run 的每次状态推进只追加一行，投影（<run_id>.json）由重放算出。
//
// 为什么不是直接覆盖投影：投影是给 run-overview、MCP 工具和人工闸门读的快照，
// 覆盖写会丢掉「谁在什么时候放行了哪一关、这一关被放行过几次」。
// 事实行自带 seq 与前一条的摘要，形成可校验的链；投影损坏或落后时按事实重放即可。
//
// 与 checkpoint-manager 的分工：本模块只管「写一行 / 读全部 / 重放」，
// 校验、加锁与快照落盘仍由 checkpoint-manager 负责（它持有 run 文件锁）。

import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { dataPath } from '../paths.js'

const FACT_VERSION = 1
const FACT_DIR = dataPath('checkpoints')
// 与 Material Passport 的 run_id 契约一致：允许点号，拒绝路径分隔符。
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/

function assertId(value, label) {
  if (!ID_PATTERN.test(String(value || ''))) throw new Error(`${label} 不合法。`)
}

function factsFile(runId) {
  assertId(runId, 'run_id')
  return path.join(FACT_DIR, `${runId}.facts.jsonl`)
}

// 稳定序列化：摘要必须与键序无关，否则同一份事实在不同进程里算出两个值。
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

// 一行事实的摘要：把自己除 digest 外的全部字段算进去，任何字段被改都会对不上。
function factDigest(fact) {
  const { digest: _ignored, ...rest } = fact
  return digest(rest)
}

function factsCorruptError(runId, detail, cause) {
  const error = new Error(
    `检查点事实日志已损坏（run ${runId}）：${detail}。事实是投影的权威来源，` +
    `拒绝按不可信的日志恢复；请检查 ${factsFile(runId)}。`,
  )
  error.code = 'CHECKPOINT_FACTS_CORRUPT'
  error.cause = cause
  return error
}

// 读全部事实并校验链。只容忍「最后一行没写完整」——那是进程在追加时被强杀的常态；
// 中间的坏行意味着日志被外部改过，必须报错而不是跳过。
async function readFacts(runId) {
  assertId(runId, 'run_id')
  const file = factsFile(runId)
  if (!existsSync(file)) return { run_id: runId, facts: [], truncated: false, exists: false }
  const raw = await readFile(file, 'utf8')
  const lines = raw.split('\n')
  const facts = []
  let truncated = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    let fact
    try {
      fact = JSON.parse(line)
    } catch (cause) {
      const isLast = lines.slice(index + 1).every(rest => !rest.trim())
      if (isLast) { truncated = true; break }
      throw factsCorruptError(runId, `第 ${index + 1} 行不是合法 JSON`, cause)
    }
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) {
      throw factsCorruptError(runId, `第 ${index + 1} 行不是对象`)
    }
    facts.push(fact)
  }
  facts.forEach((fact, index) => {
    const expectedSeq = index + 1
    if (fact.seq !== expectedSeq) {
      throw factsCorruptError(runId, `第 ${index + 1} 行的 seq 是 ${fact.seq}，应为 ${expectedSeq}`)
    }
    if (factDigest(fact) !== fact.digest) {
      throw factsCorruptError(runId, `第 ${expectedSeq} 行的摘要对不上（内容被改过）`)
    }
    const prev = index === 0 ? null : facts[index - 1].digest
    if ((fact.prev_digest ?? null) !== prev) {
      throw factsCorruptError(runId, `第 ${expectedSeq} 行的前序摘要对不上（链断裂）`)
    }
  })
  return { run_id: runId, facts, truncated, exists: true }
}

async function appendFact(runId, fact) {
  assertId(runId, 'run_id')
  await mkdir(FACT_DIR, { recursive: true })
  await appendFile(factsFile(runId), `${JSON.stringify(fact)}\n`, 'utf8')
}

// 按事实重放出一份完整投影。重放是纯函数：同一串事实永远得到同一份状态，
// 这是「投影落后或丢失时能恢复」的前提，也是 run-why 能解释每一次推进的依据。
function replayFacts(runId, facts) {
  const state = { run_id: runId, checkpoints: {}, created_at: null, updated_at: null, seq: 0, replayed_from: null }
  for (const fact of facts) {
    if (fact.run_id !== runId) {
      throw factsCorruptError(runId, `第 ${fact.seq} 行属于 run ${JSON.stringify(fact.run_id)}`)
    }
    state.created_at = state.created_at || fact.at
    state.updated_at = fact.at
    state.seq = fact.seq
    state.replayed_from = fact.seq
    if (fact.type === 'checkpoint.initialized' || fact.type === 'checkpoint.approved') {
      const stage = String(fact.stage)
      state.checkpoints[stage] = { ...(state.checkpoints[stage] || {}), ...(fact.data || {}) }
    }
  }
  return state
}

// 构造一行事实：给 checkpoint-manager 用，避免摘要与链的细节散落在调用方。
function makeFact({ runId, seq, type, stage, data, receiptDigest, prevDigest, at, attempt }) {
  const fact = {
    version: FACT_VERSION,
    seq,
    run_id: runId,
    type,
    stage: String(stage),
    at,
    // attempt 是「这一关被决定过几次」，与全局 seq 不同：别的关推进不该改变它的次数。
    attempt: Number.isInteger(attempt) ? attempt : seq,
    decided_at: at,
    receipt_digest: receiptDigest || null,
    prev_digest: prevDigest || null,
    replayed_from: null,
    data: data || {},
  }
  return { ...fact, digest: factDigest(fact) }
}

export {
  appendFact,
  digest,
  factDigest,
  factsFile,
  makeFact,
  readFacts,
  replayFacts,
}
