import React from 'react'
import { catalog, itemById, searchCatalog, selectedCatalogItem, composeWorkflow, databaseMetadata } from './catalog.js'
import { createCatalogStorage } from './catalog-storage.js'
import { createResearchSelectionStore } from './research-selection-store.js'
import { createEvidenceStore } from './evidence-store.js'
import { DatabaseQueryPanel } from './database-query-panel.js'
import { h, C, GlobalStyle } from './theme.js'
import { Icon } from './lib/icons.js'
import {
  Page, PageHead, Toolbar, Panel, PanelHead, Card, Button, StarButton,
  Badge, Chip, Field, Input, Textarea, Select, Notice, Segmented, GroupLabel, EmptyState, ListRow,
} from './ui.js'

const TYPE_LABELS = { all: '全部', workflow: '工作流程', skill: '技能', database: '数据库' }
const WORKBENCH_DEFAULT_WORKFLOW_CATEGORIES = ['论文与手稿', '文献研究', '生物信息学', '作物遗传育种']
const WORKBENCH_WORKFLOW_CATEGORY_COLORS = {
  '论文与手稿': C.blue,
  '文献研究': C.statusPreference,
  '数据分析': C.statusVerified,
  '研究设计': C.amber,
  '基因组学': C.teal,
  '临床研究': C.red,
}
const workbenchFallbackWorkflowColor = C.teal
const RESEARCH_PLAN_STAGES = {
  '论文与手稿': ['确认材料与研究问题', '双语检索与来源核验', '结构与章节计划', '分段起草或修改', '引文、图表与一致性核对', '作者确认与交付'],
  '文献研究': ['界定问题与范围', '双语检索式', '筛选与证据表', '主题综合与研究空白', '核验引用与待确认项', '输出综述草案'],
  '数据分析': ['确认数据与分析问题', '数据质量检查', '分析计划与前提', '执行与结果核验', '可重复性记录', '输出分析报告'],
}
// 科研模式按当下常见科研任务重组：一键选择后附加对应的技能组合与领域纪律段。
// 语义是「预设指导组合」而不是能力开关——不会自动执行任何工具。
const SCIENCE_MODE_BASE = '【科研模式】本次任务按以下纪律执行：区分已提供材料、可验证外部来源与推断；不得编造文献、数据、页码或结论；结论标注为需人工核验的草案。'
export const SCIENCE_MODE_PRESETS = {
  general: {
    label: '通用研究',
    skills: ['scientific-writing', 'statistics-review', 'citation-hygiene', 'evidence-synthesis', 'reproducibility', 'data-integrity', 'uncertainty-communication'],
    preamble: '【通用研究模式】在通用科研纪律之上追加：1. 先明确研究问题、研究对象、范围与成功判据；2. 区分探索性与验证性分析，列出关键假设及证据强度；3. 记录检索式、数据版本、软件版本和关键决策；4. 明确局限、替代解释与需要人工确认的事项。'
  },
  literature: {
    label: '文献与论文',
    skills: ['scientific-writing', 'citation-hygiene', 'evidence-synthesis', 'peer-review-ethics', 'uncertainty-communication'],
    preamble: '【文献与论文模式】在通用科研纪律之上追加：1. 先界定问题、检索范围、纳入排除标准与检索日期；2. 每条核心论断追溯到可核验的原始来源，区分原始研究、综述与预印本；3. 写作时区分结果、解释与推断，不用引用堆砌替代论证；4. 引用、图表、统计量和作者主张逐项核对，无法核验时明确标记。'
  },
  bioinformatics: {
    label: '生物信息学',
    skills: ['bioinformatics-workflow-governance', 'statistics-review', 'reproducibility', 'data-integrity', 'uncertainty-communication'],
    preamble: '【生物信息学模式】在通用科研纪律之上追加：1. 明确参考基因组、注释版本、样本元数据、软件与数据库版本；2. 报告质控、过滤、批次处理和每一步保留数量，禁止静默丢弃样本或特征；3. 记录参数、随机种子、工作流版本与可复现实验环境；4. 将关联、差异和预测与因果结论严格分开，并说明独立验证需求。'
  },
  cropBreeding: {
    label: '作物遗传育种',
    skills: ['agricultural-experiment-design', 'crop-genomics', 'statistics-review', 'reproducibility', 'data-integrity', 'uncertainty-communication'],
    preamble: '【作物遗传育种模式】在通用科研纪律之上追加：1. 明确种质、群体结构、试验设计、环境与栽培管理条件；2. 表型、基因型和多环境数据分别质控，并保留缺失、剔除与异常值处理依据；3. 分析群体结构、亲缘关系、基因型×环境互作和选择偏差；4. 将候选位点、遗传效应和育种价值分开表述，候选结果须经独立群体或试验验证。'
  },
  clinical: {
    label: '临床与人群研究',
    skills: ['statistics-review', 'data-integrity', 'uncertainty-communication', 'peer-review-ethics'],
    preamble: '【临床与人群研究模式】在通用科研纪律之上追加：1. 仅使用已去标识化或获准使用的数据，不在输出中暴露可识别个人身份的信息；2. 不得做出个体层面的诊断、治疗或转诊建议，所有输出标注“研究草案——非临床用途”；3. 预设分析与探索性分析分开呈现，亚组结论须基于正式交互检验；4. 缺失数据处理透明化并做敏感性分析；5. 偏倚来源（选择、回忆、检测、immortal time）逐项讨论方向。'
  },
  dataVisualization: {
    label: '数据分析与可视化',
    skills: ['statistics-review', 'data-integrity', 'reproducibility', 'uncertainty-communication'],
    preamble: '【数据分析与可视化模式】在通用科研纪律之上追加：1. 先定义分析单位、变量口径、缺失与异常值规则，完成数据质量检查后再解释结果；2. 明确统计模型、前提检验、效应量、置信区间和多重比较处理；3. 主分析、敏感性分析与探索性分析分开呈现；4. 图表应说明单位、样本量、误差含义和分母，避免用截断坐标、颜色或聚合方式夸大差异；5. 保留可复现代码、数据版本与生成图表的参数。'
  }
}

