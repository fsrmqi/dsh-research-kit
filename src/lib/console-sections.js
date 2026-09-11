// 统一容器「科研工作台」的分区契约（纯数据 + 纯函数，不依赖 React，供容器与测试共用）。
//
// 三个并列的 conversation.view 标签合并为一个容器视图后，内部分区按科研闭环排序
// （「研究证据图谱」是本仓库在合并之后新增的第四分区）：
// 发现（找得到）→ 构造（想得清）→ 沉淀（存得住）→ 证据（说得清）。
//
// 每个分区都必须显式声明五件事，避免合并后出现功能重叠或遗漏：
//   label       分区显示名（二级导航文案）
//   position    在科研闭环中的定位（一句话）
//   purpose     核心用途：这个分区负责产出什么
//   boundary    职责边界：明确不做什么、以及不会去碰别人的哪些数据
//   ownership   该分区独占的数据归属，用于约束「互不写对方存储」
export const RESEARCH_CONSOLE_SECTIONS = [
  {
    id: 'catalog',
    label: '资源与工作流',
    position: '发现层 · 找到可用资源并组装成可执行提示词',
    purpose: '检索工作流程、技能与数据源；按参数、附加技能与本会话资源组装提示词；对公开数据源发起宿主受控直查。',
    boundary: '不生产新知识、不沉淀资产；工作流的执行交给当前会话完成；不直接出网，数据源查询一律经宿主路由。',
    ownership: '目录收藏与使用历史（catalog-storage）',
  },
  {
    id: 'methods',
    label: '方法工坊',
    position: '构造层 · 用命名思维方法把零散输入结构化为提示词',
    purpose: '方法卡库的分类检索与收藏；以「问题 / 事实 / 约束 / 方案」填充变量并生成可编辑提示词；从当前对话提取草稿并写回输入框。',
    boundary: '不管理研究灵感资产正文、不检索项目记忆或最近会话、不替工作流决定领域参数与技能组合；方法只提供提示词框架，不自动执行任何工具。',
    ownership: '方法卡与工坊资产（PromptKit method / asset provider，独立 storagePrefix）',
  },
  {
    id: 'vault',
    label: '研究资产库',
    position: '沉淀层 · 把产出与结论存成可追溯、可验证的资产',
    purpose: '两个子模块并列：①「灵感资产」的增删改查、派生版本与版本对比、验证状态跟进（待验证 / 已证实 / 已被推翻）、收藏、JSON 导出与增量恢复；②「证据库」逐条保存公开来源的元数据与用户笔记，按项目隔离与去重，支持导出、导入与彻底删除。',
    boundary: '不生成提示词，只向生成环节提供素材；原始数据、患者信息与完整查询结果不入库；证据条目必须由用户逐条确认，不自动入库、不静默注入提示词；单条灵感资产正文上限 8000 字符。',
    ownership: '灵感资产（PromptKit asset provider 命名空间）；证据条目（IndexedDB dsh-research-kit-evidence）',
  },
  {
    id: 'evidence',
    label: '研究证据图谱',
    position: '证据层 · 汇总来源、工作流、资产与查询任务的可追溯关系',
    purpose: '可视化本会话已选资源、已启动工作流、插件直查来源、Agent 查询任务与研究灵感资产之间的关系。',
    boundary: '不执行查询、不生成结论、不保存原始文件、检索词或完整查询正文；只呈现已有稳定标识符和来源链接。',
    ownership: '本会话证据索引（evidence-store，公开来源元数据与关系）',
  },
]

// 默认分区：合并前用户最常用的入口，保证合并后落点不陌生。
export const DEFAULT_CONSOLE_SECTION = 'catalog'

// 深链/持久化读回的取值容错：未知值一律回落到默认分区，不抛错。
export function normalizeConsoleSection(value, sections = RESEARCH_CONSOLE_SECTIONS) {
  return sections.some(section => section.id === value) ? value : DEFAULT_CONSOLE_SECTION
}

export function findConsoleSection(id, sections = RESEARCH_CONSOLE_SECTIONS) {
  return sections.find(section => section.id === id) || sections[0]
}
