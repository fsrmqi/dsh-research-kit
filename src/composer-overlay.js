import React from 'react'
import { catalog, itemById, searchCatalog, composeWorkflow, recommendedWorkflowsForResources } from './catalog.js'
import { createCatalogStorage } from './catalog-storage.js'
import { createResearchSelectionStore } from './research-selection-store.js'
import { h, C, GlobalStyle } from './theme.js'
import { Icon } from './lib/icons.js'
import { POPOVER_GAP, POPOVER_MAX_HEIGHT, overlayMaxHeight, findScrollport } from './lib/overlay-anchor.js'
import {
  Button, IconButton, Chip, Badge, Field, Input, Textarea, Notice, Modal, Segmented, EmptyState,
} from './ui.js'
import { RESEARCH_COMPOSER_EVENT, RESEARCH_RESOURCE_SELECTION_EVENT } from './composer-launcher.js'

const COMPOSER_TYPE_LABELS = { all: '全部', workflow: '工作流程', skill: '技能', database: '数据库' }
// 分类色取自与增强器共享的调色板（teal/blue/amber/red/紫/绿），不再另起一套色系。
const WORKFLOW_CATEGORY_COLORS = {
  '论文与手稿': C.blue,
  '文献研究': C.statusPreference,
  '数据分析': C.statusVerified,
  '研究设计': C.amber,
  '基因组学': C.teal,
  '临床研究': C.red,
}
const fallbackWorkflowColor = C.teal
// 工作流选择器优先呈现科研写作与生命科学常用入口；完整学科目录仍可通过“全部”下拉访问。
const DEFAULT_WORKFLOW_CATEGORIES = ['论文与手稿', '文献研究', '生物信息学', '作物遗传育种']

function unique(ids) { return [...new Set(ids)] }

function SearchInput({ value, onChange, placeholder, ariaLabel }) {
  return h('div', { style: { position: 'relative' } }, [
    h('span', {
      key: 'icon',
      'aria-hidden': 'true',
      style: { position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, display: 'flex' },
    }, h(Icon, { name: 'search', size: 14 })),
    h(Input, { key: 'input', value, onChange, placeholder, ariaLabel, style: { paddingLeft: 32 } }),
  ])
}