function relatedItems(ids = []) {
  return ids.map(itemById).filter(Boolean)
}

function uniqueIds(ids = []) {
  return [...new Set(ids)].filter(id => { const item = itemById(id); return item?.type === 'skill' && item.promptFragment })
}

function formatWorkbenchTime(at) {
  try { return new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

function groupEntriesByCategory(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const category = entry.item?.type === 'database' ? databaseMetadata(entry.item).group : entry.item?.category || '未分类'
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category).push(entry)
  }
  return [...groups.entries()].map(([category, rows]) => ({ category, rows }))
}

function databaseAvailabilityLabel(value) {
  return {
    'available-in-plugin': '插件可直接查询',
    'available-in-host': '当前会话可用',
    'requires-mcp': '需要 MCP 或 Web 能力',
    'reference-only': '仅作研究参考'
  }[value] || '接入状态未知'
}

function researchPlanFor(workflow) {
  const stages = RESEARCH_PLAN_STAGES[workflow?.category]
  return stages ? { stages, deliverables: workflow.category === '论文与手稿' ? ['章节草案', '待作者确认项', '引用/图表核对清单'] : ['检索策略或分析计划', '证据与待核验项', '可编辑草案'] } : null
}

// 状态色：插件直查与宿主已确认可用都算「现在就能查」，其余为待配置的琥珀色。
function isDatabaseReady(availability) {
  return availability === 'available-in-plugin' || availability === 'available-in-host'
}

function MetaRow({ label, children }) {
  return h(React.Fragment, null, [
    h('dt', { key: 'l', style: { color: C.muted, fontWeight: 650 } }, label),
    h('dd', { key: 'v', style: { margin: 0, overflowWrap: 'anywhere' } }, children),
  ])
}

