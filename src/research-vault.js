import React from 'react'
import { h, C, GlobalStyle } from './theme.js'
import { Icon } from './lib/icons.js'
import {
  Page, PageHead, Toolbar, Card, Button, StarButton, Badge, Chip,
  Field, Input, Textarea, Select, Notice, Segmented, EmptyState, Spinner,
} from './ui.js'
import { assertManageableBody, filterAssets } from './lib/vault-core.js'
import { deriveAssetEvidenceCandidates } from './lib/asset-evidence-links.js'
import {
  EvidenceVaultPane, evidenceVaultStore, subscribeEvidenceVault,
  linkAssetToEvidence, removeAssetEvidenceLinkEntry,
} from './research-evidence-vault.js'
import { knowledgeStore } from './knowledge-store.js'

// 研究灵感资产：PromptKit Vault 概念的科研化视图。数据仍存于
// StaticAssetProvider（localStorage，前缀 dsh-research-kit.promptkit.），
// 本视图补齐 QuickEnhancer 抽屉之外的完整管理能力：搜索、编辑、派生、
// 版本对比、导出/恢复、验证状态跟进。
//
// 隐私边界（与迁移文档 Phase D 一致）：
//   - 只保存可复用 Prompt、研究问题、待验证假设等轻量文本资产；
//   - 不保存原始附件、患者数据、完整查询结果（表单明示，导入时过滤超长正文）。

const THINKING_LABELS = { question: '研究问题', fact: '事实', assumption: '假设', decision: '决策', method: '方法', conclusion: '结论', action: '行动' }
const EPISTEMIC_LABELS = { verified: '已证实', inferred: '推断', to_verify: '待核实', preference: '个人偏好' }
const EPISTEMIC_COLORS = { verified: C.statusVerified, inferred: C.statusInferred, to_verify: C.statusToVerify, preference: C.statusPreference }
const VERIFICATION_LABELS = { confirmed: '已证实', pending: '待验证', refuted: '已被推翻', inconclusive: '暂无结论' }
const VERIFICATION_COLORS = { confirmed: C.statusVerified, pending: C.statusToVerify, refuted: C.statusRefuted, inconclusive: C.muted }
const VAULT_TYPE_LABELS = { prompt: '提示词', snippet: '片段', insight: '研究见解' }

// 沉淀层的两个子模块：灵感资产回答「想过什么」，证据库回答「依据什么」。
// 刻意不做成第五个并列分区——ROADMAP §4 的产品定位是「沉淀层升级为研究资产库」，
// 先把两个子模块收在同一层里，等 4b–4d 落地后再整体更名。
const VAULT_TABS = [
  { value: 'assets', label: '灵感资产' },
  { value: 'evidence', label: '证据库' },
]

