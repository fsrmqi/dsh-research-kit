
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

process.env.HOME = await mkdtemp(path.join(os.tmpdir(), 'dsh-ev-'))

const BASE_DIR = path.join(process.env.HOME, '.dsh-research-kit', 'evidence')

// 动态 import 以读取刚改的 BASE_DIR（测试目录隔离）
const { saveEvidence, listEvidence, mergeProjectEntries, readProjectEntries, deleteProjectEntry, assessEvidence, replaceProjectEntry, organizeEvidenceProjects, undoEvidenceProjectOrganization } = await import('../mcp/execution/evidence-store.js')

test.after(async () => {
  await rm(process.env.HOME, { recursive: true, force: true })
})

test('dedupKey：不同 pmcid 不应因标题相同而被误判为重复', async () => {
  const result1 = await saveEvidence({ project: 'dedup-probe', identifier_type: 'pmcid', identifier: 'PMC9876543', title: 'Same Title', source: 's' })
  assert.equal(result1.saved, true)
  const id1 = result1.id

  const result2 = await saveEvidence({ project: 'dedup-probe', identifier_type: 'pmcid', identifier: 'PMC1111111', title: 'Same Title', source: 's' })
  assert.equal(result2.saved, true, '第二篇不同的 PMCID 论文必须入库，不能因为标题相同被当作 duplicate')
  assert.notEqual(result2.id, id1)
})

test('dedupKey：url 与 none 类型也必须区分，避免空标题条目全部折叠到同一键', async () => {
  const a = await saveEvidence({ project: 'dedup-none', identifier_type: 'none', title: '', url: '', source: 's' })
  assert.equal(a.saved, true)
  const b = await saveEvidence({ project: 'dedup-none', identifier_type: 'none', title: '', url: '', source: 's' })
  assert.equal(b.saved, false) // 预期重复
  assert.equal(b.dedup_status, 'duplicate')
  // 但 url 不同时必须不重复
  const c = await saveEvidence({ project: 'dedup-url', identifier_type: 'url', identifier: '', url: 'https://example.org/a', source: 's' })
  assert.equal(c.saved, true)
  const d = await saveEvidence({ project: 'dedup-url', identifier_type: 'url', identifier: '', url: 'https://example.org/b', source: 's' })
  assert.equal(d.saved, true)
})

test('listEvidence：返回最新的 N 条，而不是最旧的 N 条', async () => {
  const project = 'list-order'
  for (let i = 0; i < 6; i++) {
    await saveEvidence({ project, identifier_type: 'doi', identifier: `10.9999/${i}`, title: `T${i}`, source: 's' })
    await new Promise(r => setTimeout(r, 10)) // 确保 saved_at 递增
  }
  const listed = await listEvidence({ project, limit: 3 })
  assert.equal(listed.entries.length, 3)
  // 最新三条应该是 doi 3,4,5（按写入时间顺序）
  const ids = listed.entries.map(e => e.identifier).sort()
  assert.ok(ids.includes('10.9999/5'), '应包含最后一条')
  assert.ok(ids.includes('10.9999/4'), '应包含倒数第二条')
})

test('run_id：可关联和筛选证据，但不改变同项目来源去重', async () => {
  const project = 'run-linked-evidence'
  await saveEvidence({ project, run_id: 'run-alpha', identifier_type: 'doi', identifier: '10.9999/run-linked', title: 'Run linked' })
  const duplicate = await saveEvidence({ project, run_id: 'run-beta', identifier_type: 'doi', identifier: '10.9999/run-linked', title: 'Run linked again' })
  assert.equal(duplicate.saved, false, '运行关联不能绕过同项目证据去重')
  const listed = await listEvidence({ project, run_id: 'run-alpha' })
  assert.equal(listed.entries.length, 1)
  assert.equal(listed.entries[0].run_id, 'run-alpha')
  assert.equal((await listEvidence({ project, run_id: 'run-beta' })).entries.length, 0)
})

test('assessEvidence：人工评估更新五个维度并保留兼容 grade/status', async () => {
  const project = 'manual-assessment'
  const saved = await saveEvidence({ project, identifier_type: 'doi', identifier: '10.9999/assessment', title: 'Assessment' })
  const entry = await assessEvidence(saved.id, project, {
    traceability: 'identified', source_verification: 'verified', study_type: 'primary-study', claim_support: 'mixed', strength: 'empirical',
    assessed_by: 'reviewer', assessment_reason: '全文已核对',
  })
  assert.equal(entry.status, 'verified')
  assert.equal(entry.grade, 'empirical')
  assert.equal(entry.claim_support, 'mixed')
  assert.equal(entry.assessed_by, 'reviewer')
  assert.ok(entry.assessed_at)
})

