import React from 'react'
import { extractKnowledge, KNOWLEDGE_KIND_LABELS } from './lib/knowledge-extract.js'
import { depositAssistantMessage } from './knowledge-deposition.js'

export function reviewableAssistantMessage(sessions, sessionId, messageId) {
  let entries
  try { entries = sessions?.binding?.(String(sessionId))?.eventSource?.getSnapshot?.()?.entries } catch { return null }
  if (!Array.isArray(entries)) return null
  const event = entries.findLast(item => item?.type === 'assistant/message' && String(item?.data?.message?.id) === String(messageId))
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return null
  const text = content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n')
  if (!text.trim()) return null
  const extraction = extractKnowledge(text)
  return { text, seq: Number(event.seq), turn: Number(event.data?.turn) || null, at: Number(event.time) || 0, interrupted: Boolean(event.data?.interrupted), extraction }
}

export function ResearchMessageDepositAction({ messageId, sessionId, sessions, assetProvider }) {
  const [preview, setPreview] = React.useState(null)
  const [selectedNodes, setSelectedNodes] = React.useState([])
  const [selectedCitations, setSelectedCitations] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  const open = () => {
    const found = reviewableAssistantMessage(sessions, sessionId, messageId)
    if (!found) { setNotice('当前会话窗口中找不到这条回答。'); return }
    setPreview(found)
    setSelectedNodes(found.extraction.nodes.map(node => node.key))
    setSelectedCitations(found.extraction.citations.map((_, index) => index))
    setNotice('')
  }
  const toggle = (values, setValues, key) => setValues(values.includes(key) ? values.filter(item => item !== key) : [...values, key])
  const confirm = async () => {
    if (!preview || busy) return
    if (!selectedNodes.length && !selectedCitations.length) { setNotice('请至少选择一项。'); return }
    const latest = reviewableAssistantMessage(sessions, sessionId, messageId)
    if (!latest || latest.seq !== preview.seq || latest.text !== preview.text) { setNotice('回答已变化，请重新打开预览。'); setPreview(null); return }
    setBusy(true)
    try {
      const summary = await depositAssistantMessage({
        text: preview.text, sessionId: String(sessionId), seq: preview.seq, turn: preview.turn, at: preview.at,
        selection: { nodeKeys: selectedNodes, citationIndexes: selectedCitations }, assetProvider: assetProvider?.(),
      })
      setNotice(summary.extracted ? `已沉淀：知识 ${summary.addedNodes}、证据 ${summary.savedEvidence}、资产 ${summary.savedAssets}；均待人工核验。` : '所选内容没有可提取的研究信息。')
      setPreview(null)
    } catch (error) { setNotice(`沉淀失败：${error?.message || error}`) }
    finally { setBusy(false) }
  }
  return React.createElement('span', { style: { display: 'inline-flex', position: 'relative', alignItems: 'center', fontSize: 12 } }, [
    React.createElement('button', { key: 'open', type: 'button', onClick: open, 'aria-label': '审阅并沉淀这条研究回答' }, '审阅沉淀'),
    notice ? React.createElement('span', { key: 'notice', role: 'status', style: { position: 'absolute', top: '100%', left: 0, zIndex: 50, padding: 6, width: 'min(320px, calc(100vw - 24px))', background: '#fff', border: '1px solid #d0d7de', borderRadius: 6 } }, notice) : null,
    preview ? React.createElement('div', { key: 'preview', role: 'group', 'aria-label': '研究回答沉淀预览', style: { position: 'absolute', top: '100%', left: 0, zIndex: 51, padding: 10, width: 'min(360px, calc(100vw - 24px))', maxHeight: 300, overflow: 'auto', border: '1px solid #d0d7de', borderRadius: 8, background: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,.15)' } }, [
      React.createElement('strong', { key: 'title' }, `回答 #${preview.seq} · 选择待核验内容`),
      preview.interrupted ? React.createElement('div', { key: 'interrupted', style: { color: '#9a6700' } }, '这条回答曾被中断，内容可能不完整。') : null,
      ...preview.extraction.nodes.map(node => React.createElement('label', { key: node.key, style: { display: 'block' } }, [
        React.createElement('input', { key: 'check', type: 'checkbox', checked: selectedNodes.includes(node.key), onChange: () => toggle(selectedNodes, setSelectedNodes, node.key) }),
        `${KNOWLEDGE_KIND_LABELS[node.kind] || '知识'}：${node.label}`,
      ])),
      ...preview.extraction.citations.map((citation, index) => React.createElement('label', { key: `citation-${index}`, style: { display: 'block' } }, [
        React.createElement('input', { key: 'check', type: 'checkbox', checked: selectedCitations.includes(index), onChange: () => toggle(selectedCitations, setSelectedCitations, index) }),
        `引用：${citation.identifier || citation.url || citation.title || '来源待核验'}`,
      ])),
      !preview.extraction.nodes.length && !preview.extraction.citations.length ? React.createElement('div', { key: 'empty' }, '未提取出知识或引用。') : null,
      React.createElement('button', { key: 'confirm', type: 'button', disabled: busy || (!selectedNodes.length && !selectedCitations.length), onClick: confirm }, busy ? '沉淀中…' : '确认沉淀所选'),
      React.createElement('button', { key: 'cancel', type: 'button', disabled: busy, onClick: () => setPreview(null) }, '取消'),
    ]) : null,
  ])
}
