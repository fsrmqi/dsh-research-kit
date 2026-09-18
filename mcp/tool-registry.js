
// MCP 工具元数据注册表：工具名、分类、入口层级、访问级别、帮助路由、中文名、产物映射的唯一事实源。
// 纯数据模块，无 Node 专属依赖，可同时被 MCP 进程和浏览器构建产物引用。
// 新增或调整工具时先改这里；帮助路由、活动面板标签、日志产物映射、文档表格均由此派生。
//
// 字段说明：
//   category            领域词，与 docs 的 research_<领域>_<动作> 命名规范一致
//   tier                'entry' 聚合/默认入口 | 'fine' 细粒度工具（高级用法与逃生舱）
//   access              'read-only' | 'writes'（写本地状态） | 'external'（外呼学术 API）
//   requiresConfirmation 写入与审批类为 true：调用前需人工确认或显式参数
//   helpRoute           research_help 的 route id；null 表示不出现在任何推荐链
//   labelZh             UI 活动面板中文名 + 文档工具名列
//   summaryZh           文档功能描述
//   artifactKind        调用日志的产物类别；空串表示该工具不产出可投影的产物

export const ARTIFACT_KIND_LABELS = {
  figure: '图表脚本',
  'evidence-report': '证据盘点',
  'review-report': '综合审阅',
  'claim-audit': '声明审计',
  'anomaly-report': '异常报告',
  'quality-report': '质量报告',
}