function WorkflowCategoryFilter({ categories, value, onChange }) {
  const quickCategories = WORKBENCH_DEFAULT_WORKFLOW_CATEGORIES.filter(category => categories.includes(category))
  const additionalCategories = categories.filter(category => !quickCategories.includes(category))
  const selectIsActive = value === 'all' || additionalCategories.includes(value)
  return h('div', {
    role: 'group',
    'aria-label': '工作流程分类筛选',
    style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', width: '100%' },
  }, [
    h(Select, {
      key: 'all-categories',
      value: additionalCategories.includes(value) ? value : 'all',
      onChange,
      ariaLabel: '全部工作流程分类',
      className: 'rk-workflow-category-select',
      style: {
        padding: '5px 25px 5px 10px', borderRadius: 999,
        borderColor: selectIsActive ? C.teal : `${C.teal}40`,
        background: selectIsActive ? C.teal : 'transparent',
        color: selectIsActive ? C.onInk : C.teal,
        fontSize: 12, fontWeight: 700,
      },
      options: [
        { value: 'all', label: '全部' },
        ...additionalCategories.map(category => ({ value: category, label: category })),
      ],
    }),
    ...quickCategories.map(category => {
      const color = WORKBENCH_WORKFLOW_CATEGORY_COLORS[category] || workbenchFallbackWorkflowColor
      const active = value === category
      return h('button', {
        key: category,
        type: 'button',
        onClick: () => onChange(category),
        'aria-pressed': active,
        className: 'rk-btn',
        style: {
          padding: '5px 10px', border: `1px solid ${active ? color : `${color}40`}`, borderRadius: 999,
          whiteSpace: 'nowrap', cursor: 'pointer', background: active ? color : 'transparent',
          color: active ? C.onInk : color, fontSize: 12, fontWeight: 700,
        },
      }, category)
    }),
  ])
}

export function filterWorkflowCategory(items, category = 'all') {
  return category === 'all' ? items : items.filter(item => item.category === category)
}