function WorkflowLaunchDialog({ workflow, resourceIds, inputActions, catalogStorage, onClose }) {
  const [values, setValues] = React.useState({})
  const [editedPrompt, setEditedPrompt] = React.useState(null)
  const [missing, setMissing] = React.useState([])
  const [notice, setNotice] = React.useState('')
  const resourceItems = resourceIds.map(itemById).filter(Boolean)
  const suggestedSkills = (workflow.suggestedSkillIds || []).map(itemById).filter(Boolean)
  const skillIds = unique([...resourceItems.filter(item => item.type === 'skill').map(item => item.id), ...suggestedSkills.filter(item => item.type === 'skill').map(item => item.id)])
  const databaseIds = resourceItems.filter(item => item.type === 'database').map(item => item.id)
  const assembled = composeWorkflow(workflow, values, { enforceRequired: false, extraSkillIds: skillIds, extraDatabaseIds: databaseIds }).prompt
  const finalPrompt = editedPrompt ?? assembled
  const hasDraftAction = typeof inputActions?.setDraft === 'function'
  const missingSet = new Set(missing)
  const update = (key, value) => setValues(current => ({ ...current, [key]: value }))
  const useWorkflow = () => {
    if (!hasDraftAction) return setNotice('当前 DSH 会话尚未提供输入框操作，无法使用该工作流程。')
    if (!String(finalPrompt).trim()) return setNotice('提示词为空，无法使用。')
    try {
      composeWorkflow(workflow, values, { extraSkillIds: skillIds, extraDatabaseIds: databaseIds })
      inputActions.setDraft(finalPrompt)
      // 使用即记录历史，供「历史」分组快速回到高频工作流。
      // 历史只记录工作流身份和时间，绝不从最终 Prompt 中提取用户参数或材料摘要。
      catalogStorage?.recordHistory?.({ id: workflow.id, name: workflow.name })
      onClose()
    } catch (error) { setMissing([]); setNotice(error.message) }
  }
  const copyPrompt = async () => {
    if (!String(finalPrompt).trim()) return setNotice('提示词为空，无需复制。')
    try {
      await navigator.clipboard.writeText(finalPrompt)
      catalogStorage?.recordHistory?.({ id: workflow.id, name: workflow.name })
      setNotice('已复制提示词到剪贴板；可粘贴到任意会话使用。')
    } catch (error) { setNotice(`复制失败：${error?.message || error}；可手动全选预览框文本复制。`) }
  }
  // 点按即校验：必填缺失时在弹窗内给出字段级错误，不依赖静默 notice。
  const validateThenUse = () => {
    const missingFields = (workflow.placeholders || [])
      .filter(field => field.required && !String(values[field.key] || '').trim())
      .map(field => field.label)
    if (missingFields.length) {
      setMissing(missingFields)
      return setNotice(`请填写必填项：${missingFields.join('、')}`)
    }
    setMissing([])
    setNotice('')
    useWorkflow()
  }
  const attachedResources = [...skillIds, ...databaseIds].map(itemById).filter(Boolean)
  const color = WORKFLOW_CATEGORY_COLORS[workflow.category] || fallbackWorkflowColor
  return h(Modal, {
    title: workflow.name,
    subtitle: workflow.description,
    onClose,
    footer: [
      h(Button, { key: 'copy', variant: 'quiet', icon: 'copy', onClick: copyPrompt, style: { marginRight: 'auto' } }, '复制 Prompt'),
      h(Button, { key: 'cancel', variant: 'ghost', onClick: onClose }, '取消'),
      h(Button, { key: 'use', variant: 'primary', icon: 'check', disabled: !hasDraftAction, onClick: validateThenUse }, '使用工作流程'),
    ],
  }, [
    h('div', { key: 'meta', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
      h(Chip, { key: 'cat', color }, workflow.category),
      h(Badge, { key: 'params', color: C.slate }, `${(workflow.placeholders || []).length} 个参数`),
      workflow.requiresFiles ? h(Badge, { key: 'file', color: C.amber }, '需要材料') : null,
    ]),
    workflow.requiresFiles ? h(Notice, {
      key: 'files', tone: 'warn', icon: 'file',
    }, workflow.limitations?.length
      ? `需要研究材料：使用后请在 DSH 输入框用原生回形针或 @文件 引用相关文件，再发送消息。本流程边界：${workflow.limitations.join(' ')}`
      : '需要研究材料：使用后请在 DSH 输入框用原生回形针或 @文件 引用相关文件，再发送消息。') : null,
    ...(workflow.placeholders || []).map(field => h(Field, {
      key: field.key,
      label: field.label,
      required: field.required,
      error: missingSet.has(field.label) ? '必填：此字段不能为空' : null,
      hint: field.hint || null,
    }, field.multiline
      ? h(Textarea, { value: values[field.key] || '', onChange: value => update(field.key, value), rows: 3, placeholder: field.hint || '', ariaLabel: field.label, style: missingSet.has(field.label) ? { borderColor: C.red } : undefined })
      : h(Input, { value: values[field.key] || '', onChange: value => update(field.key, value), placeholder: field.hint || '', ariaLabel: field.label, invalid: missingSet.has(field.label) }))),
    h(Field, { key: 'prompt', label: '提示词预览（可编辑）' },
      h(Textarea, { value: finalPrompt, onChange: setEditedPrompt, rows: 10, mono: true, ariaLabel: '提示词预览' })),
    attachedResources.length ? h('details', {
      key: 'resources',
      style: { padding: '9px 11px', border: `1px solid ${C.tealLine}`, borderRadius: 9, color: C.muted, fontSize: 13, lineHeight: 1.55 },
    }, [
      h('summary', { key: 's', style: { color: C.ink, cursor: 'pointer', fontWeight: 650 } }, `已附加资源（${attachedResources.length}）：${attachedResources.map(item => item.name).join('、')}`),
      h('ul', { key: 'l', style: { margin: '8px 0 0', paddingLeft: 18 } }, attachedResources.map(item => h('li', { key: item.id, style: { marginTop: 4 } },
        item.type === 'skill' ? `技能 · ${item.name}：作为提示词附加指导。` : `数据库 · ${item.name}：仅在当前会话具备访问能力时可查询。`))),
    ]) : null,
    notice ? h(Notice, { key: 'notice', tone: missing.length ? 'error' : 'warn' }, notice) : null,
  ])
}

