// 研究证据库的纯逻辑（无 React / 无浏览器依赖），供视图与测试共用。
//
// 与灵感资产（vault-core.js）的分工：灵感库存「想过什么」，证据库存「依据什么」。
// 证据条目必须可追溯——有稳定标识符或原始链接，否则后续无法核验，也就失去了保存意义。

// 核验状态：保存不等于认可，新条目一律落到 unverified，由用户逐条核验后推进。
export const EVIDENCE_STATUSES = ['unverified', 'verified', 'disputed', 'stale']
export const EVIDENCE_STATUS_LABELS = {
  unverified: '未核验',
  verified: '已核验',
  disputed: '存疑',
  stale: '已失效',
}
export const EVIDENCE_IDENTIFIER_LABELS = {
  doi: 'DOI',
  pmid: 'PMID',
  pmcid: 'PMCID',
  nct: 'NCT',
  arxiv: 'arXiv',
  accession: '数据集编号',
  url: '链接',
  none: '未提供',
}

// 文本长度上限：证据库只存元数据与用户主动写下的笔记，不收全文、不收 API 原始响应。
export const MAX_EVIDENCE_TITLE_CHARS = 300
export const MAX_EVIDENCE_REASON_CHARS = 500
export const MAX_EVIDENCE_NOTE_CHARS = 2000
export const MAX_EVIDENCE_TAGS = 12