export function ResearchWorkbench({ sessionId, inputActions, catalogStorage, embedded = false }) {
  const storage = React.useMemo(() => catalogStorage || createCatalogStorage(), [catalogStorage])
  const selection = React.useMemo(() => createResearchSelectionStore(sessionId), [sessionId])
  const evidence = React.useMemo(() => createEvidenceStore(sessionId), [sessionId])
  const [query, setQuery] = React.useState('')
  const [type, setType] = React.useState('all')
  const [workflowCategory, setWorkflowCategory] = React.useState('all')
  const [selectedId, setSelectedId] = React.useState('review-paper')
  const [values, setValues] = React.useState({})
  // null 表示仍使用自动组装结果；空字符串则是用户明确清空了 Prompt。
  const [editedPrompt, setEditedPrompt] = React.useState(null)
  const [notice, setNotice] = React.useState('')
  const [attachedSkills, setAttachedSkills] = React.useState([])
  // 科研模式：null 关闭；值为当前研究任务预设 key。
  const [scienceMode, setScienceMode] = React.useState(null)
  const [favorites, setFavorites] = React.useState(() => storage.getFavorites())
  const [history, setHistory] = React.useState(() => storage.getHistory())
  const [sessionResourceIds, setSessionResourceIds] = React.useState(() => selection.get())
  const [planRows, setPlanRows] = React.useState(() => evidence.get().plans || [])
  const workflowCategories = [...new Set(catalog.filter(item => item.type === 'workflow').map(item => item.category))]
  const items = filterWorkflowCategory(searchCatalog({ query, type }), type === 'workflow' ? workflowCategory : 'all')
  // 详情必须属于当前筛选结果；否则“技能”筛选下会继续显示先前的工作流。
  const selected = selectedCatalogItem(items, selectedId)
  const workflow = selected?.type === 'workflow' ? selected : null
  const suggestedSkills = workflow ? relatedItems(workflow.suggestedSkillIds || []).filter(item => item.promptFragment) : []
  const sessionResources = sessionResourceIds.map(itemById).filter(Boolean)
  const sessionSkillIds = uniqueIds(sessionResources.filter(item => item.type === 'skill').map(item => item.id))
  const sessionDatabaseIds = sessionResources.filter(item => item.type === 'database').map(item => item.id)
  const activeSkillIds = uniqueIds([...attachedSkills, ...sessionSkillIds])
  const sciencePreset = scienceMode ? SCIENCE_MODE_PRESETS[scienceMode] : null
  // 科研模式下组装 Prompt 前统一前置纪律段（通用预设只有基础纪律）。
  const scienceAssemble = prompt => {
    if (!sciencePreset) return prompt
    const preamble = [SCIENCE_MODE_BASE, sciencePreset.preamble].filter(Boolean).join('\n')
    return `${preamble}\n\n${prompt}`
  }
  // 预览阶段保留必填字段的可读占位；写入和发送前才阻止缺失字段。
  const assembled = workflow ? scienceAssemble(composeWorkflow(workflow, values, { enforceRequired: false, extraSkillIds: activeSkillIds, extraDatabaseIds: sessionDatabaseIds }).prompt) : ''
  const finalPrompt = editedPrompt ?? assembled
  const hasDraftAction = typeof inputActions?.setDraft === 'function'
  const hasSubmitAction = hasDraftAction && typeof inputActions?.submit === 'function'
  const selectedKey = selected?.id || ''
  const requiredFields = workflow ? (workflow.placeholders || []).filter(field => field.required) : []
  const missingNow = requiredFields.filter(field => !String(values[field.key] || '').trim()).map(field => field.label)
  const taskPlan = researchPlanFor(workflow)
  const activePlan = workflow ? planRows.find(plan => plan.id === workflow.id) : null

  React.useEffect(() => {
    // 切换资源后清空编辑态与勾选，避免把上一个工作流的内容或技能组合带过去。
    setValues({}); setEditedPrompt(null); setNotice(''); setAttachedSkills([])
  }, [selectedKey])
  React.useEffect(() => {
    // 进入工作流时默认勾选其建议技能；用户可取消或补充。
    // 科研模式下按领域预设附加技能；关闭时回到建议集合。
    setAttachedSkills(sciencePreset ? uniqueIds(sciencePreset.skills) : suggestedSkills.map(item => item.id))
  }, [selectedKey, workflow ? workflow.id : '', scienceMode])
  React.useEffect(() => {
    // 收藏或历史在其他视图（如输入框弹窗）变更时同步刷新本视图。
    return storage.onHistoryChange?.(() => { setHistory(storage.getHistory()); setFavorites(storage.getFavorites()) }) || (() => {})
  }, [storage])
  React.useEffect(() => selection.subscribe(setSessionResourceIds), [selection])
  React.useEffect(() => evidence.subscribe(value => setPlanRows(value.plans || [])), [evidence])
  const warnManualOverride = () => {
    if (editedPrompt !== null) setNotice('提示词已手动编辑；参数或技能变更不会自动合并。请手动修改正文，或点击“恢复自动生成”。')
  }
  const update = (key, value) => {
    warnManualOverride()
    setValues(current => ({ ...current, [key]: value }))
  }
  const toggleSkill = id => {
    warnManualOverride()
    setAttachedSkills(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }
  const restoreGeneratedPrompt = () => {
    setEditedPrompt(null)
    setNotice('已恢复由当前参数和勾选技能自动生成的提示词。')
  }
  const clearForm = () => {
    setValues({}); setEditedPrompt(null); setNotice('已清空表单，恢复到模板初始状态。')
  }
  const writeTaskPlan = () => {
    if (!hasDraftAction || !workflow || !taskPlan) return
    evidence.recordPlan({ workflowId: workflow.id, name: workflow.name, stages: taskPlan.stages })
    inputActions.setDraft(`请为科研任务「${workflow.name}」生成一份可执行的研究与交付计划。阶段：${taskPlan.stages.map((stage, index) => `${index + 1}.${stage}`).join('；')}。每阶段列出输入、产出、待人工确认项与完成判据。不要声称已检索、已核验或已完成。`)
    setNotice('研究与交付计划已写入输入框；确认后可继续执行。')
  }
  const togglePlanStage = index => {
    if (!workflow || !activePlan) return
    evidence.togglePlanStage(workflow.id, index)
  }
  const toggleFavorite = id => setFavorites(storage.toggleFavorite(id))
  // 「收藏」「最近使用」是虚拟分组：按存储顺序列出条目。
  const specialRows = type === 'favorites'
    ? favorites.map(itemById).filter(Boolean)
    : type === 'history'
      ? history.map(row => ({ row, item: itemById(row.id) })).filter(entry => entry.item)
      : null
  const isSpecialView = Boolean(specialRows)
  const listEntries = isSpecialView ? specialRows : items.map(item => ({ item }))
  const listGroups = groupEntriesByCategory(listEntries)
  // 成功出口共用的收尾：记录历史（首行摘要 + 时间戳）、提示。
  const recordUse = () => {
    if (!workflow) return
    // 不把工作流参数、文件引用或最终 Prompt 的任何片段写进本地历史。
    setHistory(storage.recordHistory({ id: workflow.id, name: workflow.name }))
    evidence.recordWorkflow({ id: workflow.id, name: workflow.name, resourceIds: [...sessionResourceIds, ...attachedSkills] })
    if (taskPlan) evidence.recordPlan({ workflowId: workflow.id, name: workflow.name, stages: taskPlan.stages })
  }
  const write = () => {
    if (!workflow) return setNotice('当前资源仅供参考，请选择一个工作流程。')
    if (!hasDraftAction) return setNotice('当前 DSH 会话尚未提供输入框操作，无法写入提示词。可改用“复制 Prompt”。')
    if (!String(finalPrompt).trim()) return setNotice('提示词为空，无法写入。')
    try { composeWorkflow(workflow, values, { extraSkillIds: activeSkillIds, extraDatabaseIds: sessionDatabaseIds }); inputActions.setDraft(finalPrompt); recordUse(); setNotice('已写入当前会话输入框，可继续编辑后发送。') }
    catch (error) { setNotice(error.message) }
  }
  const send = async () => {
    if (!workflow) return setNotice('当前资源仅供参考，请选择一个工作流程。')
    if (!hasSubmitAction) return setNotice('当前 DSH 会话尚未提供发送操作，无法提交工作流。')
    if (!String(finalPrompt).trim()) return setNotice('提示词为空，无法发送。')
    try {
      composeWorkflow(workflow, values, { extraSkillIds: activeSkillIds, extraDatabaseIds: sessionDatabaseIds })
      inputActions.setDraft(finalPrompt)
      await inputActions.submit()
      recordUse()
      setNotice('已发送到当前会话。')
    } catch (error) { setNotice(error.message) }
  }
  const copyPrompt = async () => {
    if (!workflow || !String(finalPrompt).trim()) return setNotice('提示词为空，无需复制。')
    try {
      await navigator.clipboard.writeText(finalPrompt)
      recordUse()
      setNotice('已复制提示词到剪贴板；可粘贴到任意会话使用。')
    } catch (error) { setNotice(`复制失败：${error?.message || error}；可手动全选预览框文本复制。`) }
  }
  const openHistoryEntry = row => {
    const item = itemById(row.id)
    if (!item) return
    setType('all')
    setSelectedId(item.id)
  }
  const openFavoriteEntry = item => {
    setType('all')
    setSelectedId(item.id)
  }
  const typeTabs = [
    { value: 'all', label: `全部 ${catalog.length}` },
    { value: 'workflow', label: `工作流程 ${catalog.filter(item => item.type === 'workflow').length}` },
    { value: 'skill', label: `技能 ${catalog.filter(item => item.type === 'skill').length}` },
    { value: 'database', label: `数据库 ${catalog.filter(item => item.type === 'database').length}` },
    { value: 'favorites', label: `★ 收藏 ${favorites.length}` },
    { value: 'history', label: `历史 ${history.length}` },
  ]
  const content = [
    h(PageHead, {
      key: 'head',
      kicker: 'Research Kit',
      title: '资源与工作流',
      lead: '浏览技能、科学数据库与工作流程；选择后再按需写入当前会话。',
    }),
    // 二级吸顶带 = 该分区「随时要用的操作」：检索、类型筛选、科研模式。
    // 「科研模式」原先挂在分区封面右侧，会随页面一起滚走（实测滚 800px 后 top=-555），
    // 每次确认或切换预设都得先滚回顶部；它是常驻的「模式」控件，不是一次性页面动作，
    // 因此下沉到吸顶带。封面上只留读一次即可的标题与导语（分层原则见 docs/ARCHITECTURE.md §2.3）。
    h(Toolbar, { key: 'toolbar', sticky: true }, [
      // 顺序有意为「模式 → 检索 → 筛选」：三者放不下一行时按 DOM 顺序折行，
      // 把最宽的筛选项留在最后折行才能占满整行；若把「科研模式」放末尾，
      // 被挤到第二行的是它一个窄控件，会留下一整行空白（实测 1180px 窗口即触发）。
      h('label', { key: 'mode', style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 650, flexShrink: 0, color: scienceMode ? C.teal : C.muted } }, [
        h(Icon, { key: 'i', name: 'shield', size: 14 }),
        '科研模式',
        h(Select, {
          key: 's',
          value: scienceMode || '',
          onChange: next => {
            const value = next || null
            setScienceMode(value)
            setEditedPrompt(null)
            setNotice(value ? `已启用“${SCIENCE_MODE_PRESETS[value].label}”预设：自动附加对应指导技能与领域纪律段。` : '已关闭科研模式。')
          },
          ariaLabel: '选择科研模式领域预设',
          options: [{ value: '', label: '未启用' }, ...Object.entries(SCIENCE_MODE_PRESETS).map(([key, preset]) => ({ value: key, label: preset.label }))],
          className: 'rk-research-mode-select',
          style: { padding: '7px 10px', fontSize: 13, borderColor: scienceMode ? C.tealLineStrong : C.line, background: scienceMode ? C.tealTint : C.surface, color: scienceMode ? C.teal : C.ink },
        }),
      ]),
      // 检索框的 flex 基准（200px）是按「三者同占一行」倒推的：922px 内容宽下
      // 模式 176 + 检索基准 200 + 筛选 495 + 间距 20 = 891 ≤ 922，刚好不折行；
      // 基准若给到 260 就会把筛选挤到第二行（实测带高 76px → 126px）。
      // 仍是弹性项：窗口更宽时它会吃掉剩余空间，更窄时按顺序折行、筛选独占下一行。
      h('div', { key: 'search', style: { position: 'relative', flex: '1 1 200px', minWidth: 180 } }, [
        h('span', { key: 'icon', 'aria-hidden': 'true', style: { position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, display: 'flex' } }, h(Icon, { name: 'search', size: 14 })),
        h(Input, { key: 'i', value: query, onChange: setQuery, placeholder: '搜索工作流程、技能、数据库……', ariaLabel: '搜索科研资源', style: { paddingLeft: 32 } }),
      ]),
      h(Segmented, { key: 'tabs', value: type, options: typeTabs, onChange: setType, ariaLabel: '资源类型筛选' }),
      type === 'workflow' ? h(WorkflowCategoryFilter, {
        key: 'workflow-categories',
        categories: workflowCategories,
        value: workflowCategory,
        onChange: setWorkflowCategory,
      }) : null,
    ]),
    h('div', { key: 'layout', className: 'rk-layout', style: { display: 'grid', gridTemplateColumns: 'minmax(280px, .8fr) minmax(0, 1.2fr)', gap: 16, alignItems: 'start' } }, [
      h(Panel, { key: 'list', 'aria-label': '资源列表', style: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } },
        listEntries.length
          ? h('div', { key: 'groups', className: 'rk-scroll' }, listGroups.map(group => h('div', { key: group.category }, [
            h(GroupLabel, { key: 'g', count: group.rows.length }, group.category),
            ...group.rows.map(entry => {
              const item = entry.item
              const row = entry.row
              const active = item.id === selected?.id
              return h(ListRow, {
                key: item.id,
                active,
                onClick: () => type === 'history' ? openHistoryEntry(row) : type === 'favorites' ? openFavoriteEntry(item) : setSelectedId(item.id),
                trailing: h(StarButton, {
                  active: favorites.includes(item.id),
                  onClick: () => toggleFavorite(item.id),
                  label: `${favorites.includes(item.id) ? '取消收藏' : '收藏'}${item.name}`,
                }),
              }, [
                h('div', { key: 'name', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
                  h('strong', { key: 'n', style: { fontSize: 13, fontWeight: 700 } }, item.name),
                  h(Badge, { key: 't', color: C.teal }, TYPE_LABELS[item.type]),
                ]),
                h('div', { key: 'desc', style: { marginTop: 4, fontSize: 12, color: C.muted, lineHeight: 1.5 } }, type === 'history' && row.summary ? `${row.summary}（${formatWorkbenchTime(row.at)}）` : item.description),
              ])
            })
          ])))
          : h(EmptyState, {
            key: 'empty',
            icon: type === 'favorites' ? 'star' : type === 'history' ? 'history' : 'search',
            text: type === 'favorites' ? '还没有收藏的科研资源。' : type === 'history' ? '还没有使用记录。' : '没有匹配的科研资源。',
            hint: type === 'favorites' ? '点击列表右侧的星标即可收藏。' : type === 'history' ? '成功写入、发送或复制一次工作流后会出现在这里。' : '换个关键词或切换筛选条件。',
          })),
      selected ? h(Panel, { key: 'detail', 'aria-label': '资源详情' }, [
        h(PanelHead, {
          key: 'head',
          title: selected.name,
          hint: selected.description,
          actions: [h(StarButton, {
            key: 'star',
            active: favorites.includes(selected.id),
            onClick: () => toggleFavorite(selected.id),
            label: `${favorites.includes(selected.id) ? '取消收藏' : '收藏'}${selected.name}`,
          })],
        }),
        h('div', { key: 'body', style: { padding: 18, display: 'grid', gap: 16 } }, [
          workflow ? h(React.Fragment, { key: 'workflow' }, [
            h('div', { key: 'meta', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
              h(Chip, { key: 'cat', color: C.teal }, selected.category),
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
            sessionResources.length ? h(Notice, { key: 'session', tone: 'info', icon: 'layers' }, `本会话已附加资源（${sessionResources.length}）：${sessionResources.map(item => item.name).join('、')}。可在输入框的“资源”入口调整。`) : null,
            ...(workflow.placeholders || []).map(field => h(Field, {
              key: field.key,
              label: field.label,
              required: field.required,
              hint: field.hint || null,
            }, field.multiline
              ? h(Textarea, { value: values[field.key] || '', onChange: value => update(field.key, value), rows: 3, placeholder: field.hint || '', ariaLabel: field.label })
              : h(Input, { value: values[field.key] || '', onChange: value => update(field.key, value), placeholder: field.hint || '', ariaLabel: field.label }))),
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
                h('input', { key: 'box', type: 'checkbox', checked: attachedSkills.includes(skill.id), onChange: () => toggleSkill(skill.id), style: { marginTop: 3, accentColor: C.teal } }),
                h('span', { key: 'text' }, [
                  h('strong', { key: 'name', style: { fontSize: 13 } }, skill.name),
                  h('span', { key: 'hint', style: { display: 'block', marginTop: 3, fontSize: 12, color: C.muted, lineHeight: 1.5 } }, skill.description),
                ]),
              ]))),
            ]) : null,
            h(Field, { key: 'prompt', label: '提示词预览（可编辑）' },
              h(Textarea, { value: finalPrompt, onChange: setEditedPrompt, rows: 12, mono: true, ariaLabel: '提示词预览' })),
            editedPrompt !== null ? h(Notice, { key: 'edited', tone: 'warn', icon: 'edit' }, [
              '当前为手动编辑版本；字段和技能变更不会自动改写正文。',
              h(Button, { key: 'restore', variant: 'quiet', size: 'sm', icon: 'undo', onClick: restoreGeneratedPrompt, style: { marginLeft: 4 } }, '恢复自动生成'),
            ]) : null,
            missingNow.length ? h(Notice, { key: 'missing', tone: 'warn', icon: 'gauge' }, `尚未填写必填项：${missingNow.join('、')}；写入或发送前需要补齐。`) : null,
            !hasDraftAction ? h(Notice, { key: 'host', tone: 'warn', icon: 'shield' }, '当前 DSH 会话未提供输入框操作；可使用“复制 Prompt”粘贴到任意会话。') : null,
            h('div', { key: 'actions', style: { display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' } }, [
              h(Button, { key: 'write', variant: 'soft', icon: 'edit', disabled: !hasDraftAction, onClick: write }, '写入输入框'),
              h(Button, { key: 'send', variant: 'primary', icon: 'send', disabled: !hasSubmitAction, onClick: send }, '发送到当前会话'),
              h(Button, { key: 'copy', variant: 'ghost', icon: 'copy', onClick: copyPrompt }, '复制 Prompt'),
              (workflow.placeholders || []).length || editedPrompt !== null
                ? h(Button, { key: 'clear', variant: 'quiet', size: 'sm', icon: 'refresh', onClick: clearForm }, '清空表单')
                : null,
            ]),
          ]) : null,
          selected.type === 'skill' && selected.promptFragment ? h(React.Fragment, { key: 'skill' }, [
            h('p', { key: 'guidance', style: { margin: 0, lineHeight: 1.6, fontSize: 13 } }, selected.guidance),
            h(Card, { key: 'fragment', style: { padding: 14, background: C.tealTint, border: `1px solid ${C.tealLine}` } }, [
              h('strong', { key: 't', style: { display: 'block', fontSize: 13, marginBottom: 6 } }, '启动工作流时可附加的指导片段'),
              h('p', { key: 'p', style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: C.ink } }, selected.promptFragment),
            ]),
            selected.checklist?.length ? h(Card, { key: 'checklist', style: { padding: 14, background: C.surfaceAlt } }, [
              h('strong', { key: 't', style: { display: 'block', fontSize: 13, marginBottom: 6 } }, '检查清单'),
              h('ul', { key: 'l', style: { margin: 0, paddingLeft: 20, display: 'grid', gap: 6, fontSize: 13, lineHeight: 1.5 } }, selected.checklist.map((entry, index) => h('li', { key: index }, entry))),
            ]) : null,
            h(Notice, { key: 'availability', tone: 'info', icon: 'shield' }, '该技能以提示词指导方式生效：不会自动执行，只在勾选后把指导片段并入相关工作流的提示词。'),
          ]) : null,
          selected.type === 'database' ? h('div', { key: 'database', style: { display: 'grid', gap: 12 } }, [
            h('p', { key: 'note', style: { color: C.muted, margin: 0, fontSize: 13, lineHeight: 1.6 } }, selected.description),
            h(Card, { key: 'meta', style: { padding: 14, background: C.surfaceAlt } },
              h('dl', { className: 'rk-meta', style: { display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr)', gap: '10px 12px', margin: 0, fontSize: 13, lineHeight: 1.5 } }, [
                h(MetaRow, { key: 'url', label: '官方 URL' }, selected.url ? h('a', { href: selected.url, target: '_blank', rel: 'noreferrer noopener', style: { color: C.teal, fontWeight: 600 } }, selected.url) : '未提供'),
                h(MetaRow, { key: 'group', label: '研究入口' }, databaseMetadata(selected).group),
                h(MetaRow, { key: 'kind', label: '数据类型' }, databaseMetadata(selected).dataKind),
                h(MetaRow, { key: 'id', label: '标识符' }, h('span', { style: { fontFamily: C.fontMono, fontSize: 12 } }, selected.id)),
                h(MetaRow, { key: 'status', label: '当前状态' }, h('span', { style: { color: isDatabaseReady(selected.availability) ? C.statusVerified : C.amber, fontWeight: 700 } }, databaseAvailabilityLabel(selected.availability))),
                h(MetaRow, { key: 'access', label: '访问方式' }, databaseMetadata(selected).accessMode),
              ])),
            h(Notice, { key: 'usage', tone: 'warn', icon: 'database' }, [
              h('strong', { key: 'q1' }, '适合查询：'), databaseMetadata(selected).queryExample, h('br', { key: 'b1' }),
              h('strong', { key: 'q2' }, '引用/记录：'), databaseMetadata(selected).citationRule, h('br', { key: 'b2' }),
              h('strong', { key: 'q3' }, '接入提示：'), databaseMetadata(selected).toolHint,
            ]),
            h(DatabaseQueryPanel, { key: 'query-panel', database: selected, sessionId, inputActions, evidenceStore: evidence }),
          ]) : null,
          relatedItems([...(selected.suggestedSkillIds || []), ...(selected.suggestedDatabaseIds || [])]).length ? h('div', { key: 'related' }, [
            h('strong', { key: 't', style: { display: 'block', fontSize: 13, marginBottom: 6 } }, '建议能力'),
            h('ul', { key: 'l', style: { margin: 0, paddingLeft: 20, display: 'grid', gap: 5, fontSize: 13, lineHeight: 1.5 } }, relatedItems([...(selected.suggestedSkillIds || []), ...(selected.suggestedDatabaseIds || [])]).map(item => h('li', { key: item.id }, `${item.name}：${item.description}`))),
          ]) : null,
          selected.limitations?.length ? h('div', { key: 'limits', style: { display: 'grid', gap: 4 } }, selected.limitations.map((item, index) => h(Notice, { key: index, tone: 'warn', icon: 'shield' }, item))) : null,
          notice ? h(Notice, { key: 'notice', tone: 'info', icon: 'check' }, notice) : null,
        ]),
      ]) : null,
    ]),
  ]
  // embedded：由统一容器提供页面外壳与全局样式，这里只渲染分区内容；
  // 独立挂载时仍走 Page + GlobalStyle，保持组件可单测、可单独渲染。
  return embedded
    ? h('div', { key: 'embedded', className: 'rk-page', style: { boxSizing: 'border-box', padding: '20px var(--rk-gutter) 48px', background: 'transparent', color: C.ink, fontFamily: C.font } }, content)
    : h(Page, null, [h(GlobalStyle, { key: 'global-style' }), ...content])
}
