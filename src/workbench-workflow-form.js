import React from 'react'
import { RouteReplay } from './route-replay.js'
import { h, C } from './theme.js'
import { Card, Button, Badge, Chip, Field, Input, Textarea, Notice } from './ui.js'

// 受控参数表单与提示词预览：values、editedPrompt、attachedSkills 与 replayOpen
// 均由父组件 ResearchWorkbench 持有，避免因领域预设切换或局部重渲染而覆盖手动编辑草稿。
export function WorkbenchWorkflowForm({
  workflow, selectedCategory, taskPlan, activePlan, hasDraftAction,
  writeTaskPlan, togglePlanStage, sessionResources,
  values, onUpdateValue, suggestedSkills, attachedSkills, onToggleSkill,
  replayOpen, onToggleReplay, composed, finalPrompt, editedPrompt,
  onEditPrompt, onRestoreGeneratedPrompt, missingNow,
}) {
  const [promptOpen, setPromptOpen] = React.useState(false)
  React.useEffect(() => { if (editedPrompt !== null) setPromptOpen(true) }, [editedPrompt])
  React.useEffect(() => { setPromptOpen(false) }, [workflow?.id])
  return h(React.Fragment, null, [
    h('div', { key: 'meta', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
      h(Chip, { key: 'cat', color: C.teal }, selectedCategory),
      h(Badge, { key: 'params', color: C.slate }, `${(workflow.placeholders || []).length} 个参数`),
      workflow.requiresFiles ? h(Badge, { key: 'files', color: C.amber }, '需要材料') : null,
    ]),
    workflow.requiresFiles ? h(Notice, { key: 'files-note', tone: 'warn', icon: 'file' }, '此流程需要研究材料：请先在 DSH 输入框中使用原生 @文件 引用相关文件。') : null,
    taskPlan ? h(Card, { key: 'task-plan', style: { padding: 14, background: C.tealTint, border: `1px solid ${C.tealLine}` } }, [
      h('strong', { key: 'title', style: { fontSize: 14 } }, '研究与交付计划'),
      h('div', { key: 'stages', style: { margin: '8px 0', display: 'grid', gap: 5, fontSize: 13 } }, taskPlan.stages.map((stage, index) => {
        const done = Boolean(activePlan?.stages?.[index]?.done)
        return h('label', { key: stage, style: { display: 'flex', gap: 8, alignItems: 'center', opacity: done ? .72 : 1 } }, [
          h('input', { key: 'check', type: 'checkbox', checked: done, disabled: !activePlan, onChange: () => togglePlanStage(index), style: { accentColor: C.teal } }),
          h('span', { key: 'label', style: { textDecoration: done ? 'line-through' : 'none' } }, `${index + 1}. ${stage}`),
        ])
      })),
      h('div', { key: 'deliverables', style: { color: C.muted, fontSize: 12, lineHeight: 1.5 } }, `预期交付：${taskPlan.deliverables.join('、')}。所有阶段均需人工确认，不代表已执行。`),
      h(Button, { key: 'plan', size: 'sm', variant: 'soft', icon: 'layers', disabled: !hasDraftAction, onClick: writeTaskPlan, style: { marginTop: 10 } }, activePlan ? '研究计划已写入' : '写入研究与交付计划'),
    ]) : null,
    sessionResources.length ? h(Notice, { key: 'session', tone: 'info', icon: 'layers' }, `本会话已附加资源（${sessionResources.length}）：${sessionResources.map(item => item.name).join('、')}。可在输入框的「科研辅助 → 加资源」中调整。`) : null,
    ...(workflow.placeholders || []).map(field => h(Field, {
      key: field.key,
      label: field.label,
      required: field.required,
      hint: field.hint || null,
    }, field.multiline
      ? h(Textarea, { value: values[field.key] || '', onChange: value => onUpdateValue(field.key, value), rows: 3, placeholder: field.hint || '', ariaLabel: field.label })
      : h(Input, { value: values[field.key] || '', onChange: value => onUpdateValue(field.key, value), placeholder: field.hint || '', ariaLabel: field.label }))),
    suggestedSkills.length ? h(Card, { key: 'skills', style: { padding: 14, background: C.surfaceAlt } }, [
      h('strong', { key: 't', style: { display: 'block', fontSize: 13, marginBottom: 10 } }, '附加技能指导（勾选后追加到提示词）'),
      h('div', { key: 'list', style: { display: 'grid', gap: 8 } }, suggestedSkills.map(skill => h('label', {
        key: skill.id,
        style: {
          display: 'grid', gridTemplateColumns: '18px 1fr', gap: 10, alignItems: 'start', cursor: 'pointer',
          padding: '9px 11px', borderRadius: 9,
          border: `1px solid ${attachedSkills.includes(skill.id) ? C.tealLineStrong : C.line}`,
          background: attachedSkills.includes(skill.id) ? C.tealTint : C.surface,
        },
      }, [
        h('input', { key: 'box', type: 'checkbox', checked: attachedSkills.includes(skill.id), onChange: () => onToggleSkill(skill.id), style: { marginTop: 3, accentColor: C.teal } }),
        h('span', { key: 'text' }, [
          h('strong', { key: 'name', style: { fontSize: 13 } }, skill.name),
          h('span', { key: 'hint', style: { display: 'block', marginTop: 3, fontSize: 12, color: C.muted, lineHeight: 1.5 } }, skill.description),
        ]),
      ]))),
    ]) : null,
    h('div', { key: 'promptHead', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } }, [
      h(Button, {
        key: 'toggle-prompt', variant: 'ghost', size: 'sm',
        'aria-expanded': promptOpen,
        onClick: () => setPromptOpen(open => !open),
      }, promptOpen ? '收起提示词预览 ▴' : '展开提示词预览 ▾'),
      !promptOpen && editedPrompt === null ? h('span', { key: 'ready', style: { fontSize: 12, color: C.muted } }, '已按参数自动组装') : null,
      h('span', { key: 'sp', style: { flex: 1 } }),
      h(Button, { key: 'replay', variant: 'quiet', size: 'sm', icon: 'gauge', onClick: onToggleReplay }, replayOpen ? '收起回放' : '组装回放'),
    ]),
    replayOpen && composed?.trace?.length
      ? editedPrompt !== null
        ? h(Notice, { key: 'replay-edited', tone: 'warn' }, '提示词已手动编辑，自动组装轨迹可能与当前正文不一致。恢复自动生成后可查看组装回放。')
        : h(RouteReplay, { key: 'replay', trace: composed.trace, prompt: finalPrompt })
      : null,
    promptOpen ? h(Field, { key: 'prompt', label: '' },
      h(Textarea, { value: finalPrompt, onChange: onEditPrompt, rows: 10, mono: true, ariaLabel: '提示词预览' })) : null,
    editedPrompt !== null ? h(Notice, { key: 'edited', tone: 'warn', icon: 'edit' }, [
      '当前为手动编辑版本；字段和技能变更不会自动改写正文。',
      h(Button, { key: 'restore', variant: 'quiet', size: 'sm', icon: 'undo', onClick: onRestoreGeneratedPrompt, style: { marginLeft: 4 } }, '恢复自动生成'),
    ]) : null,
    missingNow.length ? h(Notice, { key: 'missing', tone: 'warn', icon: 'gauge' }, `尚未填写必填项：${missingNow.join('、')}；插入或发送前需要补齐。`) : null,
  ])
}
