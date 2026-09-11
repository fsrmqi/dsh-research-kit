import workflows from '../catalog/workflows.json' with { type: 'json' }
import skills from '../catalog/skills.json' with { type: 'json' }
import databases from '../catalog/databases.json' with { type: 'json' }
import databaseMetadataConfig from '../catalog/database-metadata.json' with { type: 'json' }

// 数据库的研究用途、访问方式与引用规范。原始目录仍保留上游类别；这里提供面向
// 研究者的六个入口组，避免把遗传、临床、化学等都笼统归入“数据分析”。
const DATABASE_GROUPS = databaseMetadataConfig.groups
const RESTRICTED_DATABASE_ACCESS = new Map(Object.entries(databaseMetadataConfig.accessOverrides))

const WORKFLOW_RECOMMENDATIONS = {
  '文献与引文': ['literature-search', 'literature-review', 'citation-analysis'],
  '临床与公共卫生': ['patient-cohort-study', 'case-control-analysis', 'risk-prediction-model'],
  '基因组与遗传变异': ['variant-annotation', 'variant-calling', 'gwas-analysis'],
  '组学与表达数据': ['rnaseq-deseq2', 'single-cell-rnaseq', 'gene-expression-atlas'],
  '蛋白质、结构与通路': ['gene-set-enrichment', 'gene-regulatory-network', 'methods-comparison'],
  '化学、药物与毒理': ['data-source-selection', 'research-plan', 'methods-comparison'],
  '天文与空间科学': ['data-source-selection', 'research-landscape', 'explore-data'],
  '生物多样性与生态': ['find-datasets', 'research-plan', 'explore-data'],
  '气候、地球与环境': ['find-datasets', 'explore-data', 'statistical-analysis'],
  '地理空间与社会数据': ['data-source-selection', 'find-datasets', 'explore-data']
}

export function databaseMetadata(databaseOrId) {
  const id = typeof databaseOrId === 'string' ? databaseOrId : databaseOrId?.id
  const record = DATABASE_GROUPS.find(group => group.ids.includes(id))
  const database = typeof databaseOrId === 'object' ? databaseOrId : databases.find(item => item.id === id)
  return {
    group: record?.group || '其他研究数据源',
    dataKind: record?.dataKind || '研究数据与元数据',
    queryExample: record?.queryExample || '按研究问题和稳定标识符查询，并记录检索范围。',
    citationRule: record?.citationRule || '记录数据库名称、稳定标识符、版本和访问日期。',
    accessMode: RESTRICTED_DATABASE_ACCESS.get(id) || '公开网页或 API；当前会话仍需 Web 或 MCP 能力',
    toolHint: database?.availability === 'available-in-plugin'
      ? '本插件已内置该来源的直查适配器，可直接查询；候选结果仍应回到原文逐条核验。'
      : database?.availability === 'available-in-host'
        ? '当前宿主已声明可用；仍应在结果中说明来源。'
        : '在 DSH 当前会话通过 Web 或已连接 MCP 查询；未接通时只能作为检索建议。'
  }
}

/** 根据本会话勾选的数据库给出可启动的工作流，不代表自动执行或结果推荐。 */
export function recommendedWorkflowsForResources(resourceIds = []) {
  const workflowIds = new Set()
  for (const id of resourceIds) {
    const item = databases.find(database => database.id === id)
    if (!item) continue
    for (const workflowId of WORKFLOW_RECOMMENDATIONS[databaseMetadata(item).group] || []) workflowIds.add(workflowId)
  }
  return [...workflowIds].map(id => workflows.find(workflow => workflow.id === id)).filter(Boolean)
}

function enrichItem(item) {
  return item.type === 'database' ? { ...item, databaseMeta: databaseMetadata(item) } : item
}

export const catalog = Object.freeze([...workflows, ...skills, ...databases].map(enrichItem))

export function searchCatalog({ query = '', type = 'all' } = {}) {
  const normalized = String(query).trim().toLowerCase()
  return catalog.filter(item => {
    if (type !== 'all' && item.type !== type) return false
    if (!normalized) return true
    // 搜索覆盖名称、描述、分类、标签与正文（prompt/guidance/promptFragment），与 README 3.1 的范围一致。
    return [item.name, item.description, item.category, ...(item.tags || []), item.prompt, item.guidance, item.promptFragment, item.databaseMeta?.group, item.databaseMeta?.dataKind, item.databaseMeta?.queryExample]
      .filter(part => typeof part === 'string')
      .join(' ')
      .toLowerCase()
      .includes(normalized)
  })
}

export function itemById(id) {
  return catalog.find(item => item.id === id) || null
}

/** 从当前筛选结果中恢复选中项，绝不返回已被筛掉的历史选择。 */
export function selectedCatalogItem(items, selectedId) {
  return items.find(item => item.id === selectedId) || items[0] || null
}

export function composeWorkflow(workflow, values = {}, { enforceRequired = true, extraSkillIds = [], extraDatabaseIds = [] } = {}) {
  if (!workflow || workflow.type !== 'workflow') throw new Error('请选择一个工作流程。')
  const missing = (workflow.placeholders || [])
    .filter(field => field.required && !String(values[field.key] || '').trim())
    .map(field => field.label)
  if (enforceRequired && missing.length) throw new Error(`请填写：${missing.join('、')}`)
  const prompt = workflow.prompt.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, key) => {
    const value = String(values[key] || '').trim()
    const field = workflow.placeholders?.find(item => item.key === key)
    return value || (field?.required ? `[${field.label}]` : '未指定（请按综合方式处理）')
  })
  // 附加技能是可选的指导模块：勾选后把该技能的纪律片段追加到 Prompt 末尾。
  const attached = (extraSkillIds || [])
    .map(itemById)
    .filter(skill => skill?.type === 'skill' && skill.promptFragment)
  const attachedDatabases = (extraDatabaseIds || [])
    .map(itemById)
    .filter(database => database?.type === 'database')
  const additions = [
    attached.length ? `附加技能指导：\n${attached.map(skill => `- 【${skill.name}】${skill.promptFragment}`).join('\n')}` : '',
    attachedDatabases.length ? `研究资源提示：\n${attachedDatabases.map(database => `- 【${database.name}】${database.accessNote}；未确认当前会话具备访问能力前，不得声称已检索。`).join('\n')}` : ''
  ].filter(Boolean)
  const finalPrompt = additions.length ? `${prompt}\n\n${additions.join('\n\n')}` : prompt
  return {
    prompt: finalPrompt,
    missing,
    attachedSkillIds: attached.map(skill => skill.id),
    attachedDatabaseIds: attachedDatabases.map(database => database.id)
  }
}
