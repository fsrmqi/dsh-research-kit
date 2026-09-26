import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEvidenceEntry } from '../src/lib/evidence-vault-core.js'
import { fileEvidenceInput, vaultEvidenceFileEntry, evidenceSyncKey } from '../src/research-evidence-vault.js'

test('未归属证据文件往返不变成 default 课题，去重键一致', () => {
  const original = normalizeEvidenceEntry({ title: '待归属来源', identifier: '10.1000/unassigned', project: '' })
  const file = vaultEvidenceFileEntry(original)
  assert.equal(file.project, 'default')
  assert.equal(file.workspace_id, 'workspace:unassigned')
  const restored = normalizeEvidenceEntry(fileEvidenceInput(file))
  assert.equal(restored.project, '')
  assert.equal(restored.workspaceId, 'workspace:unassigned')
  assert.equal(evidenceSyncKey(original), evidenceSyncKey(file))
})

test('没有 workspace_id 的旧 default 项目保持为真实旧项目', () => {
  const restored = normalizeEvidenceEntry(fileEvidenceInput({ title: '旧来源', identifier: '10.1000/default', project: 'default' }))
  assert.equal(restored.project, 'default')
  assert.notEqual(restored.workspaceId, 'workspace:unassigned')
})

test('区分大小写不同的课题键，同一 DOI 不应跨课题误去重', () => {
  const a = { project: 'Barley', identifierKind: 'doi', identifier: '10.1000/same' }
  const b = { project: 'barley', identifierKind: 'doi', identifier: '10.1000/same' }
  assert.notEqual(evidenceSyncKey(a), evidenceSyncKey(b))
})
