import React from 'react'
import { h, C } from './theme.js'
import { Button, Card, Notice } from './ui.js'
import { evidenceVaultStore, persistEvidenceEntryToFile, publishEvidenceVault, removeEvidenceEntryFromFile, subscribeEvidenceVault } from './lib/evidence-vault-sync.js'
import { ensureResearchProviders } from '../dsh/prompt-studio-glue.js'
import { loadPromptKit } from './promptkit-loader.js'
import { pushToast } from './lib/toast.js'

const restoring = new Set()

export async function deleteEvidenceToRecentlyDeleted(id) {
  const store = evidenceVaultStore()
  const [entry] = await store.getMany([id])
  if (!entry) return null
  const links = await store.listAssetEvidenceLinks({ evidenceId: entry.id })
  const archived = await store.archiveForRestore('evidence', entry, links)
  try {
    await removeEvidenceEntryFromFile(entry)
  } catch (error) {
    await store.forgetRecentlyDeleted(archived.id)
    throw error
  }
  await store.remove(entry.id)
  publishEvidenceVault()
  return archived
}

export async function restoreRecentlyDeleted(id, assetProvider) {
  if (restoring.has(id)) return
  restoring.add(id)
  const store = evidenceVaultStore()
  try {
    const row = (await store.listRecentlyDeleted()).find(item => item.id === id)
    if (!row) throw new Error('这条删除记录已恢复或已过期。')
    const { entry, links } = row
    if (row.kind === 'evidence') {
      const existing = (await store.getMany([entry.id]))[0]
      if (existing) {
        // 恢复已落在本库时只补原关联，保留条目的后续修改。
        for (const link of links) await store.linkAssetEvidence(link)
      } else {
        await store.restoreDeletedEvidence(entry, links)
      }
      const fileSynced = await persistEvidenceEntryToFile(existing || entry)
      pushToast({ message: fileSynced ? `已恢复「${entry.title}」及其关联。` : `已在本地恢复「${entry.title}」及其关联。` })
    } else {
      assetProvider ||= ensureResearchProviders(await loadPromptKit()).researchAssetProvider
      const assets = await assetProvider.list()
      if (!assets.some(item => item.id === entry.id)) await assetProvider.save(entry)
      for (const link of links) await store.linkAssetEvidence(link)
      pushToast({ message: `已恢复「${entry.title}」及其关联。` })
    }
    await store.forgetRecentlyDeleted(id)
    return true
  } catch (error) {
    pushToast({ message: `恢复失败：${error?.message || error}`, tone: 'warn' })
  } finally {
    restoring.delete(id)
    publishEvidenceVault()
  }
}

export function ResearchRecentlyDeleted({ assetProvider, onClose }) {
  const [rows, setRows] = React.useState(null)
  const [error, setError] = React.useState('')
  const [busyId, setBusyId] = React.useState('')
  React.useEffect(() => {
    let version = 0
    const refresh = async () => {
      const request = ++version
      try {
        const rows = await evidenceVaultStore().listRecentlyDeleted()
        if (request === version) { setRows(rows); setError('') }
      } catch (error) {
        if (request === version) setError(error.message)
      }
    }
    refresh()
    const unsubscribe = subscribeEvidenceVault(refresh)
    return () => { version++; unsubscribe() }
  }, [])
  return h(Card, { as: 'section', 'aria-label': '最近删除', className: 'rk-reveal', style: { marginTop: 14, display: 'grid', gap: 10 } }, [
    h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
      h('strong', { key: 'title' }, '最近删除'),
      h(Button, { key: 'close', size: 'sm', variant: 'quiet', onClick: onClose }, '收起'),
    ]),
    h('small', { key: 'info', style: { color: C.muted } }, '证据和灵感在本机保留 30 天，恢复时带回原有关联。'),
    error ? h(Notice, { key: 'error', tone: 'warn' }, `读取失败：${error}`) : null,
    h('div', { key: 'list', role: 'status' }, !rows ? '正在读取…' : rows.length ? `${rows.length} 条可恢复` : '暂无删除记录。'),
    ...(rows || []).map(row => h('div', { key: row.id, style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 } }, [
      h('span', { key: 'title', style: { flex: '1 1 auto' } }, `${row.kind === 'evidence' ? '证据' : '灵感'} · ${row.entry.title}${row.entry.project ? ` · ${row.entry.project}` : ''}`),
      h(Button, {
        key: 'restore', size: 'sm', disabled: Boolean(busyId), 'aria-label': `恢复「${row.entry.title}」`,
        onClick: async () => {
          setBusyId(row.id)
          try { await restoreRecentlyDeleted(row.id, assetProvider) } finally { setBusyId('') }
        },
      }, busyId === row.id ? '恢复中…' : '恢复'),
    ])),
  ])
}
