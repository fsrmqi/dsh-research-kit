import React from 'react'
import { h, C } from './theme.js'
import { Button, Card, Notice } from './ui.js'
import { evidenceVaultStore, publishEvidenceVault, syncEvidenceVaultWithFiles, invalidateEvidenceSync } from './research-evidence-vault.js'
import { knowledgeStore, publishKnowledge, serializeKnowledgeBackup } from './knowledge-store.js'
import { serializeEvidenceBackup, mergeEntries } from './lib/evidence-vault-core.js'
import { serializeResearchTransfer, parseResearchTransfer, previewResearchTransfer } from './lib/research-transfer.js'
import { listResearchRuns, importResearchRuns, MAX_RESEARCH_RUNS } from './research-context-store.js'

const TRANSFER_SECTIONS = [
  ['evidence', '证据'], ['claims', '论断'], ['links', '资产关联'], ['ledger', '筛选账本'],
  ['workspaces', '课题设置'], ['knowledgeNodes', '知识节点'], ['knowledgeClaims', '知识关系'],
  ['assets', '灵感资产'], ['runs', '研究运行'],
]

function transferDownload(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

async function captureResearchTransfer(assetProvider) {
  if (!assetProvider?.list || !assetProvider?.save) throw new Error('灵感资产服务尚未就绪。')
  const synced = await syncEvidenceVaultWithFiles('', { force: true, pullOnly: true })
  const evidence = evidenceVaultStore()
  const knowledge = knowledgeStore()
  const [entries, claims, links, ledger, workspaces, nodes, knowledgeClaims, assets] = await Promise.all([
    evidence.list(), evidence.listResearchClaims(), evidence.listAssetEvidenceLinks(),
    evidence.listResearchLedger(), evidence.listWorkspaces({ includeArchived: true }),
    knowledge.listNodes(), knowledge.listClaims(), assetProvider.list(),
  ])
  if (evidence.isDegraded() || knowledge.isDegraded()) throw new Error('本地数据库不可用；为防止只迁移到临时内存，已停止。')
  if (synced.skipped) throw new Error('文件同步不可用；为防止遗漏 Agent 保存的证据，已停止。')
  const evidenceBackup = JSON.parse(serializeEvidenceBackup({ entries, claims, links, ledger,
    workspaces: workspaces.filter(row => row.origin === 'user' || row.updatedAt > 0) }))
  const knowledgeBackup = JSON.parse(serializeKnowledgeBackup({ nodes, claims: knowledgeClaims }))
  // 导出时间只属于外层迁移文件；基线比较必须只比较业务数据。
  evidenceBackup.exportedAt = 0
  knowledgeBackup.exportedAt = 0
  return {
    evidence: evidenceBackup,
    knowledge: knowledgeBackup,
    assets, runs: listResearchRuns(),
  }
}

async function applyResearchTransfer(incoming, current, assetProvider, progress) {
  const store = evidenceVaultStore()
  const existing = current.evidence.entries
  const merged = mergeEntries(existing, incoming.evidence.entries)
  const addedEntries = merged.rows.filter(row => !existing.some(item => item.id === row.id))
  progress('正在导入证据与课题…')
  if (addedEntries.length) await store.importMany(addedEntries)
  await store.importWorkspaces(incoming.evidence.workspaces)

  progress('正在导入灵感资产…')
  const assetIds = new Set(current.assets.map(item => item.id))
  for (const item of incoming.assets) {
    if (assetIds.has(item.id)) continue
    await assetProvider.save(item)
    assetIds.add(item.id)
  }

  progress('正在恢复证据关联与账本…')
  const evidenceIds = new Set((await store.list()).map(item => item.id))
  let skippedRelated = 0
  const claimIds = new Set(current.evidence.claims.map(item => item.id))
  for (const item of incoming.evidence.claims) {
    if (claimIds.has(item.id)) continue
    if (item.links?.some(link => !evidenceIds.has(link.evidenceId))) { skippedRelated++; continue }
    await store.saveResearchClaim(item)
    claimIds.add(item.id)
  }
  const linkIds = new Set(current.evidence.links.map(item => item.id))
  for (const item of incoming.evidence.links) {
    if (linkIds.has(item.id)) continue
    if (!evidenceIds.has(item.evidenceId) || !assetIds.has(item.assetId)) { skippedRelated++; continue }
    await store.linkAssetEvidence(item)
    linkIds.add(item.id)
  }
  const ledgerIds = new Set(current.evidence.ledger.map(item => item.id))
  for (const item of incoming.evidence.ledger) {
    if (ledgerIds.has(item.id)) continue
    if (item.kind === 'screening' && !evidenceIds.has(item.evidenceId)) { skippedRelated++; continue }
    await store.saveResearchLedgerEvent(item)
    ledgerIds.add(item.id)
  }

  progress('正在导入知识与研究运行…')
  await knowledgeStore().importBackup(incoming.knowledge)
  importResearchRuns(incoming.runs)
  progress('正在同步文件侧证据…')
  invalidateEvidenceSync()
  const synced = await syncEvidenceVaultWithFiles('', { force: true, allowExistingSources: true })
  publishEvidenceVault()
  publishKnowledge()
  return { addedEvidence: addedEntries.length, skippedEvidence: merged.skipped, invalidEvidence: merged.invalid,
    skippedRelated, existingSources: synced.existingSources || 0 }
}

export function ResearchTransferPanel({ assetProvider, onClose }) {
  const [incoming, setIncoming] = React.useState(null)
  const [preview, setPreview] = React.useState(null)
  const [baseline, setBaseline] = React.useState(null)
  const [backupReady, setBackupReady] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  const [progress, setProgress] = React.useState('')

  const exportCurrent = async () => {
    setBusy(true)
    try {
      const data = await captureResearchTransfer(assetProvider)
      transferDownload(await serializeResearchTransfer(data), `research-kit-app-transfer-${Date.now()}.json`)
      setNotice('已生成完整迁移包。请妥善保管；它包含笔记、灵感资产及来源摘录。')
    } catch (error) { setNotice(`导出失败：${error?.message || error}`) }
    finally { setBusy(false) }
  }
  const selectFile = async event => {
    setIncoming(null); setPreview(null); setBaseline(null); setBackupReady(false)
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 30_000_000) return setNotice('迁移文件超过 30 MB；请分批导出或联系维护者。')
    setBusy(true)
    try {
      const data = await parseResearchTransfer(await file.text())
      const current = await captureResearchTransfer(assetProvider)
      setIncoming(data)
      setPreview(previewResearchTransfer(data, current))
      setBaseline(JSON.stringify(current))
      setNotice('校验通过。请检查预览，先下载本端备份，再确认增量导入。已有 ID 不覆盖。')
    } catch (error) { setNotice(`预览失败：${error?.message || error}`) }
    finally { setBusy(false); event.target.value = '' }
  }
  const backupCurrent = async () => {
    setBusy(true)
    try {
      const current = await captureResearchTransfer(assetProvider)
      if (JSON.stringify(current) !== baseline) throw new Error('本端数据已变化，请重新选择迁移文件并预览。')
      transferDownload(await serializeResearchTransfer(current), `research-kit-before-import-${Date.now()}.json`)
      setBackupReady(true)
      setNotice('已生成本端导入前备份。确认文件已保存后，再点击“确认增量导入”。')
    } catch (error) { setBackupReady(false); setNotice(`备份失败：${error?.message || error}`) }
    finally { setBusy(false) }
  }
  const apply = async () => {
    if (!incoming || !backupReady) return
    setBusy(true)
    try {
      const current = await captureResearchTransfer(assetProvider)
      if (JSON.stringify(current) !== baseline) throw new Error('本端数据已变化，未导入；请重新选择迁移文件并预览。')
      if (current.runs.length + preview.runs.add > MAX_RESEARCH_RUNS) throw new Error(`合并后研究运行超过 ${MAX_RESEARCH_RUNS} 条上限，已停止；请先备份并整理旧运行。`)
      const result = await applyResearchTransfer(incoming, current, assetProvider, setProgress)
      setNotice(`导入完成：新增证据 ${result.addedEvidence} 条，跳过已有 ${result.skippedEvidence} 条，拒收无效 ${result.invalidEvidence} 条，未恢复关联 ${result.skippedRelated} 条。${result.existingSources ? `文件侧已有同源证据 ${result.existingSources} 条，未覆盖原记录；` : ''}其余数据按稳定 ID 增量合并，请刷新核对。`)
      setIncoming(null); setPreview(null); setBackupReady(false)
    } catch (error) { setNotice(`导入未完成：${error?.message || error}。原数据未清空；可用导入前备份核对，重新预览后续导。`) }
    finally { setBusy(false); setProgress('') }
  }

  return h(Card, { style: { margin: '12px var(--rk-gutter)', display: 'grid', gap: 10, maxWidth: 780 } }, [
    h('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } }, [
      h('strong', { key: 'title' }, '迁移到 DSH App'),
      h(Button, { key: 'close', size: 'sm', variant: 'ghost', onClick: onClose }, '关闭'),
    ]),
    h('p', { key: 'hint', style: { margin: 0, color: C.muted, fontSize: 12 } }, '在旧 Web 端导出迁移包；在 App 中选择该文件，预览后增量导入。两端页面源不同，不会自动共享浏览器数据。'),
    h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
      h(Button, { key: 'export', size: 'sm', disabled: busy, onClick: exportCurrent }, '导出本端完整迁移包'),
      h('label', { key: 'file', style: { display: 'inline-grid', gap: 4, fontSize: 12, color: C.ink } }, [
        '选择迁移文件', h('input', { key: 'input', type: 'file', accept: '.json,application/json', disabled: busy, onChange: selectFile, 'aria-label': '选择 Research Kit 迁移文件' }),
      ]),
    ]),
    preview ? h('div', { key: 'preview', role: 'status', style: { display: 'grid', gap: 4, fontSize: 12 } }, [
      h('strong', { key: 'label' }, '导入预览（总数／预计新增／本端已有）'),
      ...TRANSFER_SECTIONS.map(([key, label]) => h('div', { key }, `${label}：${preview[key].total}／${preview[key].add}／${preview[key].existing}${preview[key].invalid ? `（无效 ${preview[key].invalid}）` : ''}`)),
      h('div', { key: 'confirm', style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 } }, [
        h(Button, { key: 'backup', size: 'sm', disabled: busy, onClick: backupCurrent }, '先下载本端备份'),
        h(Button, { key: 'apply', size: 'sm', variant: 'primary', disabled: busy || !backupReady, onClick: apply }, '确认增量导入'),
      ]),
    ]) : null,
    progress ? h('span', { key: 'progress', role: 'status', style: { color: C.teal } }, progress) : null,
    notice ? h(Notice, { key: 'notice', tone: notice.includes('失败') || notice.includes('未完成') ? 'error' : 'info' }, notice) : null,
  ])
}
