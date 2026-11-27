// 科研梦境本地存储（localStorage，带内存降级）。
//
// 仅保存：
//   1. 最近 12 份梦境简报（高信号压缩后的 Top 5 提案，不含论文全文）；
//   2. 已处理提案的 signature 集合（已采纳 / 已忽略），避免下次梦境重复打扰；
//   3. 用户偏好的梦境模式（完整梦 / 巩固梦 / 联想梦）。
import { normalizeDreamMode } from './lib/research-dream.js'

export const DREAM_STORE_KEY = 'dsh-research-kit.dream-reports.v1'
export const DREAM_ASSET_STORAGE_KEY = 'dsh-research-kit.promptkit.vault.assets.v1'
export const DREAM_MAX_REPORTS = 12
export const DREAM_MAX_HANDLED_SIGNATURES = 300

const memoryFallback = { value: null }
const listeners = new Set()

function emptyState() {
  return {
    preferredMode: 'full',
    reports: [],
    handledByProject: {},
    watermarkByProject: {},
    auto: { enabled: false },
  }
}

function projectKey(project) {
  return String(project || 'default').trim() || 'default'
}

function readState() {
  try {
    const raw = typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(DREAM_STORE_KEY)
      : memoryFallback.value
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw)
    return {
      preferredMode: normalizeDreamMode(parsed?.preferredMode),
      reports: Array.isArray(parsed?.reports) ? parsed.reports : [],
      handledByProject: parsed?.handledByProject && typeof parsed.handledByProject === 'object' ? parsed.handledByProject : {},
      watermarkByProject: parsed?.watermarkByProject && typeof parsed.watermarkByProject === 'object' ? parsed.watermarkByProject : {},
      auto: { enabled: parsed?.auto?.enabled === true },
    }
  } catch {
    return emptyState()
  }
}

function writeState(next) {
  const serialized = JSON.stringify(next)
  memoryFallback.value = serialized
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(DREAM_STORE_KEY, serialized)
    }
  } catch { /* 隐私模式或配额不足时保留内存态，不阻断交互 */ }
  for (const listener of listeners) {
    try { listener() } catch { /* 单个监听异常不影响其余 */ }
  }
}

export function subscribeDreamStore(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPreferredDreamMode() {
  return readState().preferredMode
}

export function setPreferredDreamMode(mode) {
  const state = readState()
  const nextMode = normalizeDreamMode(mode)
  if (state.preferredMode === nextMode) return nextMode
  writeState({ ...state, preferredMode: nextMode })
  return nextMode
}

export function listDreamReports(project = '') {
  const key = projectKey(project)
  return readState().reports.filter(item => projectKey(item.project) === key)
}

export function latestDreamReport(project = '') {
  return listDreamReports(project)[0] || null
}

/** 跨简报收集仍待处理的提案。同一 signature 只保留较新的一份，旧简报里的待办不会被新简报盖住。 */
export function pendingDreamInbox(reports = []) {
  const seen = new Set()
  const items = []
  for (const report of Array.isArray(reports) ? reports : []) {
    for (const proposal of report?.proposals || []) {
      if (!proposal || proposal.status !== 'pending') continue
      const key = String(proposal.signature || proposal.id || '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      items.push({ ...proposal, reportId: report.id })
    }
  }
  return items
}

export function getHandledDreamSignatures(project = '') {
  const key = projectKey(project)
  const list = readState().handledByProject[key]
  return Array.isArray(list) ? list : []
}

export function getDreamWatermark(project = '') {
  const row = readState().watermarkByProject[projectKey(project)]
  return row && typeof row === 'object' ? row : null
}

export function setDreamWatermark(project = '', watermark = {}) {
  const state = readState()
  const key = projectKey(project)
  writeState({
    ...state,
    watermarkByProject: {
      ...state.watermarkByProject,
      [key]: {
        at: Number(watermark.at) || Date.now(),
        lastDreamAt: Number(watermark.lastDreamAt) || Date.now(),
        anchorFingerprint: String(watermark.anchorFingerprint || ''),
        anchorCursor: Number(watermark.anchorCursor) || 0,
        coldCursor: Number(watermark.coldCursor ?? watermark.anchorCursor) || 0,
      },
    },
  })
}

export function listStoredDreamAssets() {
  try {
    const raw = typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(DREAM_ASSET_STORAGE_KEY)
      : null
    const rows = JSON.parse(raw || '[]')
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

export function getDreamAutoEnabled() {
  return readState().auto.enabled === true
}

export function setDreamAutoEnabled(enabled) {
  const state = readState()
  writeState({ ...state, auto: { enabled: enabled === true } })
  return enabled === true
}

export function saveDreamReport(report) {
  if (!report || typeof report !== 'object') return null
  const state = readState()
  const entry = {
    id: String(report.id || `dream-report-${Date.now().toString(36)}`),
    project: projectKey(report.project),
    mode: normalizeDreamMode(report.mode),
    engine: String(report.engine || 'local-rules'),
    model: String(report.model || ''),
    createdAt: Number(report.createdAt) || Date.now(),
    counts: report.counts || { evidence: 0, claims: 0, knowledgeNodes: 0, knowledgeClaims: 0, runs: 0 },
    digest: String(report.digest || ''),
    proposals: Array.isArray(report.proposals) ? report.proposals : [],
  }
  const others = state.reports.filter(item => item.id !== entry.id)
  const reports = [entry, ...others].slice(0, DREAM_MAX_REPORTS)
  writeState({ ...state, reports })
  return entry
}

export function updateDreamProposalStatus({ reportId, proposalId, status, project = '' }) {
  if (!['accepted', 'dismissed', 'pending'].includes(status)) return null
  const state = readState()
  let targetSignature = ''
  let targetProject = projectKey(project)
  let updatedReport = null

  const reports = state.reports.map(report => {
    if (report.id !== reportId) return report
    targetProject = projectKey(report.project)
    const proposals = (report.proposals || []).map(proposal => {
      if (proposal.id !== proposalId) return proposal
      targetSignature = proposal.signature || ''
      return { ...proposal, status, handledAt: status === 'pending' ? 0 : Date.now() }
    })
    updatedReport = { ...report, proposals }
    return updatedReport
  })

  if (!updatedReport) return null

  const handledByProject = { ...state.handledByProject }
  if (targetSignature) {
    const existing = Array.isArray(handledByProject[targetProject]) ? handledByProject[targetProject] : []
    if (status === 'pending') {
      handledByProject[targetProject] = existing.filter(sig => sig !== targetSignature)
    } else {
      const next = [targetSignature, ...existing.filter(sig => sig !== targetSignature)].slice(0, DREAM_MAX_HANDLED_SIGNATURES)
      handledByProject[targetProject] = next
    }
  }

  writeState({ ...state, reports, handledByProject })
  return updatedReport
}

export function clearDreamStoreForTest() {
  memoryFallback.value = null
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(DREAM_STORE_KEY)
    }
  } catch { /* ignore */ }
}