test('replaceProjectEntry：只按 ID 更新，保留原有字段与 Agent 历史，不覆盖同来源其他条目', async () => {
  const project = 'replace-assessment'
  const saved = await saveEvidence({ project, identifier_type: 'doi', identifier: '10.9999/replace', title: '研究来源' })
  const result = await replaceProjectEntry(project, {
    id: saved.id, project, agent_assessment: { reason: '元数据初判', at: 123 },
    agent_assessment_history: [{ reason: '前次初判', at: 100 }],
  })
  assert.equal(result.updated, true)
  const rows = await readProjectEntries(project)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].identifier, '10.9999/replace')
  assert.equal(rows[0].agent_assessment.reason, '元数据初判')
  assert.equal(rows[0].agent_assessment_history.length, 1)
  assert.equal((await replaceProjectEntry(project, { id: 'missing', project })).updated, false)
})

test('项目整理：先检查目标冲突；成功后保留原项目并可按快照撤销', async () => {
  const from = 'concurrency-test-organize'
  const to = '测试与演示（归档）'
  await saveEvidence({ project: from, identifier_type: 'doi', identifier: '10.9999/organize-a', title: 'A' })
  const moved = await organizeEvidenceProjects([{ from, to }])
  assert.equal(moved.moved, 1)
  assert.equal((await readProjectEntries(from)).length, 0)
  const target = await readProjectEntries(to)
  assert.equal(target.length, 1)
  assert.equal(target[0].legacy_project, from)
  assert.equal(target[0].workspace_id, `workspace:${encodeURIComponent(to)}`)
  await assert.rejects(() => organizeEvidenceProjects([{ from, to }]), /已有可撤销/)
  await undoEvidenceProjectOrganization(moved.id)
  assert.equal((await readProjectEntries(from)).length, 1)
  assert.equal((await readProjectEntries(to)).length, 0)
})

test('项目整理：目标已有同 DOI 时拒绝，源项目保持原样', async () => {
  const from = 'dedup-probe-organize'
  const to = 'conflict-target'
  await saveEvidence({ project: from, identifier_type: 'doi', identifier: '10.9999/conflict', title: '来源' })
  await saveEvidence({ project: to, identifier_type: 'doi', identifier: '10.9999/conflict', title: '已有来源' })
  await assert.rejects(() => organizeEvidenceProjects([{ from, to }]), /重复 ID 或来源/)
  assert.equal((await readProjectEntries(from)).length, 1)
  assert.equal((await readProjectEntries(to)).length, 1)
})

test('mergeProjectEntries：无法解析的 JSONL 行不应永久丢失', async () => {
  const project = 'parse-error'
  // 先正常入库一条
  await saveEvidence({ project, identifier_type: 'doi', identifier: '10.9999/ok', title: 'OK', source: 's' })
  // 模拟撕裂：直接往 entries.jsonl 追加一行非法 JSON
  const fs = await import('node:fs/promises')
  const file = path.join(BASE_DIR, project, 'entries.jsonl')
  await fs.appendFile(file, 'not json\n', 'utf8')
  // 再读回来时不应抛错，且合法的那条还在
  const rows = await readProjectEntries(project)
  assert.ok(rows.some(r => r.identifier === '10.9999/ok'), '合法条目必须保留')
  // 非法行不应导致全量重写丢失数据
  const listed = await listEvidence({ project })
  assert.equal(listed.total, 1)
})

test('并发写入：锁内全量原子写不得丢条目', async () => {
  const project = 'concurrent-write'
  const rs = await Promise.all(
    Array.from({ length: 25 }).map((_, i) =>
      saveEvidence({ project, identifier_type: 'doi', identifier: `10.9999/cw-${i}`, title: `C${i}`, source: 's' }),
    ),
  )
  const ok = rs.filter(r => r.saved !== false || r.dedup_status === 'new').length
  assert.equal(ok, 25, '25 个并发写入必须全部落盘')
  const listed = await listEvidence({ project })
  assert.equal(listed.total, 25)
})
