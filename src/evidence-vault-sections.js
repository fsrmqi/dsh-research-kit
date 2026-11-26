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
  agentBusy, agentProgress, sessionId, runAgentAssessment, agentAbort, includeHuman, setIncludeHuman, agentStats,
  citationOpen, citationBusy, setNotice, citationText, setCitationText,
  citationPreviewRows, setCitationPreviewRows, citationPicked, setCitationPicked,
  previewCitations, citationWarnings, importCitations,
}) {
  return h(React.Fragment, null, [
    h(Card, { key: 'project-bar', style: { display: 'grid', gap: 10 } }, [
      h('div', { key: 'row', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        h('strong', { key: 'label', style: { fontSize: 13 } }, '当前课题'),
        h(Select, { key: 'select', value: project, options: projectOptions, onChange: switchProject, ariaLabel: '切换项目', style: { width: 'auto', minWidth: 140 } }),
        h(Button, { key: 'new', size: 'sm', variant: 'ghost', icon: 'plus', onClick: () => setNewProjectOpen(value => !value) }, '新建课题'),
        project ? h(Button, { key: 'rename', size: 'sm', variant: 'ghost', onClick: () => { setWorkspaceNameDraft(activeWorkspace?.name || project); setWorkspaceRenameOpen(value => !value) } }, '改显示名') : null,
        project ? h(Button, { key: 'archive', size: 'sm', variant: 'ghost', onClick: () => activeWorkspace?.archived ? toggleProjectArchive() : setConfirmArchiveWorkspace(value => !value) }, activeWorkspace?.archived ? '恢复课题' : '归档课题') : null,
        confirmArchiveWorkspace ? h(Button, { key: 'archive-confirm', size: 'sm', variant: 'soft', onClick: toggleProjectArchive }, '确认：只归档，不删除数据') : null,
        h(Button, { key: 'archived-toggle', size: 'sm', variant: 'ghost', onClick: () => setShowArchivedWorkspaces(value => !value) }, showArchivedWorkspaces ? '隐藏已归档' : '显示已归档'),
        h('span', { key: 'spacer', style: { flex: '1 1 auto' } }),
        h(Button, { key: 'export', size: 'sm', variant: 'soft', icon: 'download', onClick: exportJson, disabled: !entries.length && !claims.length && !ledger.length && !workspaces.some(item => (!project || item.projectKey === project) && (item.origin === 'user' || item.updatedAt > 0)) }, '导出备份'),
        h(Button, { key: 'export-pack', size: 'sm', variant: 'soft', icon: 'download', onClick: exportExplainPack, disabled: !filtered.length }, '导出解释图素材'),
        h(Button, { key: 'citations', size: 'sm', onClick: () => setCitationOpen(value => !value) }, '导入文献引用'),
        h(Button, { key: 'bibtex', size: 'sm', disabled: !counts.all, onClick: () => exportCitations('bibtex') }, '导出 BibTeX'),
        h(Button, { key: 'ris', size: 'sm', disabled: !counts.all, onClick: () => exportCitations('ris') }, '导出 RIS'),
        h(Button, { key: 'import', size: 'sm', variant: 'ghost', icon: 'upload', onClick: () => setBackupOpen(value => !value) }, '恢复备份'),
        confirmClear
          ? h(Button, { key: 'clear-confirm', size: 'sm', variant: 'danger', icon: 'trash', onClick: clearScope },
            project ? `确认删除「${project}」全部` : '确认删除全部项目')
          : h(Button, { key: 'clear', size: 'sm', variant: 'ghost', icon: 'trash', onClick: () => setConfirmClear(true), disabled: !entries.length },
            project ? '清空本项目' : '清空全部'),
      ]),
      newProjectOpen ? h('div', { key: 'new-row', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
        h(Input, { key: 'i', value: newProject, onChange: setNewProject, placeholder: '稳定课题名称，例：大麦雄性不育', ariaLabel: '新课题名称', style: { flex: '1 1 200px' } }),
        h(Button, { key: 'go', size: 'sm', variant: 'primary', disabled: !newProject.trim(), onClick: createProject }, '创建并切换'),
      ]) : null,
      workspaceRenameOpen ? h('div', { key: 'rename-row', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
        h(Input, { key: 'input', value: workspaceNameDraft, onChange: setWorkspaceNameDraft, placeholder: '新的课题显示名', ariaLabel: '课题显示名', style: { flex: '1 1 200px' } }),
        h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: !workspaceNameDraft.trim(), onClick: renameProject }, '保存显示名'),
      ]) : null,
      h('div', { key: 'organizer-actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        h(Button, { key: 'preview', size: 'sm', variant: 'soft', disabled: organizerBusy || loading || (organizerJournal && !['undone', 'failed', 'finalized'].includes(organizerJournal.status)), onClick: previewOrganizer }, '一键整理项目'),
        organizerJournal?.fileId && !['undone', 'failed', 'finalized'].includes(organizerJournal.status)
          ? h(Button, { key: 'undo', size: 'sm', variant: 'ghost', disabled: organizerBusy, onClick: undoOrganizer }, '撤销上次整理') : null,
        organizerJournal?.status === 'applied'
          ? h(Button, { key: 'finalize', size: 'sm', variant: 'ghost', disabled: organizerBusy, onClick: finalizeOrganizer }, '保留结果并继续') : null,
        organizerBusy ? h('span', { key: 'progress', role: 'status', style: { fontSize: 12, color: C.muted } }, organizerProgress || '正在整理…') : null,
      ]),
      organizerLog.length ? h('div', { key: 'organizer-log', role: 'status', style: { maxHeight: 100, overflowY: 'auto', fontSize: 11, color: C.muted, display: 'grid', gap: 3 } },
        organizerLog.slice(-10).map((line, index) => h('span', { key: `${index}:${line}` }, line))) : null,
      organizerPlan ? h('div', { key: 'organizer-preview', style: { display: 'grid', gap: 8, padding: 10, border: `1px solid ${C.tealLine}`, borderRadius: 8 } }, [
        h('strong', { key: 'title', style: { fontSize: 13 } }, '项目归类预览 · 确认前不会修改数据'),
        ...organizerPlan.map((item, index) => h('label', { key: item.from, style: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 } }, [
          h('input', { key: 'check', type: 'checkbox', checked: item.selected, disabled: organizerBusy, onChange: event => setOrganizerPlan(rows => rows.map((row, i) => i === index ? { ...row, selected: event.target.checked } : row)) }),
          h('span', { key: 'description' }, `${item.from} → ${item.to} · ${item.category === 'research' ? '科研课题' : '测试／演示归档'} · ${item.confidence === 'high' ? '高置信' : '需确认'} · 证据 ${item.counts.evidence}、论断 ${item.counts.researchClaims}、资产 ${item.counts.assets}、知识 ${item.counts.nodes + item.counts.claims}、运行 ${item.counts.runs}。${item.reason}`),
        ])),
        h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
          h(Button, { key: 'apply', size: 'sm', variant: 'primary', disabled: organizerBusy || !organizerPlan.some(item => item.selected), onClick: applyOrganizer }, '确认并一键分类'),
          h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', disabled: organizerBusy, onClick: () => setOrganizerPlan(null) }, '取消'),
        ]),
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
    h(Card, { key: 'quality-audit', style: { display: 'grid', gap: 6 } }, [
      h('strong', { key: 'title', style: { fontSize: 13 } }, '数据质量提示 · 只读，不自动修改'),
      h('small', { key: 'page-scope', style: { color: C.muted } }, '质量提示仅针对当前页；完整范围可导出检查。'),
      h('span', { key: 'counts', style: { fontSize: 12, color: C.muted } }, `缺稳定标识符 ${quality.missingIdentifier} · 未核验 ${quality.unverified} · 标为失效／官方记录未找到 ${quality.staleOrMissing} · 疑似同源组 ${quality.duplicateGroups.length} · 关联断链 ${quality.orphanLinks.length}`),
      quality.duplicateGroups.length ? h('span', { key: 'duplicates', style: { fontSize: 12, color: C.muted } }, `待人工复核的同源候选：${quality.duplicateGroups.slice(0, 3).map(item => item.projects.join('／')).join('；')}${quality.duplicateGroups.length > 3 ? '…' : ''}。跨课题重复可能是有意引用，不会自动合并。`) : null,
      !quality.assetSideChecked ? h('span', { key: 'asset-limit', style: { fontSize: 11, color: C.muted } }, '当前未载入完整资产列表；断链数仅核对证据端。') : null,
    ]),
    h(Card, { key: 'agent-batch', style: { display: 'grid', gap: 8, border: `1px solid ${C.tealLine}` } }, [
      h('div', { key: 'title', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        h('strong', { key: 'label', style: { fontSize: 13 } }, 'Agent 批量判断'),
        h('span', { key: 'scope', style: { fontSize: 12, color: C.muted } }, project ? `范围：项目「${project}」全部证据` : '范围：全部项目证据'),
      ]),
      h('div', { key: 'actions', style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } }, [
        h(Button, { key: 'run', size: 'sm', variant: 'primary', disabled: agentBusy || loading || !entries.length || !sessionId, onClick: () => runAgentAssessment() },
          agentBusy ? agentProgress || '判断中…' : `用 Agent 判断完整范围（${counts.all}）`),
        agentBusy ? h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => agentAbort.current?.abort() }, '取消') : null,
        h('label', { key: 'include', style: { display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12, color: C.ink } }, [
          h('input', { key: 'check', type: 'checkbox', checked: includeHuman, disabled: agentBusy, onChange: event => setIncludeHuman(event.target.checked) }),
          '包含人工处理过的',
        ]),
      ]),
      agentBusy && agentStats ? h('div', { key: 'progress', role: 'status', style: { display: 'grid', gap: 6, padding: '8px 10px', background: C.canvas, borderRadius: 8, fontSize: 12, color: C.muted } }, [
        h('div', { key: 'line', style: { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } }, [
          h('strong', { key: 'phase', style: { color: C.ink } }, agentStats.phase),
          h('span', { key: 'count' }, `已完成 ${agentStats.completed} / ${agentStats.total} · 跳过 ${agentStats.skipped} · 失败 ${agentStats.failed}`),
        ]),
        h('div', { key: 'bar', style: { height: 6, borderRadius: 99, background: C.line, overflow: 'hidden' } },
          h('div', { style: { width: `${Math.min(100, ((agentStats.completed + agentStats.skipped + agentStats.failed) / Math.max(1, agentStats.total)) * 100)}%`, height: '100%', background: C.teal, transition: 'width 160ms ease' } })),
        agentStats.last ? h('span', { key: 'last' }, `最近：${agentStats.last}`) : null,
      ]) : null,
      h('span', { key: 'warning', style: { fontSize: 12, color: C.muted, lineHeight: 1.5 } }, '可按全部数据或仅按已勾选数据判断；每次点击重新调用当前会话模型。项目用于科研工作区隔离，主题标签用于内容分类，二者职责不同。仅发送标题、链接、标识符、保存原因和笔记；结果与人工评估分开保存，不会自动标记为已核验。'),
    ]),
    citationOpen ? h(Card, { key: 'citation-import', style: { display: 'grid', gap: 8 } }, [
      h('strong', { key: 'title' }, '导入 BibTeX／RIS · 预览并选择后保存'),
      h('input', { key: 'file', type: 'file', accept: '.bib,.ris,.txt', 'aria-label': '选择引用文件', disabled: citationBusy,
        onChange: async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2000000) return setNotice('⚠️ 文件超过 2 MB，请拆分。'); try { setCitationText(await file.text()); setCitationPreviewRows([]); setCitationPicked([]) } catch (error) { setNotice(`⚠️ 文件读取失败：${error.message}`) } } }),
      h(Textarea, { key: 'text', value: citationText, onChange: value => { setCitationText(value); setCitationPreviewRows([]); setCitationPicked([]) }, rows: 4, ariaLabel: 'BibTeX 或 RIS 引用内容', disabled: citationBusy }),
      h(Button, { key: 'preview', size: 'sm', disabled: !citationText.trim() || citationBusy, onClick: previewCitations }, '预览引用'),
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
  return h(React.Fragment, null, [
    screeningOpen ? h(Card, { key: 'screening-form', style: { display: 'grid', gap: 8 } }, [
      h('strong', { key: 'title', style: { fontSize: 13 } }, `筛选已选 ${selectedEntries.length} 条证据`),
      h(Select, { key: 'decision', value: screeningDecision, onChange: setScreeningDecision, ariaLabel: '筛选决定', options: [
        { value: 'include', label: '纳入' }, { value: 'exclude', label: '排除' }, { value: 'pending', label: '待定' },
      ] }),
      h(Textarea, { key: 'reason', value: screeningReason, onChange: setScreeningReason, rows: 2, placeholder: '筛选理由；排除时必填', ariaLabel: '筛选理由' }),
      h('div', { key: 'actions', style: { display: 'flex', gap: 8 } }, [
        h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: !selectedEntries.length || (screeningDecision === 'exclude' && !screeningReason.trim()), onClick: saveScreening }, '记录筛选决定'),
        h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => setScreeningOpen(false) }, '取消'),
      ]),
      h('span', { key: 'hint', style: { color: C.muted, fontSize: 12 } }, '每次决定都会留痕；账本按每条证据的最新决定统计。'),
    ]) : null,
    claimFormOpen ? h(Card, { key: 'claim-form', style: { display: 'grid', gap: 8 } }, [
      h('strong', { key: 'title', style: { fontSize: 13 } }, `建立研究论断 · 关联已选 ${selectedEntries.length} 条证据`),
      h(Input, { key: 'question', value: claimQuestion, onChange: setClaimQuestion, placeholder: '研究问题（可选）', ariaLabel: '研究问题' }),
      h(Textarea, { key: 'statement', value: claimStatement, onChange: setClaimStatement, rows: 2, placeholder: '可检验的具体论断', ariaLabel: '具体论断' }),
      h(Select, { key: 'stance', value: claimStance, onChange: setClaimStance, ariaLabel: '所选证据与论断的关系', options: RESEARCH_EVIDENCE_STANCES.map(value => ({ value, label: ({ unassessed: '尚未评估', supports: '支持', refutes: '反驳', insufficient: '证据不足' })[value] })) }),
      h(Input, { key: 'locator', value: claimLocator, onChange: setClaimLocator, placeholder: '原文位置：页码／图表／段落；支持或反驳时必填', ariaLabel: '来源定位' }),
      h(Input, { key: 'design', value: claimStudyDesign, onChange: setClaimStudyDesign, placeholder: '研究设计（可选）', ariaLabel: '研究设计' }),
      h(Input, { key: 'sample', value: claimSample, onChange: setClaimSample, placeholder: '样本／研究对象（可选）', ariaLabel: '样本与研究对象' }),
      h(Input, { key: 'result', value: claimResult, onChange: setClaimResult, placeholder: '关键结果（可选）', ariaLabel: '关键结果' }),
      h(Input, { key: 'limitations', value: claimLimitations, onChange: setClaimLimitations, placeholder: '局限性（可选）', ariaLabel: '局限性' }),
      h('div', { key: 'actions', style: { display: 'flex', gap: 8 } }, [
        h(Button, { key: 'save', size: 'sm', variant: 'primary', disabled: !claimStatement.trim() || !selectedEntries.length, onClick: saveClaim }, '保存论断与证据关系'),
        h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => setClaimFormOpen(false) }, '取消'),
      ]),
      h('span', { key: 'note', style: { fontSize: 12, color: C.muted } }, '这一判断仅记录所选证据与当前论断的关系，不会改变来源核验状态；支持／反驳须填写可定位的原文位置。'),
    ]) : null,
    claims.length ? h(Card, { key: 'research-claims', style: { display: 'grid', gap: 8 } }, [
      h('strong', { key: 'title', style: { fontSize: 13 } }, `研究论断（${claims.length}）`),
      ...claims.slice(0, 20).map(claim => h('div', { key: claim.id, style: { borderTop: `1px solid ${C.line}`, paddingTop: 8, fontSize: 12 } }, [
        claim.question ? h('div', { key: 'question', style: { color: C.muted } }, `问题：${claim.question}`) : null,
        h('strong', { key: 'statement' }, claim.statement),
        h('div', { key: 'links', style: { color: C.muted, marginTop: 3 } }, `关联证据 ${claim.links.length} 条：${claim.links.map(link => ({ unassessed: '待评估', supports: '支持', refutes: '反驳', insufficient: '不足' })[link.stance] || '待评估').join('、')}`),
      ])),
      claims.length > 20 ? h('span', { key: 'more', style: { fontSize: 12, color: C.muted } }, '仅展示最近 20 条；其余仍保存在本地证据库。') : null,
    ]) : null,
    h(Card, { key: 'research-ledger', style: { display: 'grid', gap: 8 } }, [
      h('div', { key: 'head', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
        h('strong', { key: 'title', style: { fontSize: 13 } }, '科研账本与复现链'),
        h('span', { key: 'summary', style: { fontSize: 12, color: C.muted } }, (() => { const s = researchLedgerSummary(ledger); return `检索 ${s.searches} · 纳入 ${s.included} · 排除 ${s.excluded} · 待定 ${s.pending} · 产出 ${s.artifacts}` })()),
        h('span', { key: 'spacer', style: { flex: '1 1 auto' } }),
        h(Button, { key: 'review-export', size: 'sm', onClick: exportLiteratureReview }, '导出当前项目综述与审核记录'),
        h(Button, { key: 'screen-report', size: 'sm', disabled: !counts.all, onClick: exportScreeningReport }, '导出 PRISMA 计数与排除理由'),
        h(Button, { key: 'artifact', size: 'sm', variant: 'ghost', onClick: () => setArtifactOpen(value => !value) }, '记录研究产出'),
        h(Button, { key: 'export', size: 'sm', variant: 'soft', disabled: !ledger.length && !claims.length, onClick: exportResearchRecord }, '导出筛选与引用清单'),
      ]),
      artifactOpen ? h('div', { key: 'artifact-form', style: { display: 'grid', gap: 6 } }, [
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
  ])
}
