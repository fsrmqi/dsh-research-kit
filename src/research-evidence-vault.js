import React from 'react'
import { h, C } from './theme.js'
import {
  Toolbar, Card, Button, Input, Textarea, Field, Badge, Chip, Select,
  Segmented, EmptyState, Spinner, Notice,
} from './ui.js'
import { createEvidenceVaultStore } from './evidence-vault-store.js'
import {
  EVIDENCE_STATUSES, EVIDENCE_STATUS_LABELS, EVIDENCE_IDENTIFIER_LABELS,
  statusCounts, filterEvidence, detectIdentifier,
  serializeEvidenceBackup, parseEvidenceBackup, mergeEntries, planCitationWrite,
  buildEvidenceExplainPack,
} from './lib/evidence-vault-core.js'

// 研究证据库（ROADMAP §4）：把用户明确保存、可追溯的外部来源沉淀下来。
//
// 与灵感资产的边界：灵感资产回答「想过什么」，证据库回答「依据什么」。
// 隐私边界（不可协商，与 ROADMAP §4 一致）：
//   - 只入库用户逐条确认的元数据与主动写下的笔记；禁止自动入库；
//   - 不保存 API 原始响应、检索词、全文或附件；
//   - 保存不等于认可，新条目一律落到「未核验」。

// 单例 + 订阅：保存入口在查询面板（分区①），列表在本面板（沉淀层），
// 两者不在同一棵子树里，靠模块级 store 与监听保持同步。
let sharedStore = null
const listeners = new Set()

export function evidenceVaultStore() {
  if (!sharedStore) sharedStore = createEvidenceVaultStore()
  return sharedStore
}

