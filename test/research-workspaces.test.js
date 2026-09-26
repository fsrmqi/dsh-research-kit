import test from 'node:test'
import assert from 'node:assert/strict'
import { installFakeIndexedDB } from './helpers/fake-indexeddb.js'
import { createEvidenceVaultStore } from '../src/evidence-vault-store.js'
import { normalizeEvidenceEntry } from '../src/lib/evidence-vault-core.js'
import { workspaceIdForProject } from '../src/lib/research-workspaces.js'

test('课题 ID 由不可变兼容键决定，中文名称不会碰撞；未归属有固定 ID', () => {
  assert.notEqual(workspaceIdForProject('大麦雄性不育'), workspaceIdForProject('水稻雄性不育'))
  assert.equal(workspaceIdForProject(''), 'workspace:unassigned')
  const entry = normalizeEvidenceEntry({ title: '论文', identifier: '10.1000/workspace', project: '大麦雄性不育' })
  assert.equal(entry.workspaceId, workspaceIdForProject('大麦雄性不育'))
})

test('课题显示名可改且 ID 不变，归档不删除数据；新建空课题跨 store 可读', async () => {
  const fake = installFakeIndexedDB()
  try {
    const store = createEvidenceVaultStore()
    const created = await store.createWorkspace('大麦雄性不育')
    assert.equal((await createEvidenceVaultStore().listWorkspaces()).length, 1)
    await store.save({ title: 'NP1', identifier: '10.1000/np1', project: created.projectKey })
    const renamed = await store.renameWorkspace(created.projectKey, '大麦生殖发育')
    assert.equal(renamed.id, created.id)
    assert.equal(renamed.projectKey, '大麦雄性不育')
    assert.equal((await store.list({ project: created.projectKey })).length, 1)
    await store.setWorkspaceArchived(created.projectKey, true)
    assert.equal((await store.listWorkspaces()).length, 0)
    assert.equal((await store.listWorkspaces({ includeArchived: true }))[0].name, '大麦生殖发育')
    assert.equal((await store.list({ project: created.projectKey })).length, 1)
    await store.setWorkspaceArchived(created.projectKey, false)
    assert.equal((await store.listWorkspaces()).length, 1)
  } finally { fake.restore() }
})

test('旧证据项目只生成虚拟课题，不从临时研究运行自动派生', async () => {
  const fake = installFakeIndexedDB()
  try {
    const store = createEvidenceVaultStore()
    await store.save({ title: '旧来源', identifier: '10.1000/old', project: 'barley-NP1-IPE1-family' })
    const raw = fake.fake._databases.get('dsh-research-kit-evidence').stores.get('evidence')
    const previous = [...raw.values()][0]
    raw.set(previous.id, (({ workspaceId, ...row }) => row)(previous)) // 模拟 v5 旧条目尚无 workspaceId。
    assert.equal((await createEvidenceVaultStore().list())[0].workspaceId, workspaceIdForProject('barley-NP1-IPE1-family'))
    const spaces = await store.listWorkspaces()
    assert.deepEqual(spaces.map(item => item.projectKey), ['barley-NP1-IPE1-family'])
    assert.equal(spaces[0].origin, 'legacy')
    assert.equal(spaces[0].id, workspaceIdForProject('barley-NP1-IPE1-family'))
  } finally { fake.restore() }
})

test('课题备份增量恢复不覆盖现有名称或归档状态', async () => {
  const fake = installFakeIndexedDB()
  try {
    const store = createEvidenceVaultStore()
    const original = await store.createWorkspace('稳定课题')
    const renamed = await store.renameWorkspace(original.projectKey, '新的显示名')
    assert.equal(await store.importWorkspaces([original]), 0)
    assert.equal((await store.listWorkspaces())[0].name, renamed.name)
    const archived = { id: workspaceIdForProject('旧课题'), projectKey: '旧课题', name: '旧课题', archived: true, origin: 'legacy' }
    assert.equal(await store.importWorkspaces([archived]), 1)
    assert.equal((await createEvidenceVaultStore().listWorkspaces({ includeArchived: true })).length, 2)
    await assert.rejects(store.importWorkspaces([{ ...archived, id: 'wrong', projectKey: '另一个课题' }]), /ID/)
  } finally { fake.restore() }
})
