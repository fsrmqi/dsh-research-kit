import React from 'react'
import { h, C } from './theme.js'
import { Badge, Button, Card, Modal, Notice, Select, Textarea } from './ui.js'
import { removeEvidenceEntryFromFile } from './lib/evidence-vault-sync.js'
import {
  CLAIM_RELATION_LABELS,
  KNOWLEDGE_ENTITY_LABELS,
  KNOWLEDGE_KIND_LABELS,
  KNOWLEDGE_POLARITY_LABELS,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_STATUS_LABELS,
} from './lib/knowledge-extract.js'
import { researchCitationHref } from './lib/answer-evidence.js'

const GRAPH_KNOWLEDGE_STATUS_OPTIONS = KNOWLEDGE_STATUSES.map(status => ({ value: status, label: KNOWLEDGE_STATUS_LABELS[status] }))

export function EvidenceGraphDetailPanels({
  selectedEvidenceEntry, nodeStrokeColor, setSelectedEvidenceNodeId,
  confirmDeleteEvidence, setConfirmDeleteEvidence, vault, setNotice,
  selectedKnowledge, graphKindColor, updateKnowledgeStatus, setSelectedKnowledgeId,
  relatedClaims, knowledgeLabelOf, knowledgeConflictCount, visibleSavedEvidence, visibleAssets,
  knowledgeBackupOpen, setKnowledgeBackupOpen, knowledgeBackupText, setKnowledgeBackupText, importKnowledgeBackup,
  cleanupOpen, setCleanupOpen, cleaning, cleanupTestProjects, testProjects, testProjectEntryCount,
  exportOpen, setExportOpen, exportGraph, exportScopeNote,
  renderLimitedCount, displayGraph, interactiveGraph, graph, hiddenIsolatedCount,
}) {
  return h(React.Fragment, null, [
    selectedEvidenceEntry ? h(Card, {
      key: 'evidence-detail',
      style: {
        margin: '0 var(--rk-gutter) 14px', padding: 16,
        border: `1px solid ${nodeStrokeColor({ kind: 'evidence', grade: selectedEvidenceEntry.grade })}40`,
        display: 'grid', gap: 10,
      },
    }, [
      h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
        h('strong', { key: 'title', style: { fontSize: 14, flex: 1, minWidth: 0 } }, selectedEvidenceEntry.title),
        selectedEvidenceEntry.grade && selectedEvidenceEntry.grade !== 'ungraded'
          ? h(Badge, { key: 'grade', color: { empirical: '#27AE60', inference: '#F39C12', missing: '#E74C3C' }[selectedEvidenceEntry.grade] || C.muted },
              { empirical: '实证', inference: '推论', missing: '缺失' }[selectedEvidenceEntry.grade] || selectedEvidenceEntry.grade)
          : null,
        selectedEvidenceEntry.agentProduced && h(Badge, { key: 'agent', color: '#3498DB' }, 'Agent'),
        h('span', { key: 'spacer', style: { flex: 1 } }),
        h(Button, { key: 'close', size: 'sm', variant: 'ghost', onClick: () => setSelectedEvidenceNodeId('') }, '收起'),
      ]),
      h('div', { key: 'meta', style: { display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: C.muted } }, [
        selectedEvidenceEntry.identifier ? h('span', { key: 'id' },
          `${selectedEvidenceEntry.identifierKind || ''}: ${selectedEvidenceEntry.identifier}`) : null,
        selectedEvidenceEntry.sourceDatabase ? h('span', { key: 'src' }, selectedEvidenceEntry.sourceDatabase) : null,
        selectedEvidenceEntry.project ? h('span', { key: 'proj' }, selectedEvidenceEntry.project) : null,
        selectedEvidenceEntry.savedAt ? h('span', { key: 'date' }, new Date(selectedEvidenceEntry.savedAt).toLocaleDateString('zh-CN')) : null,
      ]),
      selectedEvidenceEntry.note ? h('p', {
        key: 'note',
        style: { margin: 0, fontSize: 12, lineHeight: 1.55, color: C.ink, whiteSpace: 'pre-wrap' },
      }, selectedEvidenceEntry.note) : null,
      h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
        selectedEvidenceEntry.url ? h(Button, {
          key: 'url', size: 'sm', variant: 'soft', icon: 'search',
          onClick: () => { if (typeof window !== 'undefined') window.open(selectedEvidenceEntry.url, '_blank', 'noopener') },
        }, '打开来源') : null,
        selectedEvidenceEntry.url ? h('span', {
          key: 'url-text',
          style: { fontSize: 11, color: C.muted, alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300, whiteSpace: 'nowrap' },
        }, selectedEvidenceEntry.url) : null,
        h('span', { key: 'delete-spacer', style: { flex: 1 } }),
        confirmDeleteEvidence
          ? h(Button, {
            key: 'delete-confirm', size: 'sm', variant: 'danger', icon: 'trash',
            onClick: async () => {
              setConfirmDeleteEvidence(false)
              try {
                await removeEvidenceEntryFromFile(selectedEvidenceEntry)
                await vault.remove(selectedEvidenceEntry.id)
                setSelectedEvidenceNodeId('')
                setNotice(`已删除「${selectedEvidenceEntry.title}」。`)
              } catch (error) { setNotice(`删除失败：${error?.message || error}`) }
            },
          }, '确认删除')
          : h(Button, {
            key: 'delete', size: 'sm', variant: 'ghost', icon: 'trash',
            onClick: () => setConfirmDeleteEvidence(true),
            title: '从证据库和文件存储中彻底删除此条目（不可恢复）',
          }, '删除'),
      ]),
    ]) : null,
    selectedKnowledge ? h(Card, { key: 'knowledge-detail', style: { margin: '0 var(--rk-gutter) 18px', padding: 16, display: 'grid', gap: 12 } }, [
      h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
        h('strong', { key: 't', style: { fontSize: 14 } }, selectedKnowledge.label),
        h(Badge, { key: 'k', color: graphKindColor(selectedKnowledge.kind) },
          `${KNOWLEDGE_KIND_LABELS[selectedKnowledge.kind] || selectedKnowledge.kind}${selectedKnowledge.entityKind ? ` · ${KNOWLEDGE_ENTITY_LABELS[selectedKnowledge.entityKind] || selectedKnowledge.entityKind}` : ''}`),
        h('span', { key: 'spacer', style: { flex: 1 } }),
        h(Select, {
          key: 'status', value: selectedKnowledge.status, options: GRAPH_KNOWLEDGE_STATUS_OPTIONS,
          onChange: updateKnowledgeStatus, ariaLabel: `设置「${selectedKnowledge.label}」的核验状态`,
          style: { width: 'auto', minWidth: 96 },
        }),
        h(Button, { key: 'close', size: 'sm', variant: 'ghost', onClick: () => setSelectedKnowledgeId('') }, '收起'),
      ]),
      relatedClaims.length ? h('div', { key: 'claims', style: { display: 'grid', gap: 6, fontSize: 13 } }, [
        h('strong', { key: 'lt', style: { fontSize: 12, color: C.muted } }, '知识关系'),
        ...relatedClaims.map(claim => {
          const label = CLAIM_RELATION_LABELS[claim.relation] || claim.relation
          const polarity = KNOWLEDGE_POLARITY_LABELS[claim.polarity] ? `（${KNOWLEDGE_POLARITY_LABELS[claim.polarity]}）` : ''
          const state = claim.status !== 'to_verify' ? `（${KNOWLEDGE_STATUS_LABELS[claim.status]}）` : ''
          return h('span', { key: claim.id }, `${knowledgeLabelOf(claim.from)} —${label}${polarity}→ ${knowledgeLabelOf(claim.to)}${state}`)
        }),
      ]) : null,
      knowledgeConflictCount ? h(Notice, { key: 'conflict', tone: 'warn', icon: 'shield' },
        `该结论存在 ${knowledgeConflictCount} 组方向或极性不一致的并列记录（例如「促进」与「抑制」并存）。自动沉淀不裁决冲突，均保留待人工核验。`) : null,
      (selectedKnowledge.evidenceIds || []).length ? h('div', { key: 'evidence', style: { display: 'grid', gap: 4, fontSize: 13 } }, [
        h('strong', { key: 'lt', style: { fontSize: 12, color: C.muted } }, '关联证据'),
        ...selectedKnowledge.evidenceIds.map(id => {
          const entry = visibleSavedEvidence.find(item => item.id === id)
          if (!entry) return h('span', { key: id, style: { color: C.muted } }, '（关联的证据条目不在当前视图，可能已被删除或属于其他项目）')
          const href = researchCitationHref(entry)
          return h('span', { key: id }, [
            href ? h('a', { key: 'source', href, target: '_blank', rel: 'noopener noreferrer', style: { color: C.teal } }, entry.title) : entry.title,
            entry.status ? `（${entry.status === 'verified' ? '已核验' : entry.status === 'unverified' ? '未核验' : entry.status}）` : '',
          ])
        }),
      ]) : null,
      selectedKnowledge.assetId ? h('div', { key: 'asset', style: { fontSize: 13 } }, [
        h('strong', { key: 'lt', style: { fontSize: 12, color: C.muted } }, '沉淀到灵感资产：'),
        visibleAssets.find(item => item.id === selectedKnowledge.assetId)?.title || selectedKnowledge.assetId,
      ]) : null,
      (selectedKnowledge.sources || []).length ? h('div', { key: 'sources', style: { display: 'grid', gap: 8 } }, [
        h('strong', { key: 'lt', style: { fontSize: 12, color: C.muted } }, '来源消息（自动保留的摘录）'),
        ...selectedKnowledge.sources.map((source, index) => h('div', { key: index, style: { display: 'grid', gap: 3 } }, [
          h('span', { key: 'm', style: { color: C.muted, fontSize: 12 } },
            `会话 ${source.sessionId ? source.sessionId.slice(0, 12) : '本地'} · 消息 #${source.seq ?? '?'}${source.at ? ` · ${new Date(source.at).toLocaleString('zh-CN')}` : ''}`),
          h('div', { key: 'x', style: { whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, padding: '8px 10px', border: `1px solid ${C.line}`, borderRadius: 8, background: C.surfaceAlt } }, source.excerpt || '（无摘录）'),
        ])),
      ]) : null,
      h('p', { key: 'hint', style: { margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.5 } },
        '以上内容由规则提取自动生成，全部以「待核验」起步；提取不等于正确，请以可访问的原文为准逐条核验后再引用。'),
    ]) : null,
    knowledgeBackupOpen ? h(Card, { key: 'knowledge-backup', style: { margin: '0 var(--rk-gutter) 18px', padding: 16, display: 'grid', gap: 10 } }, [
      h('strong', { key: 't', style: { fontSize: 13 } }, '粘贴此前导出的知识库 JSON 备份（增量合并：已存在的节点与关系跳过，不覆盖现有核验状态）'),
      h(Textarea, { key: 'i', value: knowledgeBackupText, onChange: setKnowledgeBackupText, rows: 5, mono: true, ariaLabel: '知识库 JSON 备份内容' }),
      h('div', { key: 'row', style: { display: 'flex', gap: 8 } }, [
        h(Button, { key: 'go', size: 'sm', variant: 'primary', disabled: !knowledgeBackupText.trim(), onClick: importKnowledgeBackup }, '恢复'),
        h(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => { setKnowledgeBackupOpen(false); setKnowledgeBackupText('') } }, '取消'),
      ]),
    ]) : null,
    cleanupOpen ? h(Modal, {
      key: 'cleanup-test-projects',
      title: '清理测试课题',
      subtitle: '只删除下列明显像测试/演示/探针的课题；会同时删除本机证据文件与当前页面的本地缓存。',
      onClose: () => { if (!cleaning) setCleanupOpen(false) },
      footer: [
        h(Button, { key: 'cancel', variant: 'ghost', disabled: cleaning, onClick: () => setCleanupOpen(false) }, '取消'),
        h(Button, { key: 'go', variant: 'danger', disabled: cleaning, onClick: cleanupTestProjects }, cleaning ? '正在清理…' : '确认清理'),
      ],
    }, [
      h('p', { key: 'intro', style: { margin: 0, fontSize: 13, lineHeight: 1.6 } },
        `将删除 ${testProjects.length} 个课题、共 ${testProjectEntryCount} 条证据：`),
      h('div', { key: 'list', style: { display: 'grid', gap: 4, fontSize: 13 } },
        testProjects.map(item => h('span', { key: item.project }, `${item.project} · ${item.count} 条`))),
      h(Notice, { key: 'warning', tone: 'warn', icon: 'shield' },
        '不可撤销。真实课题（例如大麦候选基因课题）不会出现在列表里；如果某个课题其实是真实数据，请取消并改用证据库里逐条删除。'),
    ]) : null,
    exportOpen ? h(Modal, {
      key: 'export-modal',
      title: '导出证据链路快照',
      subtitle: '导出物离线可打开；确认元数据范围后再下载。',
      onClose: () => setExportOpen(false),
      footer: [
        h(Button, { key: 'cancel', variant: 'ghost', onClick: () => setExportOpen(false) }, '取消'),
        h(Button, { key: 'svg', variant: 'soft', onClick: () => exportGraph('svg') }, '导出 SVG'),
        h(Button, { key: 'html', variant: 'primary', onClick: () => exportGraph('html') }, '导出 HTML')
      ]
    }, [
      h('p', { key: 'scope', style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: C.muted } }, exportScopeNote),
      h('p', { key: 'count', style: { margin: '10px 0 0', fontSize: 13 } },
        `本次将导出 ${renderLimitedCount ? displayGraph.nodes.length : interactiveGraph.nodes.length} 个节点、${graph.edges.length} 条关系`
        + `${hiddenIsolatedCount ? `（另有 ${hiddenIsolatedCount} 个未关联节点未导出，可在图谱中临时显示后导出）` : ''}。`)
    ]) : null,
  ])
}
