import React from 'react'
import { Button, Card, Field, Input, Notice, Textarea } from './ui.js'
import { C, h } from './theme.js'
import {
  EVIDENCE_IDENTIFIER_LABELS,
  EVIDENCE_STATUS_LABELS,
  detectIdentifier,
} from './lib/evidence-vault-core.js'
import { getActiveProject, saveEvidenceEntry } from './lib/evidence-vault-sync.js'

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
