import { buildProjectOrganizationPlan } from './lib/project-organizer.js'
import { knowledgeStore } from './knowledge-store.js'
import { listResearchRuns, remapResearchRuns, restoreResearchRuns } from './research-context-store.js'

const PROJECT_ORGANIZER_PATH = '/dsh-research-kit/evidence-sync'

async function projectOrganizerRequest(body) {
  const response = await fetch(PROJECT_ORGANIZER_PATH, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.ok) throw new Error(payload.error || `项目整理服务失败：HTTP ${response.status}`)
  return payload
}

export async function recoverProjectOrganizationJournal(store) {
  const local = await store.readOrganizerJournal()
  if (!local || local.fileId || local.status !== 'preparing') return local
  const response = await fetch(`${PROJECT_ORGANIZER_PATH}?organizer=last`, { signal: AbortSignal.timeout(5_000) })
  const payload = await response.json()
  const remote = payload?.journal
  if (!response.ok || !payload?.ok) throw new Error('无法检查上次项目整理状态。')
  if (!remote) return store.writeOrganizerJournal({ ...local, status: 'failed' })
  if (JSON.stringify(remote.mappings) !== JSON.stringify(local.mappings)) throw new Error('文件侧整理记录与浏览器记录不一致；已停止自动恢复。')
  if (!['applying', 'applied'].includes(remote.status)) return store.writeOrganizerJournal({ ...local, status: 'failed' })
  return store.writeOrganizerJournal({ ...local, status: 'file', fileId: remote.id })
}

export async function finalizeProjectOrganization(store) {
  const journal = await store.readOrganizerJournal()
  if (!journal?.fileId || journal.status !== 'applied') throw new Error('没有待保留的项目整理。')
  await projectOrganizerRequest({ action: 'finalize', id: journal.fileId })
  return store.writeOrganizerJournal({ ...journal, status: 'finalized' })
}

export async function previewProjectOrganization({ store, assetProvider }) {
  const [evidence, assets, nodes, claims, links, researchClaims] = await Promise.all([
    store.list(), assetProvider?.list?.() || [], knowledgeStore().listNodes(),
    knowledgeStore().listClaims(), store.listAssetEvidenceLinks(), store.listResearchClaims(),
  ])
  return buildProjectOrganizationPlan({ evidence, assets, nodes, claims, researchClaims, links, runs: listResearchRuns() })
}

async function restoreAssets(assetProvider, before) {
  if (!before?.length) return
  if (!assetProvider?.save) throw new Error('灵感资产服务不可用，无法恢复项目归属。')
  for (const item of before) await assetProvider.save(item)
}

export async function undoProjectOrganization({ store, assetProvider, onProgress = () => {} }) {
  const journal = await store.readOrganizerJournal()
  if (!journal || !journal.fileId || !['applied', 'file', 'evidence', 'knowledge', 'assets', 'runs', 'recovering'].includes(journal.status)) {
    throw new Error('当前没有可撤销的项目整理。')
  }
  // 文件侧撤销会写盘；先核对所有浏览器侧快照，避免文件已回滚而本地因新编辑拒绝恢复。
  if (journal.runSnapshot) restoreResearchRuns(journal.runSnapshot, { validateOnly: true })
  if (journal.knowledgeSnapshot) await knowledgeStore().restoreProjectOrganization(journal.knowledgeSnapshot, { validateOnly: true })
  if (journal.evidenceSnapshot) await store.restoreProjectOrganization(journal.evidenceSnapshot, { validateOnly: true })
  if (journal.assetAfter?.length) {
    const current = new Map((await assetProvider.list()).map(item => [item.id, item]))
    for (const row of journal.assetAfter) {
      if (JSON.stringify(current.get(row.id)) !== JSON.stringify(row)) throw new Error(`灵感资产「${row.title}」在整理后已变化，不能自动撤销。`)
    }
  }
  onProgress('正在核对并恢复文件侧证据')
  await projectOrganizerRequest({ action: 'undo', id: journal.fileId })
  await store.writeOrganizerJournal({ ...journal, status: 'recovering' })
  if (journal.runSnapshot) {
    onProgress('正在恢复研究运行')
    restoreResearchRuns(journal.runSnapshot)
  }
  if (journal.assetBefore?.length) {
    onProgress('正在恢复灵感资产')
    await restoreAssets(assetProvider, journal.assetBefore)
  }
  if (journal.knowledgeSnapshot) {
    onProgress('正在恢复知识节点')
    await knowledgeStore().restoreProjectOrganization(journal.knowledgeSnapshot)
  }
  if (journal.evidenceSnapshot) {
    onProgress('正在恢复证据与关联')
    await store.restoreProjectOrganization(journal.evidenceSnapshot)
  }
  await store.writeOrganizerJournal({ ...journal, status: 'undone' })
  onProgress('已撤销项目整理')
  return journal
}