export function subscribeEvidenceVault(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publishEvidenceVault() {
  for (const listener of listeners) { try { listener() } catch { /* 单个监听失败不影响其余 */ } }
}

export async function saveEvidenceEntry(input, options) {
  const result = await evidenceVaultStore().save(input, options)
  publishEvidenceVault()
  return result
}

// 当前项目：工作上下文，跨会话保留。保存表单与列表各自读它，
// 保证「在查询结果里保存」落到用户此刻正在看的那个项目。
export function getActiveProject() {
  return evidenceVaultStore().getActiveProject()
}

export function setActiveProject(project) {
  const next = evidenceVaultStore().setActiveProject(project)
  publishEvidenceVault()
  return next
}

function formatEvidenceTime(at) {
  try { return new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

function stamp() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}

function downloadJson(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const STATUS_COLORS = {
  unverified: C.statusToVerify,
  verified: C.statusVerified,
  disputed: C.statusRefuted,
  stale: C.muted,
}

// 保存确认表单：嵌在查询结果条目下方。必须经过这一步才入库——
// 用户要看到并确认将要保存的内容，这是「不静默持久化」的具体落点。
export function EvidenceSaveForm({ source = {}, databaseName = '', onCancel, onSaved }) {
  const detected = React.useMemo(
    () => detectIdentifier(source.identifier, source.title, source.url, source.meta),
    [source.identifier, source.title, source.url, source.meta],
  )
  const [form, setForm] = React.useState({
    title: source.title || '',
    identifier: detected.value || '',
    project: getActiveProject(),
    tags: '',
    reason: '',
    note: '',
  })
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  // 重复不是错误而是需要用户裁决的状态：覆盖已有，还是刻意另存一份。
  const [conflict, setConflict] = React.useState(null)
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const payload = onDuplicate => ({
    title: form.title,
    sourceDatabase: databaseName,
    identifier: form.identifier,
    identifierKind: form.identifier && form.identifier === detected.value ? detected.kind : 'accession',
    url: source.url,
    sourceMeta: source.meta,
    project: form.project,
    tags: form.tags,
    reason: form.reason,
    note: form.note,
  })
  const submit = async (onDuplicate = 'reject') => {
    setSaving(true); setError('')
    try {
      const result = await saveEvidenceEntry(payload(onDuplicate), { onDuplicate })
      setConflict(null)
      onSaved?.(result.entry)
    } catch (failure) {
      if (failure?.code === 'DUPLICATE') { setConflict(failure.duplicate); setError('') } else setError(String(failure?.message || failure))
    } finally { setSaving(false) }
  }
  return h(Card, { style: { marginTop: 8, padding: 12, border: `1px solid ${C.tealLine}`, background: C.surface, display: 'grid', gap: 10 } }, [
    h('strong', { key: 't', style: { fontSize: 13 } }, '保存到证据库'),
    h('p', { key: 'p', style: { margin: 0, color: C.muted, fontSize: 12, lineHeight: 1.5 } },
      '只保存元数据与你写下的笔记；不保存检索词、API 原始响应或全文。保存后默认标记为「未核验」，需要逐条打开来源确认。'),
    h('div', { key: 'grid', className: 'rk-form-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 } }, [
      h(Field, { key: 'title', label: '标题' },
        h(Input, { value: form.title, onChange: value => update('title', value), ariaLabel: '证据标题' })),
      h(Field, { key: 'identifier', label: `稳定标识符${detected.value ? `（已识别为 ${EVIDENCE_IDENTIFIER_LABELS[detected.kind]}）` : '（可选）'}` },
        h(Input, { value: form.identifier, onChange: value => update('identifier', value), placeholder: 'DOI / PMID / NCT / 数据集编号', ariaLabel: '稳定标识符' })),
      h(Field, { key: 'project', label: '项目（可选，默认当前项目）' },
        h(Input, { value: form.project, onChange: value => update('project', value), placeholder: '例：肿瘤队列分析', ariaLabel: '项目' })),
      h(Field, { key: 'tags', label: '标签（逗号分隔）' },
        h(Input, { value: form.tags, onChange: value => update('tags', value), ariaLabel: '标签' })),
    ]),
    h(Field, { key: 'reason', label: '保存原因（可选）' },
      h(Textarea, { value: form.reason, onChange: value => update('reason', value), rows: 2, placeholder: '这条来源为什么值得留下', ariaLabel: '保存原因' })),
    h(Field, { key: 'note', label: '笔记（可选）' },
      h(Textarea, { value: form.note, onChange: value => update('note', value), rows: 2, ariaLabel: '笔记' })),
    error ? h(Notice, { key: 'error', tone: 'error', icon: 'shield' }, error) : null,
    conflict ? h(Notice, { key: 'conflict', tone: 'warn', icon: 'shield' },
      `该来源已在本项目证据库中：「${conflict.title}」（${EVIDENCE_STATUS_LABELS[conflict.status] || conflict.status}）。要覆盖它的笔记与状态，还是另存一份？`) : null,
    h('div', { key: 'row', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
      h(Button, { key: 'save', variant: 'primary', size: 'sm', icon: 'check', disabled: saving || !form.title.trim(), onClick: () => submit('reject') }, saving ? '保存中…' : '确认保存'),
      conflict ? h(Button, { key: 'update', variant: 'soft', size: 'sm', icon: 'check', disabled: saving, onClick: () => submit('update') }, '覆盖已有条目') : null,
      conflict ? h(Button, { key: 'force', variant: 'ghost', size: 'sm', disabled: saving, onClick: () => submit('new') }, '仍然另存一份') : null,
      h(Button, { key: 'cancel', variant: 'ghost', size: 'sm', onClick: onCancel }, '取消'),
    ]),
  ])
}

// 证据库面板：由沉淀层分区内嵌，不自带 PageHead（外壳与标题由分区提供）。
export function EvidenceVaultPane({ inputActions }) {
  const store = evidenceVaultStore()
  const [entries, setEntries] = React.useState([])
  const [projects, setProjects] = React.useState([])
  const [project, setProject] = React.useState(() => store.getActiveProject())
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState('all')
  const [selectedIds, setSelectedIds] = React.useState([])
  const [notice, setNotice] = React.useState('')
  const [newProject, setNewProject] = React.useState('')
  const [newProjectOpen, setNewProjectOpen] = React.useState(false)
  const [backup, setBackup] = React.useState('')
  const [backupOpen, setBackupOpen] = React.useState(false)
  // 清空是不可逆的，用两段式确认代替 window.confirm（宿主可能屏蔽原生弹窗）。
  const [confirmClear, setConfirmClear] = React.useState(false)
  const refreshVersion = React.useRef(0)

  const refresh = React.useCallback(() => {
    const version = ++refreshVersion.current
    Promise.all([store.list({ project: project || undefined }), store.listProjects()])
      .then(([rows, names]) => {
        if (version !== refreshVersion.current) return
        setEntries(rows || [])
        setProjects(names || [])
        setLoading(false)
      })
      .catch(error => {
        if (version !== refreshVersion.current) return
        setNotice(`⚠️ 读取证据库失败：${error?.message || error}`)
        setLoading(false)
      })
  }, [store, project])
  React.useEffect(() => { refresh() }, [refresh])
  React.useEffect(() => subscribeEvidenceVault(refresh), [refresh])

  const counts = React.useMemo(() => statusCounts(entries), [entries])
  const filtered = React.useMemo(() => filterEvidence(entries, { query, filter }), [entries, query, filter])
  // 选择是用户明确做出的跨筛选状态：以 entries 而非 filtered 为基准，
  // 改筛选只影响「看见什么」，不会悄悄撤销「已选择什么」。
  const selectedEntries = React.useMemo(() => entries.filter(item => selectedIds.includes(item.id)), [entries, selectedIds])
  const canWrite = typeof inputActions?.setDraft === 'function'
  // 写入决策走纯逻辑：只有 action === 'write' 才允许碰宿主输入框。
  // 「未选择不注入」由 evidence-vault-core 的回归测试守护，视图不再自行判断。
  const writePlan = React.useMemo(() => planCitationWrite({ entries: selectedEntries, canWrite }), [selectedEntries, canWrite])
  const citationPreview = writePlan.text
  const degraded = store.isDegraded()

  const switchProject = value => {
    setProject(value)
    setActiveProject(value)
    setConfirmClear(false)
    setSelectedIds([])
  }
  const writeSelected = () => {
    if (writePlan.action === 'write') inputActions.setDraft(writePlan.text)
    setNotice(writePlan.notice)
  }

  const createProject = () => {
    const name = String(newProject || '').trim()
    if (!name) return
    switchProject(name)
    setNewProject('')
    setNewProjectOpen(false)
  }

  const exportJson = () => {
    try {
      const text = serializeEvidenceBackup({ entries, project })
      const suffix = project || '全部项目'
      downloadJson(text, `dsh-research-kit-evidence-${suffix}-${stamp()}.json`)
      setNotice(`已导出 ${entries.length} 条证据${project ? `（项目：${project}）` : '（全部项目）'}。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  // 解释图素材包：按当前筛选范围导出（通常先筛「已核验」），供 render-diagrams --evidence 并入「证据库来源」卡片。
  const exportExplainPack = () => {
    try {
      if (!filtered.length) return setNotice('当前筛选范围内没有可导出的证据条目。')
      const text = JSON.stringify(buildEvidenceExplainPack(filtered, project), null, 2) + '\n'
      const suffix = project || '全部项目'
      downloadJson(text, `evidence-explain-pack-${suffix}-${stamp()}.json`)
      setNotice(`已导出 ${filtered.length} 条证据作为解释图素材（按当前筛选范围；渲染时用 --evidence <路径> 并入）。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  const importJson = async () => {
    try {
      const parsed = parseEvidenceBackup(backup)
      const all = await store.list()
      const merged = mergeEntries(all, parsed.entries)
      const fresh = merged.rows.filter(row => !all.some(item => item.id === row.id))
      if (fresh.length) await store.importMany(fresh)
      setBackup('')
      setBackupOpen(false)
      publishEvidenceVault()
      const tail = merged.skipped ? `，跳过 ${merged.skipped} 条已存在` : ''
      const bad = merged.invalid ? `，${merged.invalid} 条无法追溯已忽略` : ''
      setNotice(`已恢复 ${merged.added} 条证据${tail}${bad}。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  const removeEntry = async item => {
    try {
      await store.remove(item.id)
      publishEvidenceVault()
      setNotice(`已删除「${item.title}」。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  const changeStatus = async (item, status) => {
    if (status === item.status) return
    try {
      await store.save({ ...item, status }, { onDuplicate: 'update' })
      publishEvidenceVault()
      setNotice(`「${item.title}」已标记为${EVIDENCE_STATUS_LABELS[status]}。`)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  // 当前项目为空时这里是「清空全部项目」，文案必须说清范围，不能只写「清空」。
  const clearScope = async () => {
    try {
      let message
      if (project) {
        const removed = await store.removeByProject(project)
        message = `已彻底删除项目「${project}」下的 ${removed} 条证据。`
      } else {
        await store.clear()
        message = '已彻底删除全部项目的证据。'
      }
      setConfirmClear(false)
      publishEvidenceVault()
      setNotice(message)
    } catch (error) { setNotice(`⚠️ ${error?.message || error}`) }
  }

  const filterOptions = [
    { value: 'all', label: `全部 ${counts.all}` },
    ...EVIDENCE_STATUSES.map(status => ({ value: status, label: `${EVIDENCE_STATUS_LABELS[status]} ${counts[status] || 0}` })),
  ]
  const projectOptions = [
    { value: '', label: '全部项目' },
    ...projects.map(name => ({ value: name, label: name })),
    ...(project && !projects.includes(project) ? [{ value: project, label: project }] : []),
  ]

  return h('div', { key: 'evidence-vault', style: { display: 'grid', gap: 12 } }, [
    degraded && !loading ? h(Notice, { key: 'degraded', tone: 'warn', icon: 'shield' },
      '当前环境未提供可用的 IndexedDB，证据暂存在内存中，刷新页面后会丢失。') : null,
    notice ? h(Notice, { key: 'notice', tone: notice.startsWith('⚠️') ? 'warn' : 'info', icon: notice.startsWith('⚠️') ? 'shield' : 'check' },
      notice.replace(/^⚠️\s*/, '')) : null,

    // 项目与维护动作：一次性操作，不随滚动吸顶（分层原则见 docs/ARCHITECTURE.md §2.3）。
    h(Card, { key: 'project-bar', style: { display: 'grid', gap: 10 } }, [
      h('div', { key: 'row', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        h('strong', { key: 'label', style: { fontSize: 13 } }, '当前项目'),
        h(Select, { key: 'select', value: project, options: projectOptions, onChange: switchProject, ariaLabel: '切换项目', style: { width: 'auto', minWidth: 140 } }),
        h(Button, { key: 'new', size: 'sm', variant: 'ghost', icon: 'plus', onClick: () => setNewProjectOpen(value => !value) }, '新建项目'),
        h('span', { key: 'spacer', style: { flex: '1 1 auto' } }),
        h(Button, { key: 'export', size: 'sm', variant: 'soft', icon: 'download', onClick: exportJson, disabled: !entries.length }, '导出备份'),
        h(Button, { key: 'export-pack', size: 'sm', variant: 'soft', icon: 'download', onClick: exportExplainPack, disabled: !filtered.length }, '导出解释图素材'),
        h(Button, { key: 'import', size: 'sm', variant: 'ghost', icon: 'upload', onClick: () => setBackupOpen(value => !value) }, '恢复备份'),
        confirmClear
          ? h(Button, { key: 'clear-confirm', size: 'sm', variant: 'danger', icon: 'trash', onClick: clearScope },
            project ? `确认删除「${project}」全部` : '确认删除全部项目')
          : h(Button, { key: 'clear', size: 'sm', variant: 'ghost', icon: 'trash', onClick: () => setConfirmClear(true), disabled: !entries.length },
            project ? '清空本项目' : '清空全部'),
      ]),
      newProjectOpen ? h('div', { key: 'new-row', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
        h(Input, { key: 'i', value: newProject, onChange: setNewProject, placeholder: '项目名称，例：肿瘤队列分析', ariaLabel: '新项目名称', style: { flex: '1 1 200px' } }),
        h(Button, { key: 'go', size: 'sm', variant: 'primary', disabled: !newProject.trim(), onClick: createProject }, '创建并切换'),
      ]) : null,
      backupOpen ? h('div', { key: 'backup', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 't', style: { fontSize: 12, color: C.muted } }, '粘贴此前导出的 JSON 备份（增量合并：已存在的条目跳过，不会覆盖现有笔记）'),
        h(Textarea, { key: 'i', value: backup, onChange: setBackup, rows: 5, mono: true, ariaLabel: 'JSON 备份内容' }),
        h('div', { key: 'row', style: { display: 'flex', gap: 8 } }, [
          h(Button, { key: 'go', size: 'sm', variant: 'primary', disabled: !backup.trim(), onClick: importJson }, '恢复'),
          h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => { setBackupOpen(false); setBackup('') } }, '取消'),
        ]),
      ]) : null,
    ]),

    // 二级吸顶带：检索与状态筛选是「随时要用的操作」，分层原则见 docs/ARCHITECTURE.md §2.3。
    h(Toolbar, { key: 'filters', sticky: true }, [
      h('div', { key: 'search', style: { position: 'relative', flex: '1 1 240px', minWidth: 180 } }, [
        h(Input, { key: 'i', value: query, onChange: setQuery, placeholder: '搜索标题、来源、标识符、项目、标签……', ariaLabel: '搜索证据条目' }),
      ]),
      h(Segmented, { key: 'tabs', value: filter, options: filterOptions, onChange: setFilter, ariaLabel: '证据核验状态筛选' }),
      h(Button, { key: 'write', size: 'sm', variant: 'primary', icon: 'edit', disabled: !selectedEntries.length || !canWrite, onClick: writeSelected }, `写入 Prompt（${selectedEntries.length}）`),
    ]),
    selectedEntries.length ? h(Card, { key: 'preview', style: { padding: 12, background: C.tealTint, border: `1px solid ${C.tealLine}` } }, [
      h('strong', { key: 't', style: { fontSize: 13 } }, `引用块预览（${selectedEntries.length} 条）`),
      h('pre', { key: 'p', style: { margin: '8px 0 0', whiteSpace: 'pre-wrap', fontFamily: C.fontMono, fontSize: 12, lineHeight: 1.55 } }, citationPreview),
    ]) : null,
    loading ? h(Spinner, { key: 'loading', text: '正在加载证据条目……' }) : null,
    !loading && !filtered.length ? h(EmptyState, {
      key: 'empty',
      icon: 'database',
      text: entries.length ? '没有匹配的证据条目。' : (project ? `项目「${project}」还没有证据。` : '证据库还是空的。'),
      hint: entries.length ? '调整搜索或筛选条件。' : '在「资源与工作流」里查询公开数据源，逐条点「保存到证据库」。',
    }) : null,
    h('div', { key: 'list', style: { display: 'grid', gap: 12 } }, filtered.map(item => h(Card, { key: item.id, interactive: true }, [
      h('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' } }, [
        h('div', { key: 'meta', style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 } }, [
          h('input', { key: 'select', type: 'checkbox', checked: selectedIds.includes(item.id), onChange: () => setSelectedIds(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id]), 'aria-label': `勾选「${item.title}」写入 Prompt`, style: { accentColor: C.teal } }),
          item.url
            ? h('a', { key: 'title', href: item.url, target: '_blank', rel: 'noreferrer noopener', style: { fontSize: 15, fontWeight: 700, color: C.teal, lineHeight: 1.45 } }, item.title)
            : h('strong', { key: 'title', style: { fontSize: 15 } }, item.title),
          h(Badge, { key: 'status', color: STATUS_COLORS[item.status] || C.muted }, EVIDENCE_STATUS_LABELS[item.status] || item.status),
          item.sourceDatabase ? h(Badge, { key: 'db', color: C.slate }, item.sourceDatabase) : null,
          item.identifier ? h(Badge, { key: 'id', color: C.teal }, `${EVIDENCE_IDENTIFIER_LABELS[item.identifierKind] || '标识符'} ${item.identifier}`) : null,
        ]),
        h('span', { key: 'time', style: { fontSize: 12, color: C.muted, flexShrink: 0 } }, `保存于 ${formatEvidenceTime(item.savedAt)}`),
      ]),
      item.reason || item.note || item.project || (item.tags || []).length
        ? h('div', { key: 'body', style: { display: 'grid', gap: 4, fontSize: 12, color: C.muted } }, [
          item.reason ? h('p', { key: 'reason', style: { margin: 0 } }, `保存原因：${item.reason}`) : null,
          item.note ? h('p', { key: 'note', style: { margin: 0 } }, `笔记：${item.note}`) : null,
          item.project ? h('p', { key: 'project', style: { margin: 0 } }, `项目：${item.project}`) : null,
          (item.tags || []).length ? h('div', { key: 'tags', style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 } },
            item.tags.map(tag => h(Chip, { key: tag, color: C.slate }, tag))) : null,
        ])
        : null,
      h('div', { key: 'foot', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 } }, [
        h('span', { key: 'label', style: { fontSize: 12, color: C.muted } }, '核验状态'),
        h(Select, {
          key: 'status',
          value: item.status,
          options: EVIDENCE_STATUSES.map(status => ({ value: status, label: EVIDENCE_STATUS_LABELS[status] })),
          onChange: value => changeStatus(item, value),
          ariaLabel: `设置「${item.title}」的核验状态`,
          style: { width: 'auto', minWidth: 96 },
        }),
        h('span', { key: 'spacer', style: { flex: '1 1 auto' } }),
        h(Button, { key: 'delete', size: 'sm', variant: 'danger', icon: 'trash', onClick: () => removeEntry(item) }, '删除'),
      ]),
    ]))),
  ])
}
