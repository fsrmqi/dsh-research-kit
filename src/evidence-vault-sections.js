import React from 'react'
import { Button, Card, Input, Select, Textarea } from './ui.js'
import { C, h } from './theme.js'
import { RESEARCH_EVIDENCE_STANCES } from './lib/research-claims.js'
import { researchLedgerSummary } from './lib/research-ledger.js'

export function EvidenceVaultTopCards({
  project, projectOptions, switchProject, activeWorkspace,
  newProjectOpen, setNewProjectOpen, newProject, setNewProject, createProject,
  workspaceRenameOpen, setWorkspaceRenameOpen, workspaceNameDraft, setWorkspaceNameDraft, renameProject,
  confirmArchiveWorkspace, setConfirmArchiveWorkspace, toggleProjectArchive,
  showArchivedWorkspaces, setShowArchivedWorkspaces,
  entries, claims, ledger, workspaces, filtered, counts,
  exportJson, exportExplainPack, setCitationOpen, exportCitations, backupOpen, setBackupOpen,
  confirmClear, setConfirmClear, clearScope,
  organizerBusy, loading, organizerJournal, previewOrganizer, undoOrganizer, finalizeOrganizer,
  organizerProgress, organizerLog, organizerPlan, setOrganizerPlan, applyOrganizer,
  backup, setBackup, importJson,
  quality,
  citationOpen, citationBusy, setNotice, citationText, setCitationText,
  citationPreviewRows, setCitationPreviewRows, citationPicked, setCitationPicked,
  previewCitations, citationWarnings, importCitations,
}) {
  const [manageOpen, setManageOpen] = React.useState(false)
  const [ioOpen, setIoOpen] = React.useState(false)
  const [clearConfirmText, setClearConfirmText] = React.useState('')
  React.useEffect(() => { setClearConfirmText('') }, [project, confirmClear])
  const clearExpected = project ? (activeWorkspace?.name || project) : '清空全部'
  const clearUnlocked = clearConfirmText.trim() === clearExpected
  const hasQualityIssues = Boolean(
    quality.missingIdentifier || quality.unverified || quality.staleOrMissing
    || quality.duplicateGroups.length || quality.orphanLinks.length,
  )
  const hasUndoableOrganizer = Boolean(organizerJournal?.fileId && !['undone', 'failed', 'finalized'].includes(organizerJournal.status))
  const canExportBackup = Boolean(entries.length || claims.length || ledger.length || workspaces.some(item => (!project || item.projectKey === project) && (item.origin === 'user' || item.updatedAt > 0)))

  return h(React.Fragment, null, [
    h(Card, { key: 'project-bar', style: { display: 'grid', gap: 10 } }, [
      h('div', { key: 'row', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        h('strong', { key: 'label', style: { fontSize: 13 } }, '当前课题'),
        h(Select, { key: 'select', value: project, options: projectOptions, onChange: switchProject, ariaLabel: '切换课题', style: { width: 'auto', minWidth: 140 } }),
        h(Button, { key: 'new', size: 'sm', variant: 'ghost', icon: 'plus', onClick: () => { setNewProjectOpen(value => !value); setIoOpen(false); setManageOpen(false); setCitationOpen(false) }, 'aria-expanded': newProjectOpen }, '新建课题'),
        h('span', { key: 'spacer', style: { flex: '1 1 auto' } }),
        h(Button, { key: 'citations', size: 'sm', variant: 'soft', onClick: () => { setCitationOpen(value => !value); setIoOpen(false); setManageOpen(false); setNewProjectOpen(false) }, 'aria-expanded': citationOpen }, '导入引用'),
        h(Button, { key: 'io', size: 'sm', variant: ioOpen ? 'soft' : 'ghost', 'aria-expanded': ioOpen, onClick: () => { setIoOpen(value => !value); setManageOpen(false); setNewProjectOpen(false); setCitationOpen(false) } }, ioOpen ? '收起导入导出' : '导入导出 ▾'),
        h(Button, { key: 'manage', size: 'sm', variant: manageOpen ? 'soft' : 'ghost', 'aria-expanded': manageOpen, onClick: () => { setManageOpen(value => !value); setIoOpen(false); setNewProjectOpen(false); setCitationOpen(false) } }, manageOpen ? '收起课题管理' : '课题管理 ▾'),
      ]),
      newProjectOpen ? h('div', { key: 'new-row', className: 'rk-reveal', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
        h(Input, { key: 'i', value: newProject, onChange: setNewProject, placeholder: '课题名称，例：大麦雄性不育', ariaLabel: '新课题名称', style: { flex: '1 1 200px' } }),
        h(Button, { key: 'go', size: 'sm', variant: 'primary', disabled: !newProject.trim(), onClick: createProject }, '创建并切换'),
      ]) : null,
      ioOpen ? h('div', { key: 'io-panel', className: 'rk-reveal', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 10, borderRadius: 9, background: C.surfaceAlt, border: `1px solid ${C.line}` } }, [
        h(Button, { key: 'bibtex', size: 'sm', variant: 'soft', disabled: !counts.all, onClick: () => exportCitations('bibtex') }, '导出 BibTeX'),
        h(Button, { key: 'ris', size: 'sm', variant: 'ghost', disabled: !counts.all, onClick: () => exportCitations('ris') }, '导出 RIS'),
        h(Button, { key: 'export-pack', size: 'sm', variant: 'ghost', icon: 'download', onClick: exportExplainPack, disabled: !filtered.length }, '导出解释图素材'),
        h('span', { key: 'capsule-hint', style: { marginLeft: 'auto', fontSize: 11, color: C.muted } }, '整库备份与恢复请使用顶栏「时空囊」'),
      ]) : null,
      manageOpen ? h('div', { key: 'manage-panel', className: 'rk-reveal', style: { display: 'grid', gap: 10, padding: 12, borderRadius: 9, background: C.surfaceAlt, border: `1px solid ${C.line}` } }, [
        h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
          project ? h(Button, { key: 'rename', size: 'sm', variant: 'ghost', onClick: () => { setWorkspaceNameDraft(activeWorkspace?.name || project); setWorkspaceRenameOpen(value => !value) } }, '改显示名') : null,
          project ? h(Button, { key: 'archive', size: 'sm', variant: 'ghost', onClick: () => activeWorkspace?.archived ? toggleProjectArchive() : setConfirmArchiveWorkspace(value => !value) }, activeWorkspace?.archived ? '恢复课题' : '归档课题') : null,
          confirmArchiveWorkspace ? h(Button, { key: 'archive-confirm', size: 'sm', variant: 'soft', onClick: toggleProjectArchive }, '确认归档（资料会保留）') : null,
          h(Button, { key: 'archived-toggle', size: 'sm', variant: 'ghost', onClick: () => setShowArchivedWorkspaces(value => !value) }, showArchivedWorkspaces ? '隐藏已归档' : '显示已归档'),
          h(Button, { key: 'preview', size: 'sm', variant: 'soft', disabled: organizerBusy || loading || hasUndoableOrganizer, onClick: previewOrganizer }, '一键整理课题'),
          hasUndoableOrganizer ? h(Button, { key: 'undo', size: 'sm', variant: 'ghost', disabled: organizerBusy, onClick: undoOrganizer }, '撤销上次整理') : null,
          organizerJournal?.status === 'applied' ? h(Button, { key: 'finalize', size: 'sm', variant: 'ghost', disabled: organizerBusy, onClick: finalizeOrganizer }, '保留结果并继续') : null,
        ]),
        workspaceRenameOpen ? h('div', { key: 'rename-row', className: 'rk-reveal', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
          h(Input, { key: 'input', value: workspaceNameDraft, onChange: setWorkspaceNameDraft, placeholder: '新的课题显示名', ariaLabel: '课题显示名', style: { flex: '1 1 200px' } }),
          h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: !workspaceNameDraft.trim(), onClick: renameProject }, '保存显示名'),
        ]) : null,
        h('div', { key: 'danger', className: 'rk-danger-zone' }, [
          h('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
            h('strong', { key: 't', style: { fontSize: 12, color: C.red } }, '危险操作 · 清空后不可恢复'),
            !confirmClear ? h(Button, {
              key: 'clear', size: 'sm', variant: 'danger', icon: 'trash',
              disabled: !entries.length,
              onClick: () => setConfirmClear(true),
            }, project ? '清空本课题证据' : '清空全部课题证据') : null,
          ]),
          confirmClear ? h('div', { key: 'confirm-row', className: 'rk-reveal', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
            h(Input, {
              key: 'input', value: clearConfirmText, onChange: setClearConfirmText,
              placeholder: `输入「${clearExpected}」以解锁删除`,
              ariaLabel: '输入确认文字以清空证据',
              style: { flex: '1 1 200px', borderColor: C.red },
            }),
            h(Button, {
              key: 'clear-confirm', size: 'sm', variant: 'danger', icon: 'trash',
              disabled: !clearUnlocked,
              onClick: clearScope,
            }, project ? `确认清空「${clearExpected}」` : '确认清空全部'),
            h(Button, {
              key: 'clear-cancel', size: 'sm', variant: 'ghost',
              onClick: () => { setConfirmClear(false); setClearConfirmText('') },
            }, '取消'),
          ]) : null,
        ]),
      ]) : null,
      (!manageOpen && (organizerBusy || hasUndoableOrganizer)) ? h('div', { key: 'organizer-status', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        hasUndoableOrganizer ? h(Button, { key: 'undo', size: 'sm', variant: 'ghost', disabled: organizerBusy, onClick: undoOrganizer }, '撤销上次整理') : null,
        organizerJournal?.status === 'applied' ? h(Button, { key: 'finalize', size: 'sm', variant: 'ghost', disabled: organizerBusy, onClick: finalizeOrganizer }, '保留结果并继续') : null,
        organizerBusy ? h('span', { key: 'progress', role: 'status', style: { fontSize: 12, color: C.muted } }, organizerProgress || '正在整理…') : null,
      ]) : null,
      organizerLog.length ? h('div', { key: 'organizer-log', role: 'status', style: { maxHeight: 100, overflowY: 'auto', fontSize: 11, color: C.muted, display: 'grid', gap: 3 } },
        organizerLog.slice(-10).map((line, index) => h('span', { key: `${index}:${line}` }, line))) : null,
      organizerPlan ? h('div', { key: 'organizer-preview', className: 'rk-reveal', style: { display: 'grid', gap: 8, padding: 10, border: `1px solid ${C.tealLine}`, borderRadius: 8 } }, [
        h('strong', { key: 'title', style: { fontSize: 13 } }, '课题归类预览 · 确认前不会修改数据'),
        ...organizerPlan.map((item, index) => h('label', { key: item.from, style: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 } }, [
          h('input', { key: 'check', type: 'checkbox', checked: item.selected, disabled: organizerBusy, onChange: event => setOrganizerPlan(rows => rows.map((row, i) => i === index ? { ...row, selected: event.target.checked } : row)) }),
          h('span', { key: 'description' }, `${item.from} → ${item.to} · ${item.category === 'research' ? '科研课题' : '测试／演示归档'} · ${item.confidence === 'high' ? '高置信' : '需确认'} · 证据 ${item.counts.evidence}、论断 ${item.counts.researchClaims}、资产 ${item.counts.assets}、知识 ${item.counts.nodes + item.counts.claims}、运行 ${item.counts.runs}。${item.reason}`),
        ])),
        h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
          h(Button, { key: 'apply', size: 'sm', variant: 'primary', disabled: organizerBusy || !organizerPlan.some(item => item.selected), onClick: applyOrganizer }, '确认并一键分类'),
          h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', disabled: organizerBusy, onClick: () => setOrganizerPlan(null) }, '取消'),
        ]),
      ]) : null,
      backupOpen ? h('div', { key: 'backup', className: 'rk-reveal', style: { display: 'grid', gap: 8, padding: 10, borderRadius: 9, background: C.surfaceAlt, border: `1px solid ${C.line}` } }, [
        h('strong', { key: 't', style: { fontSize: 12, color: C.ink } }, '从备份文件恢复（增量合并，不覆盖现有笔记）'),
        h('input', {
          key: 'file', type: 'file', accept: '.json,application/json', 'aria-label': '选择证据 JSON 备份文件',
          onChange: async event => {
            const file = event.target.files?.[0]
            if (!file) return
            try { setBackup(await file.text()) } catch (error) { setNotice(`⚠️ 文件读取失败：${error.message}`) }
          },
        }),
        h('details', { key: 'paste' }, [
          h('summary', { key: 's', style: { cursor: 'pointer', fontSize: 12, color: C.muted } }, '或直接粘贴 JSON 备份文本'),
          h(Textarea, { key: 'i', value: backup, onChange: setBackup, rows: 4, mono: true, ariaLabel: 'JSON 备份内容', style: { marginTop: 6 } }),
        ]),
        h('div', { key: 'row', style: { display: 'flex', gap: 8 } }, [
          h(Button, { key: 'go', size: 'sm', variant: 'primary', disabled: !backup.trim(), onClick: importJson }, '确认恢复'),
          h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => { setBackupOpen(false); setBackup('') } }, '取消'),
        ]),
      ]) : null,
    ]),
    hasQualityIssues ? (() => {
      const parts = [
        quality.missingIdentifier ? `缺标识符 ${quality.missingIdentifier}` : '',
        quality.unverified ? `未核验 ${quality.unverified}` : '',
        quality.staleOrMissing ? `失效／未找到 ${quality.staleOrMissing}` : '',
        quality.duplicateGroups.length ? `疑似同源 ${quality.duplicateGroups.length}` : '',
        quality.orphanLinks.length ? `关联断链 ${quality.orphanLinks.length}` : '',
      ].filter(Boolean)
      return h('div', {
        key: 'quality-audit',
        style: {
          display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
          padding: '7px 12px', borderRadius: 9, background: C.surfaceAlt, border: `1px solid ${C.line}`, fontSize: 12, color: C.muted,
        },
      }, [
        h('span', { key: 'counts' }, `本页体检：${parts.join(' · ')}`),
        quality.duplicateGroups.length ? h('span', { key: 'duplicates' }, `同源候选：${quality.duplicateGroups.slice(0, 2).map(item => item.projects.join('／')).join('；')}${quality.duplicateGroups.length > 2 ? '…' : ''}`) : null,
      ])
    })() : null,
    citationOpen ? h(Card, { key: 'citation-import', className: 'rk-reveal', style: { display: 'grid', gap: 8 } }, [
      h('strong', { key: 'title' }, '导入 BibTeX／RIS · 预览并选择后保存'),
      h('input', { key: 'file', type: 'file', accept: '.bib,.ris,.txt', 'aria-label': '选择引用文件', disabled: citationBusy,
        onChange: async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2000000) return setNotice('⚠️ 文件超过 2 MB，请拆分。'); try { const text = await file.text(); setCitationText(text); previewCitations(text) } catch (error) { setNotice(`⚠️ 文件读取失败：${error.message}`) } } }),
      h(Textarea, { key: 'text', value: citationText, onChange: value => { setCitationText(value); setCitationPreviewRows([]); setCitationPicked([]) }, rows: 4, ariaLabel: 'BibTeX 或 RIS 引用内容', disabled: citationBusy }),
      h(Button, { key: 'preview', size: 'sm', disabled: !citationText.trim() || citationBusy, onClick: () => previewCitations() }, '预览引用'),
      ...citationWarnings.slice(0, 10).map((warning, index) => h('small', { key: `warn:${index}`, style: { color: C.muted } }, warning)),
      citationPreviewRows.length ? h('div', { key: 'rows', style: { maxHeight: 260, overflowY: 'auto', display: 'grid', gap: 5 } }, [
        h(Button, { key: 'all', size: 'sm', disabled: citationBusy, onClick: () => setCitationPicked(citationPicked.length === citationPreviewRows.length ? [] : citationPreviewRows.map((_, index) => index)) }, citationPicked.length === citationPreviewRows.length ? '取消全选' : '选择全部预览引用'),
        ...citationPreviewRows.map((row, index) => h('label', { key: index, style: { fontSize: 12 } }, [
          h('input', { key: 'pick', type: 'checkbox', disabled: citationBusy, checked: citationPicked.includes(index), onChange: () => setCitationPicked(values => values.includes(index) ? values.filter(value => value !== index) : [...values, index]) }),
          `${row.title} · ${row.identifier || row.url}`,
        ])),
      ]) : null,
      h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: !citationPicked.length || citationBusy, onClick: importCitations }, `确认保存所选 ${citationPicked.length} 条（待核验）`),
    ]) : null,
  ])
}

