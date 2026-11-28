import React from 'react'
import { h, C } from './theme.js'
import { Card, Button, Input, Notice, Spinner, Badge } from './ui.js'
import { createEvidenceStore } from './evidence-store.js'
import { EvidenceSaveForm } from './evidence-save-form.js'
import { evidenceVaultStore, getActiveProject, publishEvidenceVault, removeEvidenceEntryFromFile, saveEvidenceEntry } from './lib/evidence-vault-sync.js'
import { detectIdentifier } from './lib/evidence-vault-core.js'
import { activeResearchRun } from './research-context-store.js'
import { searchLedgerOutbox } from './lib/search-ledger-outbox.js'
import { summarizeSearchSnapshot } from './lib/research-ledger.js'
import { supportsSafeInsert } from './lib/input-actions.js'
import { pushToast } from './lib/toast.js'

const QUERY_PATH = '/dsh-research-kit/query'

export function databaseSearchText(query, englishQuery) {
  const terms = [query.trim(), englishQuery.trim()].filter(Boolean)
  return terms.length > 1 ? terms.map(term => `(${term})`).join(' OR ') : terms[0] || ''
}

export function DatabaseQueryPanel({ database, sessionId, inputActions, evidenceStore }) {
  const evidence = React.useMemo(() => evidenceStore || createEvidenceStore(sessionId), [evidenceStore, sessionId])
  const [query, setQuery] = React.useState('')
  const [englishQuery, setEnglishQuery] = React.useState('')
  const [bilingualOpen, setBilingualOpen] = React.useState(false)
  const [state, setState] = React.useState({ status: 'idle', result: null, message: '' })
  // 保存后可撤销或补笔记，重复来源进入冲突处理。
  const [saveTarget, setSaveTarget] = React.useState('')
  const [saveConflict, setSaveConflict] = React.useState(null)
  const [savedEntries, setSavedEntries] = React.useState({})
  const [savingKey, setSavingKey] = React.useState('')
  const requestRef = React.useRef(null)
  React.useEffect(() => () => requestRef.current?.abort(), [])
  const canInsert = supportsSafeInsert(inputActions)
  const [feedback, setFeedback] = React.useState('')
  const activeEnglishQuery = bilingualOpen ? englishQuery : ''
  const isDirectCapable = !database.availability || database.availability === 'available-in-plugin'
  const agentTask = sources => {
    const sourceBlock = sources?.length
      ? `\n\n以下是插件直查得到的候选记录，请逐条打开来源核验后再引用：\n${sources.map((item, index) => `${index + 1}. ${item.title}\n${item.url}`).join('\n')}`
      : ''
    return `请通过当前 DSH Agent 查询「${database.name}」：${state.result?.query || databaseSearchText(query, activeEnglishQuery)}。使用当前会话已配置的 Web、MCP 或其他工具；返回实际检索到记录的标题、稳定标识符、来源链接、年份/版本和相关性说明。${sourceBlock}\n\n不得编造文献、DOI、数据集编号或检索结果；不能访问时明确说明原因。`
  }
  const runQuery = async event => {
    event?.preventDefault?.()
    const text = databaseSearchText(query, activeEnglishQuery)
    if (!text) return setState({ status: 'error', result: null, message: '请填写检索词。' })
    requestRef.current?.abort()
    const request = new AbortController()
    requestRef.current = request
    const project = getActiveProject()
    const activeRun = activeResearchRun()
    const runId = activeRun?.project === project ? activeRun.id : ''
    setFeedback('')
    setSaveTarget('')
    setSaveConflict(null)
    setSavedEntries({})
    setState({ status: 'loading', result: null, message: '正在查询公开数据源…' })
    try {
      // 以 location.href 而非 location.origin 作为基准：同一份客户端在 Web（http://…:3080）与
      // Desktop App（dsh-app://app/）下都要能解析出本插件的相对路由，origin 是「宿主形态」相关的。
      const url = new URL(QUERY_PATH, window.location.href)
      url.searchParams.set('database_id', database.id)
      url.searchParams.set('q', text)
      url.searchParams.set('limit', '5')
      const response = await fetch(url, { signal: request.signal })
      const body = await response.json().catch(() => ({}))
      if (request.signal.aborted) return
      if (!response.ok) throw new Error(body.message || body.error || `查询失败（HTTP ${response.status}）`)
      const queriedAt = Date.now()
      evidence.recordQuery({ databaseId: database.id, databaseName: database.name, mode: body.mode === 'agent-fallback' ? 'agent' : 'direct', sources: body.sources || [] })
      if (body.mode !== 'agent-fallback') {
        const sources = Array.isArray(body.sources) ? body.sources : []
        const snapshot = summarizeSearchSnapshot({ databaseId: database.id, query: body.query || text, sources })
        searchLedgerOutbox.add({
          kind: 'search', project, runId,
          question: query, database: database.name, query: body.query || text,
          mode: body.mode || 'direct', at: queriedAt,
          ...snapshot,
        }).then(({ saved, durable }) => {
          if (!saved && !durable && !request.signal.aborted) setFeedback('本机暂不能保留待补记记录，请在关闭页面前到科研账本重试。')
        }).catch(() => {
          if (!request.signal.aborted) setFeedback('这条检索记录暂无法记入科研账本。')
        })
      }
      setState({ status: body.mode === 'agent-fallback' ? 'fallback' : 'ready', result: { ...body, queriedAt }, message: body.reason || '' })
    } catch (error) { if (!request.signal.aborted) setState({ status: 'error', result: null, message: String(error?.message || error) }) }
  }
  const quickSaveEvidence = async (item, sourceKey) => {
    if (savingKey) return
    setSavingKey(sourceKey)
    setSaveConflict(null)
    try {
      const detected = detectIdentifier(item.identifier, item.title, item.url, item.meta)
      const result = await saveEvidenceEntry({
        title: item.title || '',
        sourceDatabase: database.name,
        identifier: detected.value || '',
        identifierKind: detected.value ? detected.kind : 'accession',
        url: item.url,
        sourceMeta: item.meta,
        project: getActiveProject(),
      }, { onDuplicate: 'reject' })
      const entry = result.entry
      setSavedEntries(current => ({ ...current, [sourceKey]: entry }))
      setSaveTarget('')
      pushToast({
        message: '已保存到证据库（待核验）。',
        actionLabel: '撤销',
        onAction: async () => {
          try {
            const store = evidenceVaultStore()
            const [current] = await store.getMany([entry.id])
            if (!current) return
            const links = await store.listAssetEvidenceLinks({ evidenceId: entry.id })
            if (current.updatedAt !== entry.updatedAt || links.length) {
              pushToast({ message: '证据已有修改或关联，请在证据库中处理。', tone: 'warn' })
              return
            }
            await removeEvidenceEntryFromFile(entry)
            await store.remove(entry.id)
            publishEvidenceVault()
            setSavedEntries(current => {
              if (current[sourceKey]?.id !== entry.id) return current
              const next = { ...current }
              delete next[sourceKey]
              return next
            })
            pushToast({ message: '已撤销保存。' })
          } catch (error) {
            pushToast({ message: `撤销失败：${error?.message || error}`, tone: 'warn' })
          }
        },
      })
    } catch (failure) {
      if (failure?.code === 'DUPLICATE') {
        setSaveConflict(failure.duplicate)
        setSaveTarget(sourceKey)
      } else {
        pushToast({ message: `保存失败：${failure?.message || failure}`, tone: 'warn' })
      }
    } finally {
      setSavingKey('')
    }
  }
  const prepareDraft = async (text, copiedMessage = '已复制查询任务，可粘贴到会话。') => {
    try {
      if (canInsert) {
        const span = inputActions.captureInsertion()
        const inserted = span && inputActions.insertText(`\n\n${text}`, { ...span, start: span.end })
        setFeedback(inserted ? '已填入输入框，可检查后发送。' : '输入框暂不可写入，请重试。')
        return
      }
      await navigator.clipboard.writeText(text)
      setFeedback(copiedMessage)
    } catch {
      setFeedback('暂时无法填入或复制，请重试。')
    }
  }
  const writeAgentFallback = () => prepareDraft(state.result?.prompt || agentTask())
  const writeSources = () => {
    const sources = state.result?.sources || []
    if (!sources.length) return
    const text = [`以下是通过 ${database.name} 实际查询到的候选来源，请继续核验并据此回答：`, ...sources.map((item, index) => `${index + 1}. ${item.title}\n   ${item.url}${item.meta ? `\n   ${item.meta}` : ''}${item.summary ? `\n   ${item.summary}` : ''}`)].join('\n')
    prepareDraft(text, '已复制候选来源，可粘贴到会话。')
  }
  const agentLabel = canInsert ? '填入查询任务' : '复制查询任务'
  const loading = state.status === 'loading'
  return h(Card, { style: { padding: 14, background: C.surfaceAlt, display: 'grid', gap: 12 } }, [
    h('div', { key: 'title' }, [
      h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
        h('strong', { key: 't', style: { fontSize: 13 } }, `查询 ${database.name}`),
        h(Badge, { key: 'b', color: isDirectCapable ? C.teal : C.amber }, isDirectCapable ? '公开 API 直查' : '需 Agent / 工具查询'),
      ]),
      h('p', { key: 'p', style: { margin: '4px 0 0', color: C.muted, fontSize: 12, lineHeight: 1.5 } },
        isDirectCapable ? '直接查询公开学术接口；查询结果会自动记入本课题检索记录。' : '此数据源需要借助会话内的工具或网络能力，输入关键词后可准备查询任务。'),
    ]),
    h('form', { key: 'form', onSubmit: isDirectCapable ? runQuery : event => { event.preventDefault(); if (databaseSearchText(query, activeEnglishQuery)) prepareDraft(agentTask()) }, style: { display: 'grid', gap: 8 } }, [
      h('div', { key: 'main-row', style: { display: 'flex', gap: 8, alignItems: 'center' } }, [
        h(Input, { key: 'zh', value: query, onChange: setQuery, placeholder: '输入研究问题或关键词（支持中英文）', ariaLabel: '检索词', style: { flex: 1, minWidth: 0 } }),
        isDirectCapable
          ? h(Button, { key: 'go', type: 'submit', variant: 'primary', icon: loading ? undefined : 'search', disabled: loading }, loading ? '查询中…' : '查询')
          : h(Button, { key: 'go-agent', type: 'submit', variant: 'primary', icon: canInsert ? 'edit' : 'copy', disabled: !databaseSearchText(query, activeEnglishQuery) }, agentLabel),
      ]),
      bilingualOpen ? h(Input, { key: 'en', className: 'rk-reveal', value: englishQuery, onChange: setEnglishQuery, placeholder: '英文补充检索式（将与主检索词按 OR 合并）', ariaLabel: '英文检索式' }) : null,
      h('div', { key: 'hint-row', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
        h('span', { key: 'hint', style: { color: C.muted, fontSize: 12 } }, bilingualOpen ? '两栏均填写时按「主词 OR 英文」合并检索。' : '支持直接输入中文或英文检索式。'),
        h(Button, {
          key: 'toggle-en', size: 'sm', variant: 'quiet',
          onClick: () => setBilingualOpen(open => !open),
        }, bilingualOpen ? '收起英文补充' : '+ 英文补充检索式'),
      ]),
    ]),
    loading ? h(Spinner, { key: 'spin', text: '正在查询公开数据源…' }) : null,
    state.status === 'ready' ? h('div', { key: 'results', className: 'rk-content-swap', style: { display: 'grid', gap: 8 } }, [
      ...(state.result?.sources || []).map((item, index) => {
        const sourceKey = String(item.id || item.url || index)
        const saved = Boolean(savedEntries[sourceKey])
        const saving = savingKey === sourceKey
        return h('article', {
          key: item.id || index,
          className: 'rk-card',
          style: { padding: 12, border: `1px solid ${C.line}`, borderRadius: 10, background: C.surface },
        }, [
          h('a', { key: 't', href: item.url, target: '_blank', rel: 'noreferrer noopener', style: { color: C.teal, fontWeight: 700, fontSize: 13, lineHeight: 1.45 } }, item.title),
          item.meta ? h('div', { key: 'm', style: { marginTop: 4, color: C.muted, fontSize: 12 } }, item.meta) : null,
          item.summary ? h('p', { key: 's', style: { margin: '5px 0 0', color: C.muted, fontSize: 12, lineHeight: 1.5 } }, item.summary) : null,
          h('div', { key: 'save-row', style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 } }, [
            h(Button, {
              key: 'save',
              size: 'sm',
              variant: saved ? 'ghost' : 'soft',
              icon: saved ? 'check' : 'bookmark',
              disabled: saved || saving,
              onClick: () => quickSaveEvidence(item, sourceKey),
            }, saved ? '已保存到证据库' : saving ? '保存中…' : '保存到证据库'),
            h(Button, {
              key: 'edit-note',
              size: 'sm',
              variant: 'quiet',
              onClick: () => { setSaveConflict(null); setSaveTarget(current => (current === sourceKey ? '' : sourceKey)) },
            }, saveTarget === sourceKey ? '收起笔记' : saved ? '补充笔记' : '带笔记保存'),
          ]),
          saveTarget === sourceKey ? h(EvidenceSaveForm, {
            key: saveConflict?.id || 'form',
            source: item,
            databaseName: database.name,
            initialConflict: saveConflict,
            savedEntry: savedEntries[sourceKey],
            onCancel: () => { setSaveTarget(''); setSaveConflict(null) },
            onSaved: (entry, { updated, fileSynced }) => {
              setSavedEntries(rows => ({ ...rows, [sourceKey]: entry }))
              setSaveTarget('')
              setSaveConflict(null)
              pushToast({ message: fileSynced ? (updated ? '已更新证据笔记。' : '已保存到证据库（待核验）。') : '已保存在本机证据库，文件同步待重试。' })
            },
          }) : null,
        ])
      }),
      state.result?.sources?.length
        ? h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
          h(Button, { key: 'write', size: 'sm', variant: 'soft', icon: canInsert ? 'edit' : 'copy', onClick: writeSources }, canInsert ? '将候选来源填入输入框' : '复制候选来源'),
          h(Button, { key: 'agent', size: 'sm', variant: 'primary', icon: canInsert ? 'edit' : 'copy', onClick: () => prepareDraft(agentTask(state.result.sources)) }, canInsert ? '填入核验任务' : '复制核验任务'),
        ])
        : h('div', { key: 'empty', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, [
          h('span', { key: 't', style: { color: C.muted, fontSize: 13 } }, '该来源未返回候选记录。'),
          h(Button, { key: 'agent', size: 'sm', variant: 'primary', onClick: writeAgentFallback }, agentLabel),
        ]),
    ]) : null,
    state.status === 'fallback' ? h(Notice, { key: 'fallback', tone: 'warn', icon: 'database' }, [
      h('span', { key: 'm', style: { display: 'block' } }, state.message || '该来源需要通过会话内的 Agent 或工具查询。'),
      h('div', { key: 'a', style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } }, [
        h(Button, { key: 'w', size: 'sm', variant: 'soft', onClick: writeAgentFallback }, agentLabel),
      ]),
    ]) : null,
    state.status === 'error' ? h(Notice, { key: 'error', tone: 'error', icon: 'shield' }, state.message) : null,
    feedback ? h('p', { key: 'message', role: 'status', style: { margin: 0, color: C.muted } }, feedback) : null,
  ])
}
