import { z } from 'zod/v3'
import { contract } from '../execution/contract.js'

export const DISCOVERY_ROUTES = [
  { id: 'start', label: '启动研究运行', keywords: ['启动', '开始', '项目', '运行', 'run'], chain: [['research_catalog_search', '按研究目标查找工作流。'], ['research_workflow_compose', '补齐工作流参数并生成可执行 Prompt。'], ['research_run_start', '创建可追溯 run、状态护照和人工检查点。']] },
  { id: 'literature', label: '发现与检索文献', keywords: ['文献', '检索', '论文', 'doi', '引用', '来源', '保存'], chain: [['research_literature_search', '默认多源检索、去重；核验和保存均须显式开启。'], ['research_evidence_save_batch', '人工挑选候选后批量显式保存。'], ['research_evidence_review', '盘点已保存证据的可追溯性与建议分级。']] },
  { id: 'evidence', label: '管理和盘点证据', keywords: ['证据', '分级', '证据库', '追溯'], chain: [['research_evidence_review', '只读盘点证据缺口和未核验项。'], ['research_evidence_list', '检索已保存的证据条目。'], ['research_evidence_save', '仅在确认需要时保存单条来源元数据。'], ['research_evidence_grade', '针对单条证据作细粒度建议分级。'], ['research_evidence_assess', '人工记录来源核验、研究类型、声明支持程度与证据强度。'], ['research_evidence_grade_apply', '预览→确认两段式写回来源可追溯性；绝不自动应用证据强度。']] },
  { id: 'review', label: '审阅研究草稿', keywords: ['审阅', '润色', '写作', '草稿', 'claim', '声明'], chain: [['research_review_output', '默认聚合引用声明、异常、写作和限制语检查。'], ['research_review_claims', '只深挖引用声明对齐时使用。'], ['research_review_anomalies', '只深挖冗余、矛盾与缺失要素时使用。'], ['research_review_writing', '只深挖写作质量问题时使用。']] },
  { id: 'figure', label: '生成论文图表', keywords: ['图表', '作图', '绘图', '可视化', 'figure'], chain: [['research_figure_list_styles', '先查看可用的论文图表风格。'], ['research_figure_generate', '生成可执行的 matplotlib 脚本。']] },
  { id: 'disclosure', label: '处理 AI 使用披露', keywords: ['披露', '合规', '期刊', '会议', 'ai 使用'], chain: [['research_disclosure_list_policies', '确认目标期刊或会议的披露规则。'], ['research_disclosure_generate', '按具体政策生成披露声明草案。']] },
  { id: 'resume', label: '恢复或推进研究运行', keywords: ['恢复', '继续', '检查点', 'checkpoint', '护照', '状态'], chain: [['research_run_status', '先看运行总览：阶段、检查点、证据盘点与推荐下一步。'], ['research_run_import', '从已有 Material Passport 恢复上下文。'], ['research_run_checkpoint_status', '读取当前待审批的人工闸门。'], ['research_run_checkpoint_approve', '仅在人工确认后放行指定阶段。'], ['research_run_export', '交接前导出可追溯的状态快照。']] },
]

function discoverRoute(goal, routeId) {
  if (routeId && routeId !== 'auto') return DISCOVERY_ROUTES.find(route => route.id === routeId) || null
  const text = String(goal || '').toLowerCase()
  return DISCOVERY_ROUTES.find(route => route.keywords.some(keyword => text.includes(keyword))) || null
}

export const discoveryTools = [{
  name: 'research_help',
  description: 'Discover the right Research Kit MCP tools for a goal. Returns a short recommended call chain and explains when to use lower-level tools. This tool is read-only and performs no research action.',
  inputSchema: {
    goal: z.string().max(500).optional().describe('Plain-language research goal, for example “帮我找文献” or “审阅这篇草稿”'),
    route: z.enum(['auto', 'start', 'literature', 'evidence', 'review', 'figure', 'disclosure', 'resume']).optional().default('auto').describe('Optional explicit task route; auto infers it from goal.'),
    include_all_routes: z.boolean().optional().default(false).describe('Include the complete route directory instead of only the best match.'),
  },
  async execute({ goal, route, include_all_routes }) {
    const selected = discoverRoute(goal, route)
    const serialize = item => ({ id: item.id, label: item.label, recommended_chain: item.chain.map(([tool, reason], index) => ({ step: index + 1, tool, reason })) })
    return contract({
      ...(selected ? { recommended: serialize(selected) } : {}),
      ...(selected ? {} : { guidance: '请描述目标，或在 route 中指定任务类别；也可先从“启动研究运行”开始。' }),
      ...(include_all_routes ? { routes: DISCOVERY_ROUTES.map(serialize) } : {}),
      available_routes: DISCOVERY_ROUTES.map(item => ({ id: item.id, label: item.label })),
    }, {
      source: 'research-tool-discovery', confidence: 'verified', disclaimer: '此工具只推荐调用路径；不会代表你执行检索、写入、审批或外部请求。',
      summary: { route: selected?.id || null, routes_available: DISCOVERY_ROUTES.length },
      next_actions: selected ? selected.chain.map(([tool, reason]) => `${tool}：${reason}`) : ['补充目标描述后重试，或从 include_all_routes=true 查看完整路由目录。'],
    })
  },
}]