export const TOOL_REGISTRY = [
  {
    name: 'research_help',
    category: 'navigation', tier: 'entry', access: 'read-only', requiresConfirmation: false,
    helpRoute: null, labelZh: 'MCP 工具导航',
    summaryZh: 'MCP 工具导航：按目标推荐工具与最短调用链，不执行任何动作',
    artifactKind: '',
  },
  {
    name: 'research_catalog_search',
    category: 'catalog', tier: 'entry', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'start', labelZh: '搜索工作流',
    summaryZh: '搜索 317 条工作流目录',
    artifactKind: '',
  },
  {
    name: 'research_workflow_compose',
    category: 'workflow', tier: 'entry', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'start', labelZh: '组装工作流',
    summaryZh: '填参数生成 Prompt',
    artifactKind: '',
  },
  {
    name: 'research_source_query',
    category: 'source', tier: 'fine', access: 'external', requiresConfirmation: false,
    helpRoute: null, labelZh: '查询数据源',
    summaryZh: '直查 Crossref / OpenAlex / Semantic Scholar 等 6 个数据源',
    artifactKind: '',
  },
  {
    name: 'research_literature_search',
    category: 'literature', tier: 'entry', access: 'external', requiresConfirmation: false,
    helpRoute: 'literature', labelZh: '综合文献检索',
    summaryZh: '默认文献检索入口：多源检索、去重、可选核验与显式证据保存',
    artifactKind: '',
  },
  {
    name: 'research_citation_verify',
    category: 'source', tier: 'fine', access: 'external', requiresConfirmation: false,
    helpRoute: null, labelZh: '验证引用',
    summaryZh: '验证 DOI / PMID / arXiv 是否存在 + claim 支持',
    artifactKind: '',
  },
  {
    name: 'research_evidence_save',
    category: 'evidence', tier: 'fine', access: 'writes', requiresConfirmation: true,
    helpRoute: 'evidence', labelZh: '保存证据',
    summaryZh: '保存证据条目（元数据，不存全文）',
    artifactKind: '',
  },
  {
    name: 'research_evidence_list',
    category: 'evidence', tier: 'fine', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'evidence', labelZh: '检索证据',
    summaryZh: '检索已保存证据',
    artifactKind: '',
  },
  {
    name: 'research_evidence_grade',
    category: 'evidence', tier: 'fine', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'evidence', labelZh: '证据分级',
    summaryZh: '实证 / 推论 / 缺失三级分级',
    artifactKind: '',
  },
  {
    name: 'research_evidence_review',
    category: 'evidence', tier: 'entry', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'evidence', labelZh: '证据盘点',
    summaryZh: '默认证据盘点入口：只读汇总、建议分级与可追溯性风险识别',
    artifactKind: 'evidence-report',
  },
  {
    name: 'research_evidence_link',
    category: 'evidence', tier: 'fine', access: 'writes', requiresConfirmation: true,
    helpRoute: null, labelZh: '关联证据',
    summaryZh: '证据与资产互链',
    artifactKind: '',
  },
  {
    name: 'research_run_start',
    category: 'run', tier: 'entry', access: 'writes', requiresConfirmation: true,
    helpRoute: 'start', labelZh: '启动研究运行',
    summaryZh: '默认启动入口：创建研究运行、状态护照与人工检查点',
    artifactKind: '',
  },
  {
    name: 'research_run_status',
    category: 'run', tier: 'entry', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'resume', labelZh: '运行状态总览',
    summaryZh: '运行总览入口：一次汇总 run 阶段、检查点、证据盘点、最近产物与推荐下一步',
    artifactKind: '',
  },
  {
    name: 'research_run_export',
    category: 'run', tier: 'fine', access: 'writes', requiresConfirmation: true,
    helpRoute: 'resume', labelZh: '导出护照',
    summaryZh: '导出跨会话状态快照',
    artifactKind: '',
  },
  {
    name: 'research_run_import',
    category: 'run', tier: 'fine', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'resume', labelZh: '导入护照',
    summaryZh: '导入状态快照恢复执行',
    artifactKind: '',
  },
  {
    name: 'research_run_checkpoint_status',
    category: 'run', tier: 'fine', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'resume', labelZh: '检查点状态',
    summaryZh: '查看管道检查点状态',
    artifactKind: '',
  },
  {
    name: 'research_run_checkpoint_approve',
    category: 'run', tier: 'fine', access: 'writes', requiresConfirmation: true,
    helpRoute: 'resume', labelZh: '审批检查点',
    summaryZh: '审批检查点继续执行',
    artifactKind: '',
  },
  {
    name: 'research_figure_generate',
    category: 'figure', tier: 'entry', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'figure', labelZh: '生成图表',
    summaryZh: '按论文风格生成 matplotlib 脚本',
    artifactKind: 'figure',
  },
  {
    name: 'research_figure_list_styles',
    category: 'figure', tier: 'fine', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'figure', labelZh: '图表风格列表',
    summaryZh: '列出 8 个可用图表风格',
    artifactKind: '',
  },
  {
    name: 'research_review_output',
    category: 'review', tier: 'entry', access: 'external', requiresConfirmation: false,
    helpRoute: 'review', labelZh: '综合审阅输出',
    summaryZh: '默认审阅入口：聚合声明引用、异常、写作与限制语检查',
    artifactKind: 'review-report',
  },
  {
    name: 'research_review_claims',
    category: 'review', tier: 'fine', access: 'external', requiresConfirmation: false,
    helpRoute: 'review', labelZh: '声明引用审计',
    summaryZh: '文本级 claim-source 对齐审计',
    artifactKind: 'claim-audit',
  },
  {
    name: 'research_review_anomalies',
    category: 'review', tier: 'fine', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'review', labelZh: '文本异常检测',
    summaryZh: '检测冗余模式、矛盾表述与缺失要素',
    artifactKind: 'anomaly-report',
  },
  {
    name: 'research_review_writing',
    category: 'review', tier: 'fine', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'review', labelZh: '写作质量检查',
    summaryZh: '学术写作质量检查（模糊术语、废话开头、标点、句长）',
    artifactKind: 'quality-report',
  },
  {
    name: 'research_review_hedging',
    category: 'review', tier: 'fine', access: 'read-only', requiresConfirmation: false,
    helpRoute: null, labelZh: '限制语检查',
    summaryZh: '检测保护性模糊限制语（不可静默删除）',
    artifactKind: '',
  },
  {
    name: 'research_literature_link',
    category: 'literature', tier: 'fine', access: 'external', requiresConfirmation: false,
    helpRoute: null, labelZh: '文献互引分析',
    summaryZh: '发现证据间互引关系',
    artifactKind: '',
  },
  {
    name: 'research_disclosure_generate',
    category: 'disclosure', tier: 'entry', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'disclosure', labelZh: '生成 AI 披露',
    summaryZh: '按期刊 AI 政策生成合规的 AI 使用披露声明（支持 15 个期刊）',
    artifactKind: '',
  },
  {
    name: 'research_disclosure_list_policies',
    category: 'disclosure', tier: 'fine', access: 'read-only', requiresConfirmation: false,
    helpRoute: 'disclosure', labelZh: '披露政策列表',
    summaryZh: '列出支持的期刊 AI 披露政策',
    artifactKind: '',
  },
  {
    name: 'research_metadata_openalex_fetch',
    category: 'metadata', tier: 'fine', access: 'external', requiresConfirmation: false,
    helpRoute: null, labelZh: '获取 OpenAlex 元数据',
    summaryZh: '通过 DOI 或检索词获取 OpenAlex 完整元数据',
    artifactKind: '',
  },
]

const REGISTRY_BY_NAME = new Map(TOOL_REGISTRY.map(tool => [tool.name, tool]))

function toolMeta(name) {
  return REGISTRY_BY_NAME.get(String(name || '')) || null
}

function toolLabel(name) {
  return REGISTRY_BY_NAME.get(String(name || ''))?.labelZh || String(name || '')
}

function artifactKindOf(toolName) {
  return REGISTRY_BY_NAME.get(String(toolName || ''))?.artifactKind || ''
}

function artifactKindLabel(kind) {
  return ARTIFACT_KIND_LABELS[kind] || '运行产物'
}

function entryTools() {
  return TOOL_REGISTRY.filter(tool => tool.tier === 'entry').map(tool => tool.name)
}

const toolCount = TOOL_REGISTRY.length

export { toolMeta, toolLabel, artifactKindOf, artifactKindLabel, entryTools, toolCount }
