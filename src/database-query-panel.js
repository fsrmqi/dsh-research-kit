import React from 'react'
import { h, C } from './theme.js'
import { Card, Button, Input, Notice, Spinner, Badge } from './ui.js'
import { createEvidenceStore } from './evidence-store.js'
import { EvidenceSaveForm } from './research-evidence-vault.js'

const QUERY_PATH = '/dsh-research-kit/query'

export function DatabaseQueryPanel({ database, sessionId, inputActions, evidenceStore }) {
  const evidence = React.useMemo(() => evidenceStore || createEvidenceStore(sessionId), [evidenceStore, sessionId])
  const [query, setQuery] = React.useState('')
  const [state, setState] = React.useState({ status: 'idle', result: null, message: '' })
  // 保存证据是逐条显式动作：展开哪一条的表单、哪些已落库，都由用户点击驱动，绝不自动入库。
  const [saveTarget, setSaveTarget] = React.useState('')
  const [savedKeys, setSavedKeys] = React.useState([])
  const canWrite = typeof inputActions?.setDraft === 'function'
  const canSubmit = canWrite && typeof inputActions?.submit === 'function'
  const agentTask = sources => {
    const sourceBlock = sources?.length
      ? `\n\n以下是插件直查得到的候选记录，请逐条打开来源核验后再引用：\n${sources.map((item, index) => `${index + 1}. ${item.title}\n${item.url}`).join('\n')}`
      : ''
    return `请通过当前 DSH Agent 查询「${database.name}」：${query.trim()}。使用当前会话已配置的 Web、MCP 或其他工具；返回实际检索到记录的标题、稳定标识符、来源链接、年份/版本和相关性说明。${sourceBlock}\n\n不得编造文献、DOI、数据集编号或检索结果；不能访问时明确说明原因。`
  }
  const runQuery = async event => {
    event?.preventDefault?.()
    const text = query.trim()
    if (!text) return setState({ status: 'error', result: null, message: '请输入检索词。' })
    setState({ status: 'loading', result: null, message: '正在查询公开数据源…' })
    try {
      const url = new URL(QUERY_PATH, window.location.origin)
      url.searchParams.set('database_id', database.id)
      url.searchParams.set('q', text)
      url.searchParams.set('limit', '5')
      const response = await fetch(url)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || body.error || `查询失败（HTTP ${response.status}）`)
      evidence.recordQuery({ databaseId: database.id, databaseName: database.name, mode: body.mode === 'agent-fallback' ? 'agent' : 'direct', sources: body.sources || [] })
      setState({ status: body.mode === 'agent-fallback' ? 'fallback' : 'ready', result: body, message: body.reason || '' })
    } catch (error) { setState({ status: 'error', result: null, message: String(error?.message || error) }) }
  }
  const writeAgentFallback = () => {
    const prompt = state.result?.prompt || agentTask()
    if (!prompt || !canWrite) return
    inputActions.setDraft(prompt)
    setState(current => ({ ...current, message: '已写入当前会话输入框；发送后由 Agent 使用可用工具继续查询。' }))
  }
  const runWithAgent = async sources => {
    if (!canSubmit) return setState(current => ({ ...current, message: '当前 DSH 会话未提供发送操作，无法直接调用 Agent。' }))
    inputActions.setDraft(agentTask(sources))
    try {
      await inputActions.submit()
      setState(current => ({ ...current, message: '已发送给当前 DSH Agent 查询；结果会在聊天会话中返回。' }))
    } catch (error) { setState(current => ({ ...current, message: `Agent 查询未提交：${error?.message || error}` })) }
  }
  const writeSources = () => {
    const sources = state.result?.sources || []
    if (!sources.length || !canWrite) return
    const text = [`以下是通过 ${database.name} 实际查询到的候选来源，请继续核验并据此回答：`, ...sources.map((item, index) => `${index + 1}. ${item.title}\n   ${item.url}${item.meta ? `\n   ${item.meta}` : ''}${item.summary ? `\n   ${item.summary}` : ''}`)].join('\n')
    inputActions.setDraft(text)
    setState(current => ({ ...current, message: '已将候选来源写入输入框；请检查后再发送。' }))
  }
  const loading = state.status === 'loading'
  return h(Card, { style: { padding: 14, background: C.surfaceAlt, display: 'grid', gap: 12 } }, [
    h('div', { key: 'title' }, [
      h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
        h('strong', { key: 't', style: { fontSize: 13 } }, `查询 ${database.name}`),
        h(Badge, { key: 'b', color: C.teal }, '公开 API 直查'),
      ]),
      h('p', { key: 'p', style: { margin: '4px 0 0', color: C.muted, fontSize: 12, lineHeight: 1.5 } }, '公开 API 将由插件服务端通过 DSH 受控网络访问；受限来源会转为当前 Agent 查询任务。'),
    ]),
    h('form', { key: 'form', onSubmit: runQuery, style: { display: 'flex', gap: 8 } }, [
      h(Input, { key: 'i', value: query, onChange: setQuery, placeholder: `例如：${database.name} 中的检索主题`, ariaLabel: '检索词', style: { flex: 1, minWidth: 0 } }),
      h(Button, { key: 'go', type: 'submit', variant: 'primary', icon: loading ? undefined : 'search', disabled: loading }, loading ? '查询中…' : '查询'),
    ]),
    loading ? h(Spinner, { key: 'spin', text: '正在查询公开数据源…' }) : null,
    state.status === 'ready' ? h('div', { key: 'results', style: { display: 'grid', gap: 8 } }, [
      ...(state.result?.sources || []).map((item, index) => {
        const sourceKey = String(item.id || item.url || index)
        const saved = savedKeys.includes(sourceKey)
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
              disabled: saved,
              onClick: () => setSaveTarget(current => (current === sourceKey ? '' : sourceKey)),
            }, saved ? '已保存到证据库' : '保存到证据库'),
          ]),
          saveTarget === sourceKey ? h(EvidenceSaveForm, {
            key: 'form',
            source: item,
            databaseName: database.name,
            onCancel: () => setSaveTarget(''),
            onSaved: () => {
              setSavedKeys(rows => [...rows, sourceKey])
              setSaveTarget('')
              setState(current => ({ ...current, message: '已保存到证据库，默认标记为「未核验」，需逐条打开来源核验。' }))
            },
          }) : null,
        ])
      }),
      state.result?.sources?.length
        ? h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
          h(Button, { key: 'write', size: 'sm', variant: 'soft', icon: 'edit', disabled: !canWrite, onClick: writeSources }, '将候选来源写入输入框'),
          h(Button, { key: 'agent', size: 'sm', variant: 'primary', icon: 'send', disabled: !canSubmit, onClick: () => runWithAgent(state.result.sources) }, '让 Agent 核验并继续查询'),
        ])
        : h('div', { key: 'empty', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, [
          h('span', { key: 't', style: { color: C.muted, fontSize: 13 } }, '该来源未返回候选记录。'),
          h(Button, { key: 'agent', size: 'sm', variant: 'primary', disabled: !canSubmit, onClick: () => runWithAgent() }, '让 Agent 继续查询'),
        ]),
    ]) : null,
    state.status === 'fallback' ? h(Notice, { key: 'fallback', tone: 'warn', icon: 'database' }, [
      h('span', { key: 'm', style: { display: 'block' } }, state.message || '该来源需要 MCP、授权或专用适配器。'),
      h('div', { key: 'a', style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } }, [
        h(Button, { key: 'w', size: 'sm', variant: 'soft', disabled: !canWrite, onClick: writeAgentFallback }, '写入 Agent 查询任务'),
        h(Button, { key: 'r', size: 'sm', variant: 'primary', disabled: !canSubmit, onClick: () => runWithAgent() }, '让 Agent 立即查询'),
      ]),
    ]) : null,
    state.status === 'error' ? h(Notice, { key: 'error', tone: 'error', icon: 'shield' }, state.message) : null,
    state.message && state.status === 'ready' ? h(Notice, { key: 'message', tone: 'info', icon: 'check' }, state.message) : null,
  ])
}
