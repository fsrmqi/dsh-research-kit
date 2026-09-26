import React from 'react'
import { TOOL_REGISTRY } from '../mcp/tool-registry.js'
import { C } from './theme.js'

// DSH 的 keyed toolview 使用模型实际看到的完整 MCP 工具名。
const MCP_TOOL_PREFIX = 'mcp__dsh-research-kit__'
const byName = new Map(TOOL_REGISTRY.map(item => [`${MCP_TOOL_PREFIX}${item.name}`, item]))
export const researchToolNames = [...byName.keys()]
const gradeLabel = value => ({ empirical: '实证', inference: '推论', missing: '缺失', ungraded: '未分级' }[value] || value || '未分级')
const verificationLabel = value => ({ verified: '来源已核验', unverified: '来源待核验', disputed: '来源有争议', stale: '来源已过期' }[value] || '')
const ARGUMENT_FIELDS = [['query', '检索词'], ['project', '项目'], ['run_id', '运行'], ['source', '来源'], ['sources', '数据库'], ['database', '数据库'], ['identifier', '标识符'], ['evidence_id', '证据']]

export function researchToolArgumentSummary(raw) {
  let args
  try { args = JSON.parse(raw || '{}') } catch { return raw ? `正在接收参数（${raw.length} 字符）` : '等待调用参数' }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '等待调用参数'
  const facts = ARGUMENT_FIELDS.flatMap(([key, label]) => {
    const value = args[key]
    const formatted = Array.isArray(value) ? value.join('、') : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
    return formatted ? [`${label}：${formatted.slice(0, 120)}`] : []
  })
  return facts.slice(0, 3).join(' · ') || '参数已就绪'
}

function resultValue(block) {
  // ToolResultNode.content 是 DSH 的持久化结果；MCP Server 每次返回一块 JSON 文本。
  const content = block?.content
  const value = Array.isArray(content)
    ? content.find(item => item?.type === 'text' && typeof item.text === 'string')?.text
    : block?.result ?? content ?? block?.output
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
    const storedGrade = item?.strength || item?.stored_grade || item?.grade
    const suggestedGrade = item?.suggested_grade || item?.grade_hint || data?.grade
    return {
      title: String(item?.title || item?.label || item?.name || '未命名来源').slice(0, 180),
      doi: identifier.toLowerCase().startsWith('10.') ? identifier : '',
      source: String(item?.source_id || item?.source || item?.identifier_type || '来源未标注'),
      url: /^https?:\/\//.test(String(item?.url || '')) ? String(item.url) : '',
      grades: [
        ...(storedGrade ? [{ label: '已记录等级', value: gradeLabel(storedGrade) }] : []),
        ...(suggestedGrade ? [{ label: '建议等级', value: gradeLabel(suggestedGrade) }] : []),
        ...(!storedGrade && !suggestedGrade ? [{ label: '证据等级', value: '未分级' }] : []),
      ],
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
function PreparingResearchToolView({ toolName, useToolCallArgumentsPartial }) {
  const raw = typeof useToolCallArgumentsPartial === 'function' ? useToolCallArgumentsPartial() : ''
  const tool = byName.get(toolName)
  return React.createElement('section', { 'aria-label': `${tool?.labelZh || toolName} 工具详情`, role: 'status', style: { margin: '8px 0', padding: '10px 12px', maxWidth: '100%', minWidth: 0, overflowWrap: 'anywhere', border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.blue}`, borderRadius: 9, background: C.surface, color: C.ink, fontSize: 12 } }, [
    React.createElement('strong', { key: 'name' }, `${tool?.labelZh || toolName} · 准备中`),
    React.createElement('div', { key: 'arguments' }, researchToolArgumentSummary(raw)),
  ])
}

export function ResearchToolView(props) {
  if (props.phase === 'preparing') return React.createElement(PreparingResearchToolView, props)
  return React.createElement(StartedResearchToolView, props)
}

function StartedResearchToolView({ toolName, phase, block, inspect }) {
  const { tool, evidence, pending, text } = researchToolDetailModel(toolName, block)
  const value = phase === 'result' ? resultValue(block) : null
  const failed = phase === 'result' && (block?.isError === true || value?.error === true)
  const state = phase === 'start' ? '执行中' : failed ? '失败' : '已完成'
  const tone = failed ? C.red : tool?.access === 'writes' ? C.amber : tool?.access === 'external' ? C.blue : C.teal
  return React.createElement('section', {
    'aria-label': `${tool?.labelZh || toolName} 工具详情`,
    style: { margin: '8px 0', padding: '10px 12px', maxWidth: '100%', minWidth: 0, overflowWrap: 'anywhere', border: `1px solid ${C.line}`, borderLeft: `3px solid ${tone}`, borderRadius: 9, background: C.surface, color: C.ink, fontSize: 12, lineHeight: 1.5 },
  }, [
    React.createElement('div', { key: 'head', style: { display: 'flex', justifyContent: 'space-between', gap: 8 } }, [React.createElement('strong', { key: 'name' }, tool?.labelZh || toolName), React.createElement('span', { key: 'state', style: { color: tone } }, state)]),
    React.createElement('div', { key: 'summary', style: { color: C.muted } }, tool?.summaryZh || '科研 MCP 工具'),
    phase === 'start' ? React.createElement('div', { key: 'arguments', style: { marginTop: 5 } }, researchToolArgumentSummary(block?.argsRaw)) : null,
    failed ? React.createElement('div', { key: 'error', role: 'alert', style: { marginTop: 5, color: tone } }, String(value?.message || block?.error?.message || '工具执行失败').slice(0, 240)) : null,
    evidence.length ? React.createElement('div', { key: 'evidence', style: { display: 'grid', gap: 6, marginTop: 7, minWidth: 0 } }, evidence.map((item, index) => React.createElement('div', { key: `${item.title}:${index}`, style: { padding: '6px 8px', minWidth: 0, borderLeft: `3px solid ${tone}`, background: C.surfaceAlt } }, [
      React.createElement('div', { key: 'title' }, item.title),
      React.createElement('div', { key: 'meta', style: { color: C.muted } }, [`来源：${item.source}`, item.doi ? `DOI：${item.doi}` : null, ...item.grades.map(fact => `${fact.label}：${fact.value}`), verificationLabel(item.verification)].filter(Boolean).join(' · ')),
      item.url ? React.createElement('a', { key: 'url', href: item.url, target: '_blank', rel: 'noreferrer' }, '打开来源') : null,
    ]))) : null,
    pending.length ? React.createElement('div', { key: 'pending', style: { marginTop: 7, color: C.amber } }, pending.map((item, index) => React.createElement('div', { key: index }, `人工确认：${item}`))) : null,
    text ? React.createElement('div', { key: 'out', style: { marginTop: 5, color: C.ink, whiteSpace: 'pre-wrap' } }, text.replace(/\s+/g, ' ')) : null,
    typeof inspect === 'function' ? React.createElement('button', { key: 'inspect', type: 'button', onClick: inspect, style: { marginTop: 7 } }, '查看调用详情') : null,
  ])
}