function formatAssetTime(at) {
  try { return new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

const EMPTY_FORM = {
  id: '', title: '', body: '', tags: '', note: '', project: '', type: 'insight',
  thinkingKind: 'question', epistemicStatus: 'to_verify', parentId: '',
  rationale: '', nextAction: '', verificationStatus: 'pending', verificationEvidence: ''
}

export function ResearchVault({ assetProvider, inputActions, embedded = false }) {
  const [assets, setAssets] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState('all')
  const [form, setForm] = React.useState(EMPTY_FORM)
  const [formOpen, setFormOpen] = React.useState(false)
  const [compareId, setCompareId] = React.useState('')
  const [backup, setBackup] = React.useState('')
  const [backupOpen, setBackupOpen] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  const [tab, setTab] = React.useState('assets')
  const setError = message => setNotice(`⚠️ ${message}`)
  // ── 资产-证据互链（入口 A，ROADMAP §11 P5）────────────────────────────────
  // 候选只推导、用户勾选确认后建立（绝不自动建边）；展开态与勾选集都是纯视图状态。
  const [linkAssetId, setLinkAssetId] = React.useState('')
  const [evidenceEntries, setEvidenceEntries] = React.useState([])
  const [assetLinks, setAssetLinks] = React.useState([])
  const [knowledgeNodes, setKnowledgeNodes] = React.useState([])
  const [checkedCandidates, setCheckedCandidates] = React.useState({})
  const [linkBusy, setLinkBusy] = React.useState(false)

  const refreshLinks = React.useCallback(() => {
    evidenceVaultStore().list().then(rows => setEvidenceEntries(rows || [])).catch(() => setEvidenceEntries([]))
    evidenceVaultStore().listAssetEvidenceLinks().then(rows => setAssetLinks(rows || [])).catch(() => setAssetLinks([]))
    knowledgeStore().listNodes().then(rows => setKnowledgeNodes(rows || [])).catch(() => setKnowledgeNodes([]))
  }, [])
  React.useEffect(() => { refreshLinks() }, [refreshLinks])
  React.useEffect(() => subscribeEvidenceVault(refreshLinks), [refreshLinks])

  const assetsById = React.useMemo(() => Object.fromEntries(assets.map(item => [item.id, item.title || '未命名资产'])), [assets])

  const refresh = React.useCallback(() => {
    if (!assetProvider?.list) { setLoading(false); return }
    assetProvider.list().then(rows => { setAssets(rows || []); setLoading(false) }).catch(error => { setError(error?.message || error); setLoading(false) })
  }, [assetProvider])
  React.useEffect(() => { refresh() }, [refresh])
  React.useEffect(() => assetProvider?.onChange?.(refresh) || undefined, [refresh])

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const byId = React.useMemo(() => new Map(assets.map(item => [item.id, item])), [assets])
  const filtered = React.useMemo(() => filterAssets(assets, { query, filter }), [assets, query, filter])
  const projects = React.useMemo(() => [...new Set(assets.map(item => item.project).filter(Boolean))].sort(), [assets])

  const openCreate = () => { setForm({ ...EMPTY_FORM }); setFormOpen(true); setCompareId('') }
  const openEdit = item => {
    setForm({
      id: item.id, title: item.title || '', body: item.body || '', tags: (item.tags || []).join(', '),
      note: item.note || '', project: item.project || '', type: item.type || 'insight',
      thinkingKind: item.thinkingKind || 'question', epistemicStatus: item.epistemicStatus || 'inferred',
      parentId: item.parentId || '', rationale: item.rationale || '', nextAction: item.nextAction || '',
      verificationStatus: item.verification?.status || 'pending', verificationEvidence: item.verification?.evidence || ''
    })
    setFormOpen(true)
  }
  const derive = item => {
    setForm({ ...EMPTY_FORM, title: `${item.title} · 变体`, body: item.body, tags: (item.tags || []).join(', '), type: item.type || 'insight', project: item.project || '', parentId: item.id, thinkingKind: item.thinkingKind || 'question', epistemicStatus: item.epistemicStatus || 'inferred', rationale: item.rationale || '', nextAction: item.nextAction || '' })
    setFormOpen(true); setCompareId(item.id)
    setNotice(`已载入「${item.title}」作为派生版本；保存后保留来源关系，可做版本对比。`)
  }
  const save = async () => {
    if (!assetProvider?.save) return setError('灵感资产服务未连接。')
    if (!String(form.body).trim()) return setError('资产内容不能为空。')
    try {
      assertManageableBody(form.body)
      await assetProvider.save({
        id: form.id || undefined,
        title: form.title,
        body: form.body,
        tags: form.tags,
        note: form.note,
        type: form.type,
        project: form.project,
        parentId: form.parentId,
        thinkingKind: form.thinkingKind,
        epistemicStatus: form.epistemicStatus,
        rationale: form.rationale,
        nextAction: form.nextAction,
        verification: { status: form.verificationStatus, evidence: form.verificationEvidence, checkedAt: form.verificationStatus === 'pending' ? 0 : Date.now() },
      })
      setFormOpen(false); setCompareId('')
      setNotice(form.id ? '已更新资产。' : '已保存资产。')
    } catch (error) { setError(error?.message || error) }
  }
  const remove = async item => {
    if (!assetProvider?.remove) return
    try {
      await assetProvider.remove(item.id)
      // 本视图能钩到的资产删除：联动解除以其为一端的 link。
      // vendored 面板（增强器知识区等）的删除钩不到——图谱与列表对悬空端点优雅兜底。
      await evidenceVaultStore().removeAssetEvidenceLinks({ assetId: item.id })
      setNotice(`已删除「${item.title}」。`)
    } catch (error) { setError(error?.message || error) }
  }

  // ── 关联证据（入口 A）─────────────────────────────────────────────────────
  const linksForAsset = React.useCallback(
    assetId => assetLinks.filter(row => row.assetId === assetId),
    [assetLinks],
  )
  const candidatesForAsset = React.useCallback(
    item => deriveAssetEvidenceCandidates({
      asset: item, evidenceEntries, knowledgeNodes, existingLinks: linksForAsset(item.id),
    }),
    [evidenceEntries, knowledgeNodes, linksForAsset],
  )
  const evidenceById = React.useMemo(() => new Map(evidenceEntries.map(entry => [entry.id, entry])), [evidenceEntries])
  const toggleCandidate = (assetId, evidenceId) => {
    setCheckedCandidates(current => {
      const set = new Set(current[assetId] || [])
      if (set.has(evidenceId)) set.delete(evidenceId); else set.add(evidenceId)
      return { ...current, [assetId]: set }
    })
  }
  const createLinks = async item => {
    const picked = [...(checkedCandidates[item.id] || [])]
    if (!picked.length || linkBusy) return
    setLinkBusy(true)
    try {
      let created = 0
      for (const evidenceId of picked) {
        const result = await linkAssetToEvidence({ assetId: item.id, evidenceId, project: item.project || '' })
        if (result?.created) created++
      }
      setCheckedCandidates(current => ({ ...current, [item.id]: new Set() }))
      setNotice(created ? `已建立 ${created} 条关联；可在证据条目与图谱中看到。` : '所选关联均已存在。')
    } catch (error) { setError(error?.message || error) } finally { setLinkBusy(false) }
  }
  const unlink = async link => {
    try {
      await removeAssetEvidenceLinkEntry(link.id)
      setNotice('已解除关联。')
    } catch (error) { setError(error?.message || error) }
  }
  const toggleFavorite = async item => {
    if (!assetProvider?.toggleFavorite) return
    try { await assetProvider.toggleFavorite(item.id) } catch (error) { setError(error?.message || error) }
  }
  const markVerified = async item => {
    if (!assetProvider?.save) return
    try {
      await assetProvider.save({ ...item, verification: { status: 'confirmed', evidence: item.verification?.evidence || '已在研究视图中人工确认。', checkedAt: Date.now() }, epistemicStatus: 'verified' })
      setNotice(`「${item.title}」已标记为已证实。`)
    } catch (error) { setError(error?.message || error) }
  }
  const useInConversation = async (item, inputActions) => {
    const draft = String(item.nextAction || item.body || '')
    if (!draft) return
    if (typeof inputActions?.setDraft !== 'function') return setError('当前会话未提供输入框操作；可复制内容手动粘贴。')
    inputActions.setDraft(draft)
    await assetProvider?.markUsed?.(item.id)
    setNotice(`已把「${item.title}」写入输入框，可编辑后发送。`)
  }
  const exportJson = async () => {
    try {
      const contents = await assetProvider.export()
      const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = 'dsh-research-kit-vault.json'; link.click(); URL.revokeObjectURL(url)
      setNotice('已导出研究灵感资产备份（JSON）。')
    } catch (error) { setError(error?.message || error) }
  }
  const importJson = async () => {
    try {
      const rows = await assetProvider.import(backup)
      setBackup(''); setBackupOpen(false)
      setNotice(`已恢复 ${rows?.length || 0} 条研究灵感资产。`)
    } catch (error) { setError(error?.message || error) }
  }
  const copyBody = async item => {
    try { await navigator.clipboard.writeText(item.body); await assetProvider?.markUsed?.(item.id); setNotice('已复制资产内容。') }
    catch { setError('复制失败，请手动选择内容复制。') }
  }

  const field = (label, key, { multiline = false, placeholder = '' } = {}) => h(Field, { key, label, hint: placeholder || null },
    multiline
      ? h(Textarea, { value: form[key], onChange: value => update(key, value), rows: key === 'body' ? 8 : 3, placeholder, ariaLabel: label })
      : h(Input, { value: form[key], onChange: value => update(key, value), placeholder, ariaLabel: label }))
  const select = (label, key, options) => h(Field, { key, label },
    h(Select, { value: form[key], onChange: value => update(key, value), options, ariaLabel: label }))

  const compareItem = compareId ? byId.get(compareId) : null
  const filterTabs = [
    { value: 'all', label: `全部 ${assets.length}` },
    { value: 'to_verify', label: `待验证 ${assets.filter(item => item.verification?.status === 'pending' || item.epistemicStatus === 'to_verify').length}` },
    { value: 'favorites', label: `★ 收藏 ${assets.filter(item => item.favorite).length}` },
    { value: 'derived', label: `派生版本 ${assets.filter(item => item.parentId).length}` },
  ]
  const content = [
    h(PageHead, {
      key: 'head',
      kicker: 'Research Kit',
      title: tab === 'evidence' ? '研究证据库' : '研究资产库',
      lead: tab === 'evidence'
        ? '沉淀逐条明确保存、可追溯的外部来源；保存不等于认可，新条目默认「未核验」。'
        : '两个子模块并列：灵感资产沉淀可复用的提示词、研究问题与待验证假设；证据库存放逐条确认的公开来源。原始数据与完整查询结果不入库。',
      actions: tab === 'evidence' ? [] : [
        h(Button, { key: 'export', variant: 'soft', icon: 'download', onClick: exportJson }, '导出备份'),
        h(Button, { key: 'import', variant: 'ghost', icon: 'upload', onClick: () => setBackupOpen(value => !value) }, '恢复备份'),
      ],
    }),
    h('div', { key: 'subnav', style: { marginTop: 14 } }, [
      h(Segmented, { key: 'tabs', value: tab, options: VAULT_TABS, onChange: setTab, ariaLabel: '沉淀层子模块' }),
    ]),
    tab === 'assets' && backupOpen ? h(Card, { key: 'backup', style: { marginTop: 16, display: 'grid', gap: 10 } }, [
      h('strong', { key: 't', style: { fontSize: 13 } }, '粘贴此前导出的 JSON 备份（增量合并，不覆盖现有资产）'),
      h(Textarea, { key: 'i', value: backup, onChange: setBackup, rows: 5, mono: true, ariaLabel: 'JSON 备份内容' }),
      h('div', { key: 'row', style: { display: 'flex', gap: 8 } }, [
        h(Button, { key: 'go', variant: 'primary', disabled: !backup.trim(), onClick: importJson }, '恢复'),
        h(Button, { key: 'cancel', variant: 'ghost', onClick: () => { setBackupOpen(false); setBackup('') } }, '取消'),
      ]),
    ]) : null,
    tab === 'assets' && formOpen ? h(Card, {
      key: 'form',
      style: { marginTop: 16, display: 'grid', gap: 12, border: `1px solid ${C.tealLine}`, background: C.surface },
    }, [
      h('strong', { key: 't', style: { fontSize: 14 } }, form.id ? `编辑「${form.title || '未命名资产'}」` : '新建研究灵感资产'),
      field('标题（留空自动取正文首行）', 'title', { placeholder: '例：单细胞批次效应的待验证假设' }),
      field('内容', 'body', { multiline: true, placeholder: '只保存可复用的提示词、研究问题或假设；不要粘贴原始数据、患者信息或完整查询结果。' }),
      h('div', { key: 'grid', className: 'rk-form-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 } }, [
        field('标签（逗号分隔）', 'tags', { placeholder: '批次效应, 单细胞' }),
        field('项目（可选）', 'project', { placeholder: '例：肿瘤队列分析' }),
        select('类型', 'type', Object.entries(VAULT_TYPE_LABELS).map(([value, label]) => ({ value, label }))),
        select('认识分类', 'thinkingKind', Object.entries(THINKING_LABELS).map(([value, label]) => ({ value, label }))),
        select('认识状态', 'epistemicStatus', Object.entries(EPISTEMIC_LABELS).map(([value, label]) => ({ value, label }))),
        select('验证状态', 'verificationStatus', Object.entries(VERIFICATION_LABELS).map(([value, label]) => ({ value, label }))),
      ]),
      field('为什么重要（可选）', 'rationale', { multiline: true }),
      field('下一步（可选；可直接写入会话输入框）', 'nextAction', { multiline: true }),
      field('验证证据（可选）', 'verificationEvidence', { multiline: true }),
      form.parentId ? h('p', { key: 'parent', style: { margin: 0, color: C.muted, fontSize: 12 } }, `派生自：${byId.get(form.parentId)?.title || form.parentId}（保存后可在列表中做版本对比）`) : null,
      h('div', { key: 'row', style: { display: 'flex', gap: 8 } }, [
        h(Button, { key: 'save', variant: 'primary', icon: 'check', onClick: save }, form.id ? '保存修改' : '保存资产'),
        h(Button, { key: 'cancel', variant: 'ghost', onClick: () => { setFormOpen(false); setCompareId('') } }, '取消'),
      ]),
    ]) : null,
    // 二级吸顶带 = 该分区「随时要用的操作」：检索、状态筛选、项目筛选、新建资产。
    // 「新建资产」是最高频的主操作，随页面滚走后每次都要先滚回顶部；导出/恢复是一次性
    // 维护动作，留在封面即可。分层原则见 docs/ARCHITECTURE.md §2.3。
    tab === 'assets' ? h(Toolbar, { key: 'filters', sticky: true }, [
      h('div', { key: 'search', style: { position: 'relative', flex: '1 1 240px', minWidth: 180 } }, [
        h('span', { key: 'icon', 'aria-hidden': 'true', style: { position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, display: 'flex' } }, h(Icon, { name: 'search', size: 14 })),
        h(Input, { key: 'i', value: query, onChange: setQuery, placeholder: '搜索标题、内容、标签、项目……', ariaLabel: '搜索灵感资产', style: { paddingLeft: 32 } }),
      ]),
      h(Segmented, { key: 'tabs', value: filter, options: filterTabs, onChange: setFilter, ariaLabel: '资产筛选' }),
      projects.length ? h(Select, {
        key: 'projects',
        value: '',
        onChange: value => { if (value) setQuery(value) },
        ariaLabel: '按项目筛选',
        options: [{ value: '', label: `项目：${projects.join('、')}` }, ...projects.map(project => ({ value: project, label: project }))],
        style: { width: 'auto' },
      }) : null,
      h(Button, { key: 'new', variant: 'primary', icon: 'plus', onClick: openCreate, style: { flexShrink: 0 } }, '新建资产'),
    ]) : null,
    tab === 'evidence' ? h(EvidenceVaultPane, { key: 'evidence-pane', inputActions, assetTitlesById: assetsById }) : null,
    tab === 'assets' && loading ? h(Spinner, { key: 'loading', text: '正在加载灵感资产……' }) : null,
    tab === 'assets' && !loading && !filtered.length ? h(EmptyState, {
      key: 'empty',
      icon: 'bookmark',
      text: assets.length ? '没有匹配的资产。' : '还没有灵感资产。',
      hint: assets.length ? '调整搜索或筛选条件。' : '在草稿增强或方法工坊中保存，或点击「新建资产」。',
    }) : null,
    tab === 'assets' ? h('div', { key: 'list', style: { display: 'grid', gap: 12 } }, filtered.map(item => h(Card, { key: item.id, interactive: true }, [
      h('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' } }, [
        h('div', { key: 'meta', style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 } }, [
          h('strong', { key: 'title', style: { fontSize: 15 } }, item.title),
          h(Badge, { key: 'type', color: C.teal }, VAULT_TYPE_LABELS[item.type] || item.type),
          h(Badge, { key: 'kind', color: C.slate }, THINKING_LABELS[item.thinkingKind] || '结论'),
          h(Badge, { key: 'epistemic', color: EPISTEMIC_COLORS[item.epistemicStatus] || C.statusInferred }, EPISTEMIC_LABELS[item.epistemicStatus] || '推断'),
          item.verification?.status && item.verification.status !== 'pending'
            ? h(Badge, { key: 'verification', color: VERIFICATION_COLORS[item.verification.status] || C.muted }, `验证：${VERIFICATION_LABELS[item.verification.status]}`)
            : null,
        ]),
        h(StarButton, {
          key: 'star',
          active: Boolean(item.favorite),
          onClick: () => toggleFavorite(item),
          label: `${item.favorite ? '取消收藏' : '收藏'}${item.title}`,
        }),
      ]),
      h('div', {
        key: 'body',
        className: 'rk-scroll',
        style: { whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 13, color: C.ink, maxHeight: 180, overflowY: 'auto' },
      }, item.body),
      item.rationale || item.nextAction || (item.tags || []).length || item.project ? h('div', { key: 'meta', style: { display: 'grid', gap: 4, fontSize: 12, color: C.muted } }, [
        item.rationale ? h('p', { key: 'rationale', style: { margin: 0 } }, `为什么重要：${item.rationale}`) : null,
        item.nextAction ? h('p', { key: 'next', style: { margin: 0 } }, `下一步：${item.nextAction}`) : null,
        item.project ? h('p', { key: 'project', style: { margin: 0 } }, `项目：${item.project}`) : null,
        (item.tags || []).length ? h('div', { key: 'tags', style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 } }, item.tags.map(tag => h(Chip, { key: tag, color: C.slate }, tag))) : null,
      ]) : null,
      h('div', { key: 'foot', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: C.muted } }, [
        h('span', { key: 'time' }, `更新于 ${formatAssetTime(item.updatedAt)}${item.useCount ? ` · 使用 ${item.useCount} 次` : ''}`),
        h(Button, { key: 'edit', size: 'sm', variant: 'ghost', icon: 'edit', onClick: () => openEdit(item) }, '编辑'),
        h(Button, { key: 'derive', size: 'sm', variant: 'ghost', icon: 'branch', onClick: () => derive(item) }, '派生变体'),
        item.parentId ? h(Button, { key: 'compare', size: 'sm', variant: 'soft', icon: 'layers', onClick: () => setCompareId(current => current === item.id ? '' : item.id) }, compareId === item.id ? '收起对比' : '与来源对比') : null,
        item.verification?.status === 'pending' || item.epistemicStatus === 'to_verify' ? h(Button, { key: 'verify', size: 'sm', variant: 'soft', icon: 'check', onClick: () => markVerified(item) }, '标记已证实') : null,
        h(Button, {
          key: 'links', size: 'sm', variant: linkAssetId === item.id ? 'soft' : 'ghost', icon: 'link',
          onClick: () => setLinkAssetId(current => current === item.id ? '' : item.id),
        }, `关联证据（${linksForAsset(item.id).length}）`),
        h(Button, { key: 'copy', size: 'sm', variant: 'ghost', icon: 'copy', onClick: () => copyBody(item) }, '复制'),
        h(Button, { key: 'delete', size: 'sm', variant: 'danger', icon: 'trash', onClick: () => remove(item) }, '删除'),
      ]),
      compareId === item.id && compareItem ? h('div', { key: 'diff', className: 'rk-diff', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } }, [
        h('div', { key: 'old' }, [
          h('strong', { key: 'l', style: { fontSize: 12, color: C.muted } }, `来源：${compareItem.title}`),
          h('div', { key: 'b', className: 'rk-scroll', style: { marginTop: 6, padding: 10, border: `1px solid ${C.line}`, borderRadius: 9, background: C.surfaceAlt, whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 160, overflowY: 'auto' } }, compareItem.body),
        ]),
        h('div', { key: 'new' }, [
          h('strong', { key: 'l', style: { fontSize: 12, color: C.teal } }, `当前：${item.title}`),
          h('div', { key: 'b', className: 'rk-scroll', style: { marginTop: 6, padding: 10, border: `1px solid ${C.tealLine}`, borderRadius: 9, background: C.tealTint, whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 160, overflowY: 'auto' } }, item.body),
        ]),
      ]) : null,
      // 入口 A（主）：关联证据。候选按项目/标签/知识链种子推导，用户勾选确认后建立——
      // 推导≠建边，绝不自动建立（全仓库「检索 → 预览 → 确认」纪律的落点）。
      linkAssetId === item.id ? h('div', { key: 'asset-links', style: { display: 'grid', gap: 10, padding: 12, border: `1px solid ${C.tealLine}`, borderRadius: 10, background: C.surfaceAlt } }, (() => {
        const current = linksForAsset(item.id)
        const candidates = candidatesForAsset(item)
        const picked = checkedCandidates[item.id] || new Set()
        return [
          h('strong', { key: 't', style: { fontSize: 13 } }, '关联证据'),
          h('div', { key: 'hint', style: { fontSize: 12, color: C.muted, lineHeight: 1.5 } },
            '把这条灵感资产与支撑它的证据显式挂链（可在图谱中看到「资产 → 支撑证据」）。候选按同项目、共同标签与自动沉淀的知识链推导；建立需要你在下方勾选确认，不会自动发生。'),
          current.length ? h('div', { key: 'current', style: { display: 'grid', gap: 6 } }, current.map(link => {
            const entry = evidenceById.get(link.evidenceId)
            return h('div', { key: link.id, style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, [
              h(Badge, { key: 's', color: entry?.status === 'verified' ? C.statusVerified : C.statusToVerify }, entry?.status === 'verified' ? '已核验' : '未核验'),
              h('span', { key: 'title', style: { fontSize: 12 } }, entry?.title || `（证据 ${String(link.evidenceId).slice(0, 12)}… 不在当前列表）`),
              h('span', { key: 'spacer', style: { flex: 1 } }),
              h(Button, { key: 'unlink', size: 'sm', variant: 'ghost', onClick: () => unlink(link) }, '解除'),
            ])
          })) : h('div', { key: 'none', style: { fontSize: 12, color: C.muted } }, '还没有关联的证据。'),
          candidates.length ? h('div', { key: 'candidates', style: { display: 'grid', gap: 6 } }, [
            h('strong', { key: 'ct', style: { fontSize: 12, color: C.muted } }, `候选证据（${candidates.length}）`),
            ...candidates.map(candidate => {
              const entry = evidenceById.get(candidate.evidenceId)
              return h('label', { key: candidate.evidenceId, style: { display: 'grid', gridTemplateColumns: '18px 1fr', gap: 8, alignItems: 'start', cursor: 'pointer', padding: '8px 10px', borderRadius: 8, border: `1px solid ${picked.has(candidate.evidenceId) ? C.tealLineStrong : C.line}`, background: picked.has(candidate.evidenceId) ? C.tealTint : C.surface } }, [
                h('input', {
                  key: 'box', type: 'checkbox', checked: picked.has(candidate.evidenceId),
                  onChange: () => toggleCandidate(item.id, candidate.evidenceId),
                  style: { marginTop: 2, accentColor: C.teal },
                  'aria-label': `关联证据「${candidate.title}」`,
                }),
                h('span', { key: 'text' }, [
                  h('span', { key: 'row', style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } }, [
                    h('strong', { key: 'title', style: { fontSize: 12 } }, candidate.title),
                    entry?.url ? h('a', { key: 'u', href: entry.url, target: '_blank', rel: 'noreferrer noopener', style: { fontSize: 11, color: C.teal } }, '打开来源') : null,
                  ]),
                  h('span', { key: 'why', style: { display: 'block', marginTop: 2, fontSize: 11, color: C.muted, lineHeight: 1.45 } },
                    `${candidate.reasons.join('；') || '手动选择'}${entry?.identifier ? ` · ${entry.identifier}` : ''}`),
                ]),
              ])
            }),
            h('div', { key: 'go', style: { display: 'flex', gap: 8 } }, [
              h(Button, {
                key: 'apply', size: 'sm', variant: 'primary', icon: 'link', disabled: !picked.size || linkBusy,
                onClick: () => createLinks(item),
              }, linkBusy ? '建立中…' : `建立关联（${picked.size}）`),
            ]),
          ]) : h('div', { key: 'no-candidates', style: { fontSize: 12, color: C.muted } },
            '没有推导出候选证据；可在「证据库」子模块保存来源后回来关联（同项目或知识链同源的条目会出现在这里）。'),
        ]
      })()) : null,
    ]))) : null,
    tab === 'assets' && notice ? h(Notice, {
      key: 'notice',
      tone: notice.startsWith('⚠️') ? 'warn' : 'info',
      icon: notice.startsWith('⚠️') ? 'shield' : 'check',
      style: { marginTop: 16 },
    }, notice.replace(/^⚠️\s*/, '')) : null,
  ]
  // embedded：由统一容器提供页面外壳与全局样式；独立挂载时保留 Page。
  return embedded
    ? h('div', { key: 'embedded', className: 'rk-page', style: { boxSizing: 'border-box', padding: '20px var(--rk-gutter) 48px', background: 'transparent', color: C.ink, fontFamily: C.font } }, content)
    : h(Page, null, [h(GlobalStyle, { key: 'global-style' }), ...content])
}

// 灵感资产管理视图宿主：由统一容器按 embedded 模式挂载；独立注册时保留 Page 外壳。
function ResearchVaultHost({ embedded = false, inputActions }) {
  return h(ResearchVault, { assetProvider: researchAssetProvider, embedded, inputActions })
}