export function EvidenceVaultActionPanels({
  screeningOpen, setScreeningOpen, selectedEntries, screeningDecision, setScreeningDecision,
  screeningReason, setScreeningReason, saveScreening,
  claimFormOpen, setClaimFormOpen, claimQuestion, setClaimQuestion, claimStatement, setClaimStatement,
  claimStance, setClaimStance, claimLocator, setClaimLocator, claimStudyDesign, setClaimStudyDesign,
  claimSample, setClaimSample, claimResult, setClaimResult, claimLimitations, setClaimLimitations, saveClaim,
  claims, ledger, counts, entries,
  exportLiteratureReview, exportScreeningReport, artifactOpen, setArtifactOpen, exportResearchRecord,
  artifactTitle, setArtifactTitle, artifactDataset, setArtifactDataset, artifactCode, setArtifactCode,
  artifactParameters, setArtifactParameters, artifactEnvironment, setArtifactEnvironment,
  artifactOutput, setArtifactOutput, artifactExecution, setArtifactExecution, saveArtifact,
}) {
  const [claimDetailsOpen, setClaimDetailsOpen] = React.useState(false)
  const needsLocator = claimStance === 'supports' || claimStance === 'refutes'
  return h(React.Fragment, null, [
    screeningOpen ? h(Card, { key: 'screening-form', className: 'rk-reveal', style: { display: 'grid', gap: 8 } }, [
      h('strong', { key: 'title', style: { fontSize: 13 } }, `筛选已选 ${selectedEntries.length} 条证据`),
      h(Select, { key: 'decision', value: screeningDecision, onChange: setScreeningDecision, ariaLabel: '筛选决定', options: [
        { value: 'include', label: '纳入' }, { value: 'exclude', label: '排除' }, { value: 'pending', label: '待定' },
      ] }),
      h(Textarea, { key: 'reason', value: screeningReason, onChange: setScreeningReason, rows: 2, placeholder: '筛选理由（排除时必填）', ariaLabel: '筛选理由' }),
      h('div', { key: 'actions', style: { display: 'flex', gap: 8 } }, [
        h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: !selectedEntries.length || (screeningDecision === 'exclude' && !screeningReason.trim()), onClick: saveScreening }, '记录筛选决定'),
        h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => setScreeningOpen(false) }, '取消'),
      ]),
    ]) : null,
    claimFormOpen ? h(Card, { key: 'claim-form', className: 'rk-reveal', style: { display: 'grid', gap: 8 } }, [
      h('strong', { key: 'title', style: { fontSize: 13 } }, `建立研究论断 · 关联已选 ${selectedEntries.length} 条证据`),
      h(Textarea, { key: 'statement', value: claimStatement, onChange: setClaimStatement, rows: 2, placeholder: '写一句可检验的具体论断', ariaLabel: '具体论断' }),
      h(Select, { key: 'stance', value: claimStance, onChange: setClaimStance, ariaLabel: '所选证据与论断的关系', options: RESEARCH_EVIDENCE_STANCES.map(value => ({ value, label: ({ unassessed: '尚未评估', supports: '支持', refutes: '反驳', insufficient: '证据不足' })[value] })) }),
      needsLocator ? h(Input, { key: 'locator', className: 'rk-reveal', value: claimLocator, onChange: setClaimLocator, placeholder: '原文位置：页码／图表／段落（必填）', ariaLabel: '来源定位' }) : null,
      h('div', { key: 'more-toggle' }, [
        h(Button, {
          key: 'toggle', size: 'sm', variant: 'quiet', 'aria-expanded': claimDetailsOpen,
          onClick: () => setClaimDetailsOpen(open => !open),
        }, claimDetailsOpen ? '收起研究细节 ▴' : '补充研究细节（问题、样本、局限等） ▾'),
      ]),
      claimDetailsOpen ? h('div', { key: 'details', className: 'rk-reveal', style: { display: 'grid', gap: 8 } }, [
        h(Input, { key: 'question', value: claimQuestion, onChange: setClaimQuestion, placeholder: '研究问题（可选）', ariaLabel: '研究问题' }),
        !needsLocator ? h(Input, { key: 'locator-opt', value: claimLocator, onChange: setClaimLocator, placeholder: '原文位置（可选）', ariaLabel: '来源定位' }) : null,
        h(Input, { key: 'design', value: claimStudyDesign, onChange: setClaimStudyDesign, placeholder: '研究设计（可选）', ariaLabel: '研究设计' }),
        h(Input, { key: 'sample', value: claimSample, onChange: setClaimSample, placeholder: '样本／研究对象（可选）', ariaLabel: '样本与研究对象' }),
        h(Input, { key: 'result', value: claimResult, onChange: setClaimResult, placeholder: '关键结果（可选）', ariaLabel: '关键结果' }),
        h(Input, { key: 'limitations', value: claimLimitations, onChange: setClaimLimitations, placeholder: '局限性（可选）', ariaLabel: '局限性' }),
      ]) : null,
      h('div', { key: 'actions', style: { display: 'flex', gap: 8 } }, [
        h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: !claimStatement.trim() || !selectedEntries.length, onClick: saveClaim }, '保存论断'),
        h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => setClaimFormOpen(false) }, '取消'),
      ]),
    ]) : null,
    h('details', { key: 'research-ledger', style: { padding: '8px 12px', borderRadius: 10, background: C.surfaceAlt, border: `1px solid ${C.line}` } }, [
      h('summary', { key: 'sum', style: { cursor: 'pointer', fontSize: 12, color: C.muted, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        h('strong', { key: 't', style: { color: C.ink } }, '科研账本与综述导出'),
        h('span', { key: 's' }, (() => { const s = researchLedgerSummary(ledger); return `检索 ${s.searches} · 纳入 ${s.included} · 排除 ${s.excluded} · 待定 ${s.pending} · 产出 ${s.artifacts}` })()),
      ]),
      h('div', { key: 'body', style: { display: 'grid', gap: 8, marginTop: 10 } }, [
        h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
          h(Button, { key: 'review-export', size: 'sm', variant: 'soft', onClick: exportLiteratureReview }, '导出当前课题综述与审核记录'),
          h(Button, { key: 'screen-report', size: 'sm', variant: 'ghost', disabled: !counts.all, onClick: exportScreeningReport }, '导出 PRISMA 计数'),
          h(Button, { key: 'export', size: 'sm', variant: 'ghost', disabled: !ledger.length && !claims.length, onClick: exportResearchRecord }, '导出筛选与引用清单'),
          h(Button, { key: 'artifact', size: 'sm', variant: 'ghost', onClick: () => setArtifactOpen(value => !value) }, '记录研究产出'),
        ]),
        artifactOpen ? h('div', { key: 'artifact-form', className: 'rk-reveal', style: { display: 'grid', gap: 6 } }, [
          h(Input, { key: 'title', value: artifactTitle, onChange: setArtifactTitle, placeholder: '图表、报告或分析产出名称', ariaLabel: '研究产出名称' }),
          h(Input, { key: 'dataset', value: artifactDataset, onChange: setArtifactDataset, placeholder: '数据集编号／版本（可选）', ariaLabel: '数据集编号' }),
          h(Input, { key: 'code', value: artifactCode, onChange: setArtifactCode, placeholder: '代码 commit／版本（可选）', ariaLabel: '代码版本' }),
          h(Input, { key: 'params', value: artifactParameters, onChange: setArtifactParameters, placeholder: '参数（可选）', ariaLabel: '运行参数' }),
          h(Input, { key: 'env', value: artifactEnvironment, onChange: setArtifactEnvironment, placeholder: '环境（可选）', ariaLabel: '执行环境' }),
          h(Input, { key: 'output', value: artifactOutput, onChange: setArtifactOutput, placeholder: '产出文件／链接（可选）', ariaLabel: '产出位置' }),
          h(Input, { key: 'execution', value: artifactExecution, onChange: setArtifactExecution, placeholder: '实际执行日志／工具调用 ID；留空记为草稿', ariaLabel: '执行依据' }),
          h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: !artifactTitle.trim(), onClick: saveArtifact }, '保存研究产出'),
        ]) : null,
        ...ledger.slice(0, 12).map(item => h('div', { key: item.id, style: { borderTop: `1px solid ${C.line}`, paddingTop: 6, fontSize: 12, color: C.muted } },
          item.kind === 'search' ? `检索 · ${item.database} · ${item.query} · 当前返回 ${item.resultCount} 条`
            : item.kind === 'screening' ? `筛选 · ${item.decision === 'include' ? '纳入' : item.decision === 'exclude' ? '排除' : '待定'} · ${entries.find(row => row.id === item.evidenceId)?.title || item.evidenceId}${item.reason ? ` · ${item.reason}` : ''}`
              : `产出 · ${item.title} · ${item.state === 'verified-execution' ? '执行已核验' : item.executionRef ? '执行引用待核对' : '草稿'}`)),
        ledger.length > 12 ? h('span', { key: 'more', style: { color: C.muted, fontSize: 12 } }, `显示最近 12 条；完整 ${ledger.length} 条可导出。`) : null,
      ]),
    ]),
  ])
}
