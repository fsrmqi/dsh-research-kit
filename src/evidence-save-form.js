import React from 'react'
import { Button, Card, Field, Input, Notice, Textarea } from './ui.js'
import { C, h } from './theme.js'
import {
  EVIDENCE_IDENTIFIER_LABELS,
  EVIDENCE_STATUS_LABELS,
  detectIdentifier,
} from './lib/evidence-vault-core.js'
import { evidenceVaultStore, getActiveProject, persistEvidenceEntryToFile, publishEvidenceVault, saveEvidenceEntry } from './lib/evidence-vault-sync.js'

// 补充笔记或处理重复冲突时展开的轻量表单。
export function EvidenceSaveForm({ source = {}, databaseName = '', initialConflict = null, savedEntry = null, onCancel, onSaved }) {
  const detected = React.useMemo(
    () => detectIdentifier(source.identifier, source.title, source.url, source.meta),
    [source.identifier, source.title, source.url, source.meta],
  )
  const previous = savedEntry || initialConflict
  const [form, setForm] = React.useState({
    title: source.title || '',
    identifier: detected.value || '',
    project: getActiveProject(),
    tags: previous?.tags?.join(', ') || '',
    reason: previous?.reason || '',
    note: previous?.note || '',
  })
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  // 重复不是错误而是需要用户裁决的状态：覆盖已有，还是刻意另存一份。
  const [conflict, setConflict] = React.useState(initialConflict)
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const payload = () => ({
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
      const original = savedEntry || (onDuplicate === 'update' ? conflict : null)
      if (original) {
        const entry = await evidenceVaultStore().updateNotes(original.id, form)
        const fileSynced = await persistEvidenceEntryToFile(entry)
        publishEvidenceVault()
        onSaved?.(entry, { updated: true, fileSynced })
      } else {
        const { entry, fileSynced } = await saveEvidenceEntry(payload(), { onDuplicate })
        onSaved?.(entry, { updated: false, fileSynced })
      }
      setConflict(null)
    } catch (failure) {
      if (failure?.code === 'DUPLICATE') { setConflict(failure.duplicate); setError('') } else setError(String(failure?.message || failure))
    } finally { setSaving(false) }
  }
  return h(Card, { className: 'rk-reveal', style: { marginTop: 8, padding: 12, border: `1px solid ${C.tealLine}`, background: C.surface, display: 'grid', gap: 10 } }, [
    h('strong', { key: 't', style: { fontSize: 13 } }, savedEntry ? '补充证据笔记' : '保存到证据库'),
    savedEntry ? null : h('p', { key: 'p', style: { margin: 0, color: C.muted, fontSize: 12, lineHeight: 1.5 } },
      '默认归入当前课题并标记为「待核验」，之后可在证据库逐条核对来源。'),
    h('div', { key: 'grid', className: 'rk-form-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 } }, [
      savedEntry ? null : h(Field, { key: 'title', label: '标题' },
        h(Input, { value: form.title, onChange: value => update('title', value), ariaLabel: '证据标题' })),
      savedEntry ? null : h(Field, { key: 'identifier', label: `稳定标识符${detected.value ? `（已识别 ${EVIDENCE_IDENTIFIER_LABELS[detected.kind]}）` : '（可选）'}` },
        h(Input, { value: form.identifier, onChange: value => update('identifier', value), placeholder: 'DOI / PMID / NCT / 数据集编号', ariaLabel: '稳定标识符' })),
      savedEntry ? null : h(Field, { key: 'project', label: '课题（默认当前课题）' },
        h(Input, { value: form.project, onChange: value => update('project', value), placeholder: '例：肿瘤队列分析', ariaLabel: '课题' })),
      h(Field, { key: 'tags', label: '标签（逗号分隔）' },
        h(Input, { value: form.tags, onChange: value => update('tags', value), ariaLabel: '标签' })),
    ]),
    h(Field, { key: 'reason', label: '保存原因（可选）' },
      h(Textarea, { value: form.reason, onChange: value => update('reason', value), rows: 2, placeholder: '这条来源为什么值得留下', ariaLabel: '保存原因' })),
    h(Field, { key: 'note', label: '笔记（可选）' },
      h(Textarea, { value: form.note, onChange: value => update('note', value), rows: 2, ariaLabel: '笔记' })),
    error ? h(Notice, { key: 'error', tone: 'error', icon: 'shield' }, error) : null,
    conflict ? h(Notice, { key: 'conflict', tone: 'warn', icon: 'shield' },
      `当前课题已有这条来源：「${conflict.title}」（${EVIDENCE_STATUS_LABELS[conflict.status] || conflict.status}）。要更新已有笔记，还是另存一份？`) : null,
    h('div', { key: 'row', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
      !conflict ? h(Button, { key: 'save', variant: 'primary', size: 'sm', icon: 'check', disabled: saving || (!savedEntry && !form.title.trim()), onClick: () => submit() }, saving ? '保存中…' : savedEntry ? '保存笔记' : '确认保存') : null,
      conflict ? h(Button, { key: 'update', variant: 'primary', size: 'sm', icon: 'check', disabled: saving, onClick: () => submit('update') }, '更新已有笔记') : null,
      conflict ? h(Button, { key: 'force', variant: 'ghost', size: 'sm', disabled: saving, onClick: () => submit('new') }, '仍然另存一份') : null,
      h(Button, { key: 'cancel', variant: 'ghost', size: 'sm', onClick: onCancel }, '取消'),
    ]),
  ])
}
