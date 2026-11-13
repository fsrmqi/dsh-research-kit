// 保守识别「明显是测试 / 演示 / 探针」的课题名。
//
// 为什么需要：测试与演示曾经直接写进真实数据目录（本机 2026-09-18 留下
// mcp-test、dedup-probe、list-order-* 等），它们会以「已保存证据」出现在证据图谱里。
// 清理动作只接受显式确认，并且只匹配下面这些结构——真实课题名（例如大麦候选基因）
// 不会命中。default 只有在全部条目都像调试/测试内容时才纳入，避免把「未命名项目」
// 里真实保存、只是忘了填项目的证据误删。
const TEST_ENTRY_PATTERN = /(?:test|debug|smoke|probe|demo|sample|fixture|测试|演示|示例)/i
const TEST_PROJECT_PATTERNS = [
  /^test[-_]/i,
  /^test$/i,
  /[-_]test$/i,
  /^demo[-_]/i,
  /^dedup[-_]/i,
  /^list[-_]order[-_]?/i,
  /^concurrency[-_]test[-_]?/i,
  /^codex[-_]live[-_]check$/i,
]

export function isTestProjectName(name) {
  const value = String(name || '').trim()
  if (!value) return false
  return TEST_PROJECT_PATTERNS.some(pattern => pattern.test(value))
}

/** 从证据条目里汇总测试课题与条数（按项目名排序，结果稳定）。 */
export function selectTestProjects(entries = []) {
  const counts = new Map()
  const defaultEntries = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const project = String(entry?.project || '').trim()
    if (project === 'default') { defaultEntries.push(entry); continue }
    if (!project || !isTestProjectName(project)) continue
    counts.set(project, (counts.get(project) || 0) + 1)
  }
  // default 是「没填项目」的兜底桶，不能按名字判断；只有整桶条目都像调试/测试时才纳入。
  if (defaultEntries.length && defaultEntries.every(entry => TEST_ENTRY_PATTERN.test(`${entry?.title || ''} ${entry?.note || ''}`))) {
    counts.set('default', defaultEntries.length)
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
    .map(([project, count]) => ({ project, count }))
}
