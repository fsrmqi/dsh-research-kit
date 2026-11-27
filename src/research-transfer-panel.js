import React from 'react'
import { h, C } from './theme.js'
import { Button, Card, Notice } from './ui.js'
import {
  evidenceVaultStore, publishEvidenceVault, syncEvidenceVaultWithFiles, invalidateEvidenceSync,
} from './lib/evidence-vault-sync.js'
import { synchronizeClaimScopes } from './lib/claim-review-client.js'
import { knowledgeStore, publishKnowledge, serializeKnowledgeBackup, parseKnowledgeBackup } from './knowledge-store.js'
import { serializeEvidenceBackup, parseEvidenceBackup, mergeEntries } from './lib/evidence-vault-core.js'
import { serializeResearchTransfer, parseResearchTransfer, previewResearchTransfer } from './lib/research-transfer.js'
import { pushToast } from './lib/toast.js'
import { listResearchRuns, importResearchRuns, MAX_RESEARCH_RUNS } from './research-context-store.js'
import { downloadBlob, downloadText, downloadJsonFile } from './lib/download.js'

const TRANSFER_SECTIONS = [
  ['evidence', '证据'], ['claims', '论断'], ['links', '资产关联'], ['ledger', '筛选账本'],
  ['workspaces', '课题设置'], ['knowledgeNodes', '知识节点'], ['knowledgeClaims', '知识关系'],
  ['assets', '灵感资产'], ['runs', '研究运行'],
]

function transferDownload(text, name) {
  // 完整备份可能很大，保留更保守的回收延时。
  return downloadJsonFile(text, name, { revokeDelayMs: 10_000 })
}

