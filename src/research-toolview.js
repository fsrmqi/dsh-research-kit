import React from 'react'
import { TOOL_REGISTRY } from '../mcp/tool-registry.js'

const byName = new Map(TOOL_REGISTRY.map(item => [item.name, item]))
export const researchToolNames = TOOL_REGISTRY.map(item => item.name)
const gradeLabel = value => ({ empirical: '实证', inference: '推论', missing: '缺失', ungraded: '未分级' }[value] || value || '未分级')
const verificationLabel = value => ({ verified: '来源已核验', unverified: '来源待核验', disputed: '来源有争议', stale: '来源已过期' }[value] || '')

function resultValue(block) {
  const value = block?.result ?? block?.content ?? block?.output
  if (typeof value !== 'string') return value || {}
  try { return JSON.parse(value) } catch { return { text: value } }
}

function recordsOf(value) {
  const data = value?.data && typeof value.data === 'object' ? value.data : value
  return [data?.sources, data?.entries, data?.results, data?.evidence?.entries, data?.evidence_save?.results].find(Array.isArray) || []
}

/** 将各 research_* 工具的异构结果收敛为不含正文的证据审阅模型。 */
export function researchToolDetailModel(toolName, block) {
  const tool = byName.get(toolName)
  const value = resultValue(block)
  const data = value?.data && typeof value.data === 'object' ? value.data : value
  const evidence = recordsOf(value).slice(0, 8).map(item => {
    const identifier = String(item?.doi || item?.identifier || (item?.identifier_type === 'doi' ? item?.id : '') || '')
    return {
      title: String(item?.title || item?.label || item?.name || '未命名来源').slice(0, 180),
      doi: identifier.toLowerCase().startsWith('10.') ? identifier : '',
      source: String(item?.source_id || item?.source || item?.identifier_type || '来源未标注'),
      url: /^https?:\/\//.test(String(item?.url || '')) ? String(item.url) : '',
      grade: item?.strength || item?.stored_grade || item?.suggested_grade || item?.grade || data?.grade || data?.grade_label || 'ungraded',
      verification: item?.source_verification || item?.verification?.status || item?.status || data?.source_verification || 'unverified',
    }
  })
  const pending = [
    ...(tool?.requiresConfirmation ? ['此工具会写入研究状态，执行前需人工确认。'] : []),
    ...(Array.isArray(data?.checkpoints?.pending) ? data.checkpoints.pending.map(item => `待确认检查点：${item}`) : []),
    ...(data?.apply === false ? ['当前仅为预览；确认后才会写回。'] : []),
  ]
  return { tool, evidence, pending: [...new Set(pending)].slice(0, 4), text: typeof value?.text === 'string' ? value.text.slice(0, 360) : '' }
}

/** DSH 0.1.7 keyed toolview：结构化呈现来源、DOI、等级与人工确认点。 */
export function ResearchToolView({ toolName, phase, block, inspect }) {
  const { tool, evidence, pending, text } = researchToolDetailModel(toolName, block)
  const state = phase === 'preparing' ? '准备中' : phase === 'start' ? '执行中' : '已完成'
  const tone = tool?.access === 'writes' ? '#9a6700' : tool?.access === 'external' ? '#0969da' : '#1a7f37'
  return React.createElement('section', {
    'aria-label': `${tool?.labelZh || toolName} 工具详情`,
    style: { margin: '8px 0', padding: '10px 12px', border: `1px solid ${tone}33`, borderRadius: 9, background: '#f6f8fa', fontSize: 12, lineHeight: 1.5 },
  }, [
    React.createElement('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', gap: 8 } }, [React.createElement('strong', { key: 'name' }, tool?.labelZh || toolName), React.createElement('span', { key: 'state', style: { color: tone } }, state)]),
    React.createElement('div', { key: 'summary', style: { color: '#57606a' } }, tool?.summaryZh || '科研 MCP 工具'),
    evidence.length ? React.createElement('div', { key: 'evidence', style: { display: 'grid', gap: 6, marginTop: 7 } }, evidence.map((item, index) => React.createElement('div', { key: `${item.title}:${index}`, style: { padding: '6px 8px', borderLeft: `3px solid ${tone}`, background: '#fff' } }, [
      React.createElement('div', { key: 'title' }, item.title),
      React.createElement('div', { key: 'meta', style: { color: '#57606a' } }, [`来源：${item.source}`, item.doi ? `DOI：${item.doi}` : null, `证据等级：${gradeLabel(item.grade)}`, verificationLabel(item.verification)].filter(Boolean).join(' · ')),
      item.url ? React.createElement('a', { key: 'url', href: item.url, target: '_blank', rel: 'noreferrer' }, '打开来源') : null,
    ]))) : null,
    pending.length ? React.createElement('div', { key: 'pending', style: { marginTop: 7, color: '#9a6700' } }, pending.map((item, index) => React.createElement('div', { key: index }, `人工确认：${item}`))) : null,
    text ? React.createElement('div', { key: 'out', style: { marginTop: 5, color: '#24292f', whiteSpace: 'pre-wrap' } }, text.replace(/\s+/g, ' ')) : null,
    typeof inspect === 'function' ? React.createElement('button', { key: 'inspect', type: 'button', onClick: inspect, style: { marginTop: 7 } }, '查看调用详情') : null,
  ])
}