export async function applyProjectOrganization({ store, assetProvider, mappings, onProgress = () => {} }) {
  const moves = Array.isArray(mappings) ? mappings.filter(item => item?.from && item?.to && item.from !== item.to) : []
  if (!moves.length) throw new Error('没有选中可整理的项目。')
  if (store.isDegraded() || knowledgeStore().isDegraded()) throw new Error('当前存储处于内存降级模式，不能安全执行项目迁移。')
  const existing = await store.readOrganizerJournal()
  if (existing && !['undone', 'failed', 'finalized'].includes(existing.status)) throw new Error('已有未撤销的项目整理，请先撤销或保留当前结果。')
  const assets = await assetProvider?.list?.() || []
  const sources = new Set(moves.map(item => item.from))
  const assetBefore = assets.filter(item => sources.has(item.project))
  if (assetBefore.length && typeof assetProvider?.save !== 'function') throw new Error('灵感资产服务不可写，不能完整迁移这些项目。')
  let journal = await store.writeOrganizerJournal({ status: 'preparing', mappings: moves, assetBefore, createdAt: Date.now() })
  try {
    onProgress('正在建立文件侧备份并迁移证据')
    const file = await projectOrganizerRequest({ action: 'organize', moves })
    journal = await store.writeOrganizerJournal({ ...journal, status: 'file', fileId: file.id })
    onProgress('正在迁移浏览器证据与关联')
    const evidenceSnapshot = await store.remapProjects(moves, { dryRun: true, now: journal.createdAt })
    journal = await store.writeOrganizerJournal({ ...journal, evidenceSnapshot })
    await store.remapProjects(moves, { now: journal.createdAt, expectedSnapshot: evidenceSnapshot })
    journal = await store.writeOrganizerJournal({ ...journal, status: 'evidence' })
    onProgress('正在迁移知识节点')
    const knowledgeSnapshot = await knowledgeStore().remapProjects(moves, { dryRun: true })
    journal = await store.writeOrganizerJournal({ ...journal, knowledgeSnapshot })
    await knowledgeStore().remapProjects(moves, { expectedSnapshot: knowledgeSnapshot })
    journal = await store.writeOrganizerJournal({ ...journal, status: 'knowledge' })
    const map = new Map(moves.map(item => [item.from, item.to]))
    onProgress('正在迁移灵感资产')
    for (const item of assetBefore) {
      await assetProvider.save({ ...item, project: map.get(item.project), tags: [...new Set([...(item.tags || []), `原项目:${item.project}`])] })
    }
    const assetAfter = (await assetProvider?.list?.() || []).filter(item => assetBefore.some(before => before.id === item.id))
    journal = await store.writeOrganizerJournal({ ...journal, status: 'assets', assetAfter })
    onProgress('正在迁移研究运行')
    const runSnapshot = remapResearchRuns(moves, { dryRun: true })
    journal = await store.writeOrganizerJournal({ ...journal, runSnapshot })
    remapResearchRuns(moves)
    journal = await store.writeOrganizerJournal({ ...journal, status: 'runs' })
    journal = await store.writeOrganizerJournal({ ...journal, status: 'applied' })
    onProgress('项目整理完成，可撤销')
    return journal
  } catch (error) {
    if (journal.fileId) {
      try { await undoProjectOrganization({ store, assetProvider, onProgress }) }
      catch (rollbackError) { throw new Error(`${error.message}；自动回滚未完成：${rollbackError.message}。请勿继续整理，先恢复备份。`) }
    } else await store.writeOrganizerJournal({ ...journal, status: 'failed' })
    throw error
  }
}