/** 由 conversation.input.overlay 承载，锚定在输入卡片上方。 */
export function ResearchComposerOverlay({ sessionId, inputActions, catalogStorage }) {
  const storage = React.useMemo(() => catalogStorage || createCatalogStorage(), [catalogStorage])
  const selection = React.useMemo(() => createResearchSelectionStore(sessionId), [sessionId])
  const [mode, setMode] = React.useState(null)
  const [query, setQuery] = React.useState('')
  const [resourceType, setResourceType] = React.useState('all')
  const [workflowCategory, setWorkflowCategory] = React.useState('all')
  const [resourceIds, setResourceIds] = React.useState(() => selection.get())
  const [launchWorkflow, setLaunchWorkflow] = React.useState(null)
  const popoverRef = React.useRef(null)
  const [popoverHeight, setPopoverHeight] = React.useState(null)
  // 浮层贴住输入卡片上沿，而不是钉在视口左下角：
  // 槽位锚点是卡片顶边的零高条，绝对定位即与触发按钮同宽同轴；
  // 可用高度按「卡片顶边 → 滚动区顶边」实测，随输入框行数、附件栏与窗口尺寸自适应。
  React.useLayoutEffect(() => {
    if (!mode) { setPopoverHeight(null); return }
    const node = popoverRef.current
    // 锚点缺失时放弃测量：绝不以浮层自身的矩形当锚点，否则高度会自反馈抖动。
    const anchor = node?.closest('[data-composer-card]')
    if (!anchor) return
    const measure = () => {
      const scrollport = findScrollport(anchor)
      setPopoverHeight(overlayMaxHeight(
        anchor.getBoundingClientRect().top,
        scrollport ? scrollport.getBoundingClientRect().top : 0,
      ))
      return scrollport
    }
    // 卡片与滚动区都要观察：输入框变高会移动卡片顶边，滚动区变矮会压缩可用空间，
    // 这两种布局变化都不触发 window resize，只靠 resize 事件会残留过期高度。
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(anchor)
    const scrollport = measure()
    if (scrollport) observer?.observe(scrollport)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [mode])
  React.useEffect(() => {
    const onOpen = event => {
      const nextMode = event.detail?.mode === 'resources' ? 'resources' : 'workflows'
      setMode(nextMode)
      setQuery('')
      if (nextMode === 'resources') setResourceType('all')
      else setWorkflowCategory('all')
    }
    window.addEventListener(RESEARCH_COMPOSER_EVENT, onOpen)
    return () => window.removeEventListener(RESEARCH_COMPOSER_EVENT, onOpen)
  }, [])
  React.useEffect(() => { setResourceIds(selection.get()); return selection.subscribe(setResourceIds) }, [selection])
  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent(RESEARCH_RESOURCE_SELECTION_EVENT, { detail: { count: resourceIds.length } }))
  }, [resourceIds])
  // Escape 关闭最上层的弹层：先关预览弹窗，再关选择器。
  React.useEffect(() => {
    if (!mode && !launchWorkflow) return
    const onKeyDown = event => {
      if (event.key !== 'Escape') return
      if (launchWorkflow) setLaunchWorkflow(null)
      else setMode(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, launchWorkflow])
  // 浮层不是 Modal，没有遮罩层；因此要在文档层判定“点击是否落在整张浮层卡片内”。
  // 不能绑在内容滚动区，否则标题、筛选栏或卡片边框都会被误判为外部点击。
  React.useEffect(() => {
    if (!mode || launchWorkflow) return undefined
    const onPointerDown = event => {
      if (popoverRef.current?.contains(event.target)) return
      setMode(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [mode, launchWorkflow])
  if (!mode && !launchWorkflow) return null
  const listType = mode === 'workflows' ? 'workflow' : resourceType === 'all' ? 'all' : resourceType
  const rows = searchCatalog({ query, type: listType })
    .filter(item => mode !== 'resources' || item.type !== 'workflow')
    .filter(item => mode !== 'workflows' || workflowCategory === 'all' || item.category === workflowCategory)
  const toggle = id => selection.toggle(id)
  const close = () => setMode(null)
  const selectWorkflow = workflow => { setLaunchWorkflow(workflow); setMode(null) }
  const recommendedWorkflows = recommendedWorkflowsForResources(resourceIds).slice(0, 4)
  const workflowCategories = unique(catalog.filter(item => item.type === 'workflow').map(item => item.category))
  const defaultWorkflowCategories = DEFAULT_WORKFLOW_CATEGORIES.filter(category => workflowCategories.includes(category))
  const additionalWorkflowCategories = workflowCategories.filter(category => !defaultWorkflowCategories.includes(category))
  const resourceTabs = [
    { value: 'all', label: `全部（${catalog.filter(item => item.type !== 'workflow').length}）` },
    { value: 'database', label: `数据库（${catalog.filter(item => item.type === 'database').length}）` },
    { value: 'skill', label: `技能（${catalog.filter(item => item.type === 'skill').length}）` },
  ]
  const categoryStyle = WORKFLOW_CATEGORY_COLORS[workflowCategory] || fallbackWorkflowColor
  return h(React.Fragment, null, [
    mode ? h('section', {
      key: 'popover',
      ref: popoverRef,
      role: 'dialog',
      'aria-label': mode === 'workflows' ? '选择科研工作流程' : '选择科研资源',
      className: 'rk-pop',
      style: {
        // 锚定在输入卡片顶边（宿主槽位锚点）：水平贴合卡片左缘，垂直顶在卡片上方间隙处。
        // 不写死 left/bottom 像素坐标，也不写死 100vw 宽度——全部相对锚点解算。
        position: 'absolute', left: 0, bottom: `calc(100% + ${POPOVER_GAP}px)`, zIndex: 20010,
        boxSizing: 'border-box', width: 'min(560px, 100%)',
        maxHeight: popoverHeight == null ? POPOVER_MAX_HEIGHT : popoverHeight,
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        border: `1px solid ${C.tealLine}`, borderRadius: 16,
        background: C.surface, color: C.ink, boxShadow: C.shadowLg,
      },
    }, [
      h(GlobalStyle, { key: 'style' }),
      h('div', { key: 'head', style: { padding: '13px 14px 10px', borderBottom: `1px solid ${C.line}`, display: 'grid', gap: 10 } }, [
        h('div', { key: 'top', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 } }, [
          h('span', { key: 'title', style: { fontSize: 13, fontWeight: 750, color: C.ink } }, mode === 'workflows' ? '科研工作流程' : '科研资源'),
          h(IconButton, { key: 'close', name: 'close', size: 16, label: '关闭', onClick: close }),
        ]),
        h(SearchInput, {
          key: 'search',
          value: query,
          onChange: setQuery,
          placeholder: mode === 'workflows' ? '搜索工作流程……' : '输入搜索内容…',
          ariaLabel: '搜索',
        }),
        mode === 'resources'
          ? h(Segmented, { key: 'tabs', value: resourceType, options: resourceTabs, onChange: setResourceType, ariaLabel: '资源类型' })
          : h('div', { key: 'cats', style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 2 } }, [
            h('select', {
              key: 'all-categories',
              value: workflowCategory,
              onChange: event => setWorkflowCategory(event.target.value),
              'aria-label': '全部工作流程分类',
              className: 'rk-btn rk-workflow-category-select',
              style: {
                padding: '5px 25px 5px 10px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${workflowCategory === 'all' || additionalWorkflowCategories.includes(workflowCategory) ? C.teal : `${C.teal}40`}`,
                background: workflowCategory === 'all' || additionalWorkflowCategories.includes(workflowCategory) ? C.teal : 'transparent',
                color: workflowCategory === 'all' || additionalWorkflowCategories.includes(workflowCategory) ? C.onInk : C.teal,
                fontSize: 12, fontWeight: 700,
              },
            }, [
              h('option', { key: 'all', value: 'all' }, '全部'),
              ...defaultWorkflowCategories.map(category => h('option', { key: category, value: category }, category)),
              ...additionalWorkflowCategories.map(category => h('option', { key: category, value: category }, category)),
            ]),
            ...defaultWorkflowCategories.map(category => {
              const color = WORKFLOW_CATEGORY_COLORS[category] || fallbackWorkflowColor
              const active = workflowCategory === category
              return h('button', {
                key: category,
                type: 'button',
                onClick: () => setWorkflowCategory(category),
                'aria-pressed': active,
                className: 'rk-btn',
                style: {
                  padding: '5px 10px', borderRadius: 999, whiteSpace: 'nowrap', cursor: 'pointer',
                  border: `1px solid ${active ? color : `${color}40`}`,
                  background: active ? color : 'transparent',
                  color: active ? C.onInk : color, fontSize: 12, fontWeight: 700,
                },
              }, category)
            }),
          ]),
      ]),
      h('div', { key: 'rows', className: 'rk-scroll', style: { overflowY: 'auto', flex: 1, padding: rows.length ? '10px 0' : 0 } }, [
        mode === 'workflows' && rows.length ? h('div', {
          key: 'label',
          style: { padding: '2px 15px 7px', color: categoryStyle, fontSize: 12, fontWeight: 750 },
        }, `${workflowCategory === 'all' ? '全部工作流程' : workflowCategory}（${rows.length}）`) : null,
        rows.length ? rows.map(item => mode === 'workflows' ? (() => {
          const color = WORKFLOW_CATEGORY_COLORS[item.category] || fallbackWorkflowColor
          return h('button', {
            key: item.id,
            type: 'button',
            onClick: () => selectWorkflow(item),
            className: 'rk-card',
            style: {
              width: 'calc(100% - 28px)', margin: '0 14px 10px', display: 'grid', gap: 5,
              textAlign: 'left', padding: '13px 15px', cursor: 'pointer',
              border: `1px solid ${C.line}`, borderLeft: `3px solid ${color}`, borderRadius: 12,
              background: C.surface, color: C.ink, boxShadow: C.shadowCard,
            },
          }, [
            h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
              h('strong', { key: 'name', style: { fontSize: 13, fontWeight: 700 } }, item.name),
              item.requiresFiles ? h(Badge, { key: 'file', color: C.amber }, '需要材料') : null,
            ]),
            h('span', { key: 'desc', style: { color: C.muted, fontSize: 12, lineHeight: 1.5 } }, item.description),
          ])
        })() : h('label', {
          key: item.id,
          className: 'rk-row',
          style: {
            display: 'grid', gridTemplateColumns: '18px 1fr', gap: 10, alignItems: 'start',
            padding: '13px 15px', borderBottom: `1px solid ${C.divide}`, cursor: 'pointer',
            background: resourceIds.includes(item.id) ? C.tealTint : 'transparent',
          },
        }, [
          h('input', { type: 'checkbox', checked: resourceIds.includes(item.id), onChange: () => toggle(item.id), style: { marginTop: 3, accentColor: C.teal } }),
          h('span', { key: 'text' }, [
            h('span', { key: 'top', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
              h('strong', { key: 'name', style: { fontSize: 13, fontWeight: 650 } }, item.name),
              h(Badge, { key: 'type', color: C.teal }, COMPOSER_TYPE_LABELS[item.type]),
            ]),
            h('span', { key: 'desc', style: { display: 'block', marginTop: 3, color: C.muted, fontSize: 12, lineHeight: 1.5 } }, item.description),
          ]),
        ])) : h(EmptyState, {
          key: 'empty',
          icon: 'search',
          text: mode === 'workflows' ? '没有匹配的工作流程。' : '没有匹配的资源。',
          hint: '换个关键词，或切换上方的分类筛选。',
        }),
      ]),
      h('div', { key: 'footer', style: { padding: '10px 14px', borderTop: `1px solid ${C.line}`, display: 'grid', gap: 8, fontSize: 12, color: C.muted, background: C.surfaceAlt } }, mode === 'resources'
        ? [
          h('div', { key: 'picked', style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
            resourceIds.length
              ? resourceIds.map(id => {
                const item = itemById(id)
                if (!item) return null
                return h(Chip, {
                  key: id,
                  color: C.teal,
                  onRemove: () => toggle(id),
                  removeLabel: `移除 ${item.name}`,
                }, `${COMPOSER_TYPE_LABELS[item.type]} · ${item.name}`)
              })
              : '尚未选择资源；勾选技能或数据库后，将在启动工作流时并入提示词。'),
          recommendedWorkflows.length ? h('div', { key: 'rec', style: { display: 'grid', gap: 5 } }, [
            h('span', { key: 'l', style: { fontSize: 12, color: C.muted } }, '推荐下一步工作流程'),
            h('div', { key: 'items', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, recommendedWorkflows.map(workflow => h('button', {
              key: workflow.id,
              type: 'button',
              onClick: () => selectWorkflow(workflow),
              className: 'rk-btn',
              style: {
                padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${C.tealLineStrong}`, background: C.tealTint, color: C.teal,
                fontSize: 12, fontWeight: 650,
              },
            }, workflow.name))),
          ]) : null,
          h('div', { key: 'actions', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
            h('span', { key: 'hint' }, resourceIds.length ? `已选 ${resourceIds.length} 项：技能作为附加指导、数据库作为研究提示并入提示词` : '输入筛选条件，点击条目前的选择框'),
            h('div', { key: 'right', style: { display: 'flex', gap: 6, flexShrink: 0 } }, [
              resourceIds.length ? h(Button, { key: 'clear', variant: 'quiet', size: 'sm', onClick: () => selection.clear() }, '清空全部') : null,
              h(Button, { key: 'add', variant: 'primary', size: 'sm', onClick: close }, '添加'),
            ]),
          ]),
        ]
        : [h('span', { key: 'c' }, `${catalog.filter(item => item.type === 'workflow').length} 个工作流程中的 ${rows.length} 个`), h('span', { key: 't' }, '点击使用')]),
    ]) : null,
    launchWorkflow ? h(WorkflowLaunchDialog, { key: 'dialog', workflow: launchWorkflow, resourceIds, inputActions, catalogStorage: storage, onClose: () => setLaunchWorkflow(null) }) : null,
  ])
}