async function captureResearchTransfer(assetProvider) {
  if (!assetProvider?.list || !assetProvider?.save) throw new Error('灵感资产服务尚未就绪。')
  const synced = await syncEvidenceVaultWithFiles('', { force: true, pullOnly: true })
  const evidence = evidenceVaultStore()
  await synchronizeClaimScopes(evidence)
  const knowledge = knowledgeStore()
  const [entries, claims, links, ledger, workspaces, nodes, knowledgeClaims, assets] = await Promise.all([
    evidence.list(), evidence.listResearchClaims(), evidence.listAssetEvidenceLinks(),
    evidence.listResearchLedger(), evidence.listWorkspaces({ includeArchived: true }),
    knowledge.listNodes(), knowledge.listClaims(), assetProvider.list(),
  ])
  if (evidence.isDegraded() || knowledge.isDegraded()) throw new Error('本地数据库不可用，已停止备份或恢复。')
  if (synced.skipped) throw new Error('文件同步不可用；为防止遗漏 Agent 保存的证据，已停止。')
  const evidenceBackup = JSON.parse(serializeEvidenceBackup({ entries, claims, links, ledger,
    workspaces: workspaces.filter(row => row.origin === 'user' || row.updatedAt > 0) }))
  const knowledgeBackup = JSON.parse(serializeKnowledgeBackup({ nodes, claims: knowledgeClaims }))
  // 导出时间只属于外层备份文件；基线比较必须只比较业务数据。
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
  await synchronizeClaimScopes(store)
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

  // 自动识别整包、证据库、知识星图与灵感资产四类 JSON 备份，无需用户区分入口。
  const parseAnyBackup = async raw => {
    try {
      return { kind: 'full', label: '完整时空囊备份', data: await parseResearchTransfer(raw) }
    } catch { /* 继续嗅探单库备份格式 */ }
    try {
      const ev = parseEvidenceBackup(raw)
      return {
        kind: 'evidence',
        label: '证据库备份',
        data: {
          evidence: { entries: ev.entries, claims: ev.claims, links: ev.links, ledger: ev.ledger, workspaces: ev.workspaces },
          knowledge: { nodes: [], claims: [] },
          assets: [],
          runs: [],
        },
      }
    } catch { /* 继续嗅探 */ }
    try {
      const kn = parseKnowledgeBackup(raw)
      return {
        kind: 'knowledge',
        label: '知识星图备份',
        data: {
          evidence: { entries: [], claims: [], links: [], ledger: [], workspaces: [] },
          knowledge: { nodes: kn.nodes, claims: kn.claims },
          assets: [],
          runs: [],
        },
      }
    } catch { /* 继续嗅探 */ }
    const parsed = JSON.parse(raw)
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.assets) ? parsed.assets : Array.isArray(parsed?.items) ? parsed.items : null
    if (rows && rows.every(item => item && typeof item === 'object' && typeof item.body === 'string')) {
      return {
        kind: 'assets',
        label: '灵感资产备份',
        data: {
          evidence: { entries: [], claims: [], links: [], ledger: [], workspaces: [] },
          knowledge: { nodes: [], claims: [] },
          assets: rows,
          runs: [],
        },
      }
    }
    throw new Error('未能识别的备份格式；请选择时空囊、证据库、灵感资产或知识星图导出的 JSON 文件。')
  }

  const exportCurrent = async () => {
    setBusy(true)
    try {
      const data = await captureResearchTransfer(assetProvider)
      transferDownload(await serializeResearchTransfer(data), `research-kit-backup-${Date.now()}.json`)
      const msg = '已封存时空囊完整备份。'
      setNotice(msg); pushToast({ message: msg })
    } catch (error) { setNotice(`导出失败：${error?.message || error}`) }
    finally { setBusy(false) }
  }
  const selectFile = async event => {
    setIncoming(null); setPreview(null); setBaseline(null); setBackupReady(false)
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 30_000_000) return setNotice('备份文件超过 30 MB，无法在此恢复。')
    setBusy(true)
    try {
      const detected = await parseAnyBackup(await file.text())
      const current = await captureResearchTransfer(assetProvider)
      setIncoming(detected.data)
      setPreview(previewResearchTransfer(detected.data, current))
      setBaseline(JSON.stringify(current))
      setNotice(`已识别为「${detected.label}」。核对预览后点击恢复，系统会自动先留一份本端快照，已有记录不覆盖。`)
    } catch (error) { setNotice(`预览失败：${error?.message || error}`) }
    finally { setBusy(false); event.target.value = '' }
  }
  const backupCurrent = async () => {
    setBusy(true)
    try {
      const current = await captureResearchTransfer(assetProvider)
      if (JSON.stringify(current) !== baseline) throw new Error('本端数据已变化，请重新选择备份文件并预览。')
      transferDownload(await serializeResearchTransfer(current), `research-kit-before-import-${Date.now()}.json`)
      setBackupReady(true)
      setNotice('已生成本端恢复前快照，可点击确认恢复。')
    } catch (error) { setBackupReady(false); setNotice(`备份失败：${error?.message || error}`) }
    finally { setBusy(false) }
  }
  const apply = async () => {
    if (!incoming) return
    setBusy(true)
    try {
      const current = await captureResearchTransfer(assetProvider)
      if (JSON.stringify(current) !== baseline) throw new Error('本端数据已变化，未导入；请重新选择备份文件并预览。')
      if (current.runs.length + preview.runs.add > MAX_RESEARCH_RUNS) throw new Error(`合并后研究运行超过 ${MAX_RESEARCH_RUNS} 条上限，已停止；请先备份并整理旧运行。`)
      if (!backupReady) {
        transferDownload(await serializeResearchTransfer(current), `research-kit-before-import-${Date.now()}.json`)
        setBackupReady(true)
      }
      const result = await applyResearchTransfer(incoming, current, assetProvider, setProgress)
      const msg = `恢复完成：新增证据 ${result.addedEvidence} 条，跳过已有 ${result.skippedEvidence} 条${result.invalidEvidence ? `，忽略无效 ${result.invalidEvidence} 条` : ''}。`
      setNotice(msg); pushToast({ message: msg })
      setIncoming(null); setPreview(null); setBackupReady(false)
    } catch (error) { setNotice(`恢复未完成：${error?.message || error}。原数据未清空，可重新预览后继续。`) }
    finally { setBusy(false); setProgress('') }
  }

  return h(Card, { className: 'rk-reveal', style: { margin: '12px var(--rk-gutter)', display: 'grid', gap: 10, maxWidth: 780 } }, [
    h('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
      h('strong', { key: 'title' }, '时空囊 · 备份与恢复'),
      h(Button, { key: 'close', size: 'sm', variant: 'ghost', onClick: onClose }, '关闭'),
    ]),
    h('p', { key: 'hint', style: { margin: 0, color: C.muted, fontSize: 12 } }, '一键封存全部课题、证据、论断、灵感与知识星图；恢复时自动识别整包或单库 JSON 文件，增量合并、不覆盖现有记录。'),
    h('div', { key: 'actions', style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } }, [
      h(Button, { key: 'export', size: 'sm', variant: 'soft', disabled: busy, onClick: exportCurrent }, '封存完整备份'),
      h('label', { key: 'file', style: { display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: C.ink } }, [
        '从备份恢复', h('input', { key: 'input', type: 'file', accept: '.json,application/json', disabled: busy, onChange: selectFile, 'aria-label': '选择 Research Kit 备份文件' }),
      ]),
    ]),
    preview ? h('div', { key: 'preview', role: 'status', style: { display: 'grid', gap: 4, fontSize: 12 } }, [
      h('strong', { key: 'label' }, '恢复预览（总数／预计新增／本端已有）'),
      ...TRANSFER_SECTIONS.map(([key, label]) => h('div', { key }, `${label}：${preview[key].total}／${preview[key].add}／${preview[key].existing}${preview[key].invalid ? `（无效 ${preview[key].invalid}）` : ''}`)),
      h('div', { key: 'confirm', style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 } }, [
        h(Button, { key: 'apply', size: 'sm', variant: 'primary', disabled: busy, onClick: apply }, backupReady ? '确认增量恢复' : '自动快照并恢复'),
        !backupReady ? h(Button, { key: 'backup', size: 'sm', variant: 'ghost', disabled: busy, onClick: backupCurrent }, '先下载恢复前备份') : null,
      ]),
    ]) : null,
    progress ? h('span', { key: 'progress', role: 'status', style: { color: C.teal } }, progress) : null,
    notice ? h(Notice, { key: 'notice', tone: notice.includes('失败') || notice.includes('未完成') ? 'error' : 'info' }, notice) : null,
  ])
}