const IDENTIFIER_PATTERNS = [
  { kind: 'doi', regex: /\b10\.\d{4,9}\/[-._;()/:a-z0-9]+/gi, trim: /[.,;)\]}>]+$/ },
  { kind: 'pmcid', regex: /\bPMC\d{6,9}\b/gi },
  { kind: 'nct', regex: /\bNCT\d{8}\b/gi },
  { kind: 'arxiv', regex: /\barxiv:\s*([\d.]+v\d+)/gi, group: 1 },
  { kind: 'pmid', regex: /\bpmid:\s*(\d{5,8})\b/gi, group: 1 },
  { kind: 'pmid', regex: /pubmed\.ncbi\.nlm\.nih\.gov\/(?:(\d{5,8})\/|\w+\?[^#]*?term=(\d{5,8})|(\d{5,8}))/gi, group: 1 },
]

// 从标题、链接或元数据里认稳定标识符。识别不出来不算失败——条目仍可保存，
// 只是 identifierKind 为 none，UI 需要显式提示「缺少可追溯标识符」。
export function detectIdentifier(...parts) {
  const text = parts.map(part => String(part || '')).join(' ')
  if (!text.trim()) return { kind: 'none', value: '' }
  for (const pattern of IDENTIFIER_PATTERNS) {
    pattern.regex.lastIndex = 0
    const match = pattern.regex.exec(text)
    if (!match) continue
    const raw = match[pattern.group || 0]
    if (!raw) continue
    const value = pattern.trim ? raw.replace(pattern.trim, '') : raw
    if (value) return { kind: pattern.kind, value: value.trim() }
  }
  return { kind: 'none', value: '' }
}

export function normalizeTags(value) {
  const rows = Array.isArray(value) ? value : String(value || '').split(/[,，;；]/)
  return [...new Set(rows.map(tag => String(tag || '').trim()).filter(Boolean))].slice(0, MAX_EVIDENCE_TAGS)
}

function clampText(value, max) {
  const text = String(value || '').trim()
  return text.length > max ? text.slice(0, max) : text
}

// 只接受 http(s) 与协议相对链接。宿主页面里渲染 <a href>，必须挡掉 javascript: 等注入。
function safeUrl(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^(https?:)?\/\//i.test(text)) return text
  return ''
}

// 把用户输入（或查询结果来源）落成规范条目。缺标题或缺可追溯来源时抛错：
// 这类条目存下来也无法核验，只会污染证据库。
export function normalizeEvidenceEntry(input = {}) {
  const title = clampText(input.title, MAX_EVIDENCE_TITLE_CHARS)
  if (!title) throw new Error('证据条目缺少标题，无法保存。')
  const url = safeUrl(input.url)
  const detected = detectIdentifier(input.identifier, title, url, input.sourceMeta)
  const identifier = clampText(input.identifier, 120) || detected.value
  const identifierKind = input.identifierKind || (identifier ? (detected.value === identifier ? detected.kind : 'accession') : 'none')
  if (!url && !identifier) throw new Error('证据条目既没有原始链接也没有稳定标识符；无法追溯的来源不入库。')
  const status = EVIDENCE_STATUSES.includes(input.status) ? input.status : 'unverified'
  return {
    id: input.id || `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    sourceDatabase: clampText(input.sourceDatabase, 120),
    identifier,
    identifierKind: EVIDENCE_IDENTIFIER_LABELS[identifierKind] ? identifierKind : 'none',
    url,
    savedAt: Number.isFinite(input.savedAt) ? input.savedAt : Date.now(),
    project: clampText(input.project, 120),
    tags: normalizeTags(input.tags),
    reason: clampText(input.reason, MAX_EVIDENCE_REASON_CHARS),
    note: clampText(input.note, MAX_EVIDENCE_NOTE_CHARS),
    status,
  }
}

export function statusCounts(entries) {
  const rows = Array.isArray(entries) ? entries : []
  const counts = { all: rows.length }
  for (const status of EVIDENCE_STATUSES) counts[status] = rows.filter(item => item.status === status).length
  return counts
}

// 列表筛选：关键词命中标题/来源/标识符/项目/标签/原因/笔记；filter 为核验状态分组。
export function filterEvidence(entries, { query = '', filter = 'all' } = {}) {
  const text = String(query || '').trim().toLowerCase()
  const rows = Array.isArray(entries) ? entries : []
  return rows
    .filter(item => (filter && filter !== 'all' ? item.status === filter : true))
    .filter(item => {
      if (!text) return true
      return `${item.title} ${item.sourceDatabase} ${item.identifier} ${item.project} ${item.reason} ${item.note} ${(item.tags || []).join(' ')}`.toLowerCase().includes(text)
    })
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
}

// ── 去重（4b）──────────────────────────────────────────────────
// 判据：**同一项目内**去重，跨项目不去重。项目隔离优先——同一篇文献在两个
// 课题里各有各的保存原因与笔记，强行全局唯一会让「按项目隔离」名存实亡。

export const EVIDENCE_BACKUP_KIND = 'dsh-research-kit-evidence'
export const EVIDENCE_BACKUP_VERSION = 1

// URL 归一：DOI 之类已有独立键，这里只处理「没有标识符、只能靠链接识别」的条目。
// 去掉协议、www. 前缀与 #片段，保留查询串——不同查询参数可能是不同记录。
function normalizeUrlForDedupe(url) {
  return String(url || '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/#.*$/, '')
    .replace(/\/+$/, '')
}

// 返回 '' 表示「无法识别，不参与去重」——这类条目允许重复保存，由用户自己判断。
export function dedupeKey(entry) {
  if (!entry) return ''
  const project = String(entry.project || '').trim().toLowerCase()
  const identifier = String(entry.identifier || '').trim().toLowerCase()
  if (identifier) return `${project}::${entry.identifierKind || 'accession'}:${identifier}`
  const url = normalizeUrlForDedupe(entry.url)
  if (url) return `${project}::url:${url}`
  return ''
}

export function findDuplicate(entries, candidate) {
  const key = dedupeKey(candidate)
  if (!key) return null
  const rows = Array.isArray(entries) ? entries : []
  return rows.find(item => item.id !== candidate.id && dedupeKey(item) === key) || null
}

// ── 导出 / 导入（4b）───────────────────────────────────────────
// 备份是给用户自己搬运与归档的，所以带 kind 与 version：将来字段变了能识别并拒绝，
// 而不是把旧格式静默解析成残缺条目。

export function serializeEvidenceBackup({ entries = [], project = '' } = {}) {
  return JSON.stringify({
    kind: EVIDENCE_BACKUP_KIND,
    version: EVIDENCE_BACKUP_VERSION,
    exportedAt: Date.now(),
    project: String(project || ''),
    entries: Array.isArray(entries) ? entries : [],
  }, null, 2)
}

// 解析失败一律抛错：半份备份比没有备份更危险，用户会以为恢复了完整数据。
export function parseEvidenceBackup(text) {
  const raw = String(text || '').trim()
  if (!raw) throw new Error('备份内容为空。')
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new Error('备份不是合法 JSON，请确认复制完整。') }
  if (parsed?.kind !== EVIDENCE_BACKUP_KIND) throw new Error('这不是研究证据库的备份文件。')
  if (Number(parsed?.version) > EVIDENCE_BACKUP_VERSION) throw new Error(`备份版本 ${parsed.version} 高于当前支持的 ${EVIDENCE_BACKUP_VERSION}，请升级 Research Kit 后再恢复。`)
  const rows = Array.isArray(parsed.entries) ? parsed.entries : null
  if (!rows) throw new Error('备份文件缺少 entries 字段。')
  return { project: String(parsed.project || ''), entries: rows }
}

// 增量合并：已存在（同项目同标识符，或同 id）的跳过，非法条目单独计数。
// 刻意不做覆盖——恢复备份应该是补齐，不是回滚，否则会静默抹掉恢复之后的新笔记。
export function mergeEntries(existing = [], incoming = []) {
  const rows = Array.isArray(existing) ? [...existing] : []
  const seen = new Set(rows.map(item => dedupeKey(item)).filter(Boolean))
  const ids = new Set(rows.map(item => item.id))
  let added = 0
  let skipped = 0
  let invalid = 0
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    let entry
    try { entry = normalizeEvidenceEntry(raw) } catch { invalid++; continue }
    if (ids.has(entry.id) || (dedupeKey(entry) && seen.has(dedupeKey(entry)))) { skipped++; continue }
    rows.push(entry)
    ids.add(entry.id)
    if (dedupeKey(entry)) seen.add(dedupeKey(entry))
    added++
  }
  return { rows, added, skipped, invalid }
}

// 写入 Prompt 的引用块：保留来源链接与人工核验责任，绝不写成已证实结论。
// 文案集中在此处，视图只负责渲染与调用，避免内联拼接导致两处漂移。
export function formatEvidenceCitations(entries) {
  const rows = Array.isArray(entries) ? entries : []
  if (!rows.length) return ''
  const lines = rows.map((item, index) => {
    const identity = item.identifier ? `${EVIDENCE_IDENTIFIER_LABELS[item.identifierKind] || '标识符'} ${item.identifier}` : item.sourceDatabase || '来源未提供'
    const link = item.url ? `\n   ${item.url}` : ''
    return `${index + 1}. ${item.title}\n   ${identity}${link}`
  })
  return [
    '以下条目来自本地证据库，**尚未经逐条核验**，请打开来源确认后再引用；不得据此直接断言结论：',
    ...lines,
  ].join('\n')
}

// 4c 的写入决策：把「要不要注入、注入什么」做成纯逻辑。
// 「未选择不注入」是 ROADMAP §4c 的验收条件，只有把决策变成可断言的返回值，
// 才能真的测到「什么都没被注入」——否则它只是渲染层里的一个副作用。
// action 的取值即契约：只有 'write' 允许调用宿主 setDraft。
export function planCitationWrite({ entries, canWrite } = {}) {
  const rows = Array.isArray(entries) ? entries : []
  if (!rows.length) {
    return { action: 'empty', text: '', notice: '请先勾选证据条目。' }
  }
  const text = formatEvidenceCitations(rows)
  if (!canWrite) {
    // 降级不是静默丢弃：引用块照常给出来，由用户复制粘贴。
    return { action: 'unsupported', text, notice: '当前 DSH 会话未提供输入框操作；可复制引用块后手动粘贴。' }
  }
  return { action: 'write', text, notice: `已将 ${rows.length} 条已勾选证据写入当前会话输入框。` }
}

// ── 证据库 → 解释图（研究路线可视化）的素材包 ──────────────────────────────────
// 把（通常已核验的）证据条目转成 render-diagrams --evidence 可消费的卡片数据。
// 与图谱同一隐私边界：只携带稳定标识符与公开链接，不携带检索词、Prompt 正文或全文。
export const EXPLAIN_PACK_FORMAT = 'dsh-research-kit/evidence-explain-pack'

export function buildEvidenceExplainPack(entries, project = '') {
  const rows = (Array.isArray(entries) ? entries : []).map(entry => ({
    title: clampText(entry.title, MAX_EVIDENCE_TITLE_CHARS),
    identifier: clampText(entry.identifier, 120),
    identifierKind: EVIDENCE_IDENTIFIER_LABELS[entry.identifierKind] ? entry.identifierKind : 'none',
    url: safeUrl(entry.url),
    sourceDatabase: clampText(entry.sourceDatabase, 120),
    status: EVIDENCE_STATUSES.includes(entry.status) ? entry.status : 'unverified',
    note: clampText(entry.note, MAX_EVIDENCE_NOTE_CHARS),
    tags: normalizeTags(entry.tags),
  }))
  return {
    format: EXPLAIN_PACK_FORMAT,
    version: 1,
    project: clampText(project, 120) || '',
    entries: rows,
  }
}

// 解释图「证据库来源」卡片：按标识符去重、逐条标注核验状态；
// 全部已核验时卡片标题升级为「已核验证据 · 证据库」，否则如实显示混合状态。
export function evidenceExplainCard(entries) {
  const seen = new Set()
  const rows = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !entry.title) continue
    const key = `${entry.identifier || ''}|${entry.url || ''}|${entry.title}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(entry)
  }
  if (!rows.length) return null
  const allVerified = rows.every(entry => entry.status === 'verified')
  const items = rows.map(entry => {
    const idLabel = EVIDENCE_IDENTIFIER_LABELS[entry.identifierKind] || ''
    const raw = String(entry.identifier || '')
    const needsPrefix = idLabel && idLabel !== '未提供' && !raw.toLowerCase().startsWith(`${idLabel.toLowerCase()}:`)
    const id = entry.identifier ? (needsPrefix ? `${idLabel}:${raw}` : raw) : (entry.url || '无稳定标识符')
    const origin = entry.sourceDatabase ? ` · ${entry.sourceDatabase}` : ''
    return `${entry.title} — ${id}${origin}（${EVIDENCE_STATUS_LABELS[entry.status] || entry.status}）`
  })
  return {
    dot: 'emerald',
    title: allVerified ? '已核验证据 · 证据库' : '证据库来源（含核验状态）',
    items,
  }
}
