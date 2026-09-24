// 旧任务型项目归类只产生建议；应用前必须把映射和影响数量交给用户预览。
// 不根据项目名删除数据，也不把测试数据冒充为已核验科研证据。
const TEST_PROJECT = /^(?:concurrency-test(?:[-_].*)?|dedup-probe(?:[-_].*)?|list-order(?:[-_].*)?)$/i
const DEMO_PROJECT = /^demo-crispr(?:[-_].*)?$/i
const BARLEY_PROJECT = /^barley-NP1-IPE1-family$/i

export const ARCHIVED_TEST_WORKSPACE = '测试与演示（归档）'

export function classifyLegacyProject(name, evidenceEntries = []) {
  const project = String(name || '').trim()
  if (TEST_PROJECT.test(project)) return {
    from: project, to: ARCHIVED_TEST_WORKSPACE, category: 'test', confidence: 'high',
    reason: '命中测试／并发／去重探针命名规则；只归档，不删除来源。',
  }
  if (DEMO_PROJECT.test(project)) return {
    from: project, to: ARCHIVED_TEST_WORKSPACE, category: 'demo', confidence: 'high',
    reason: '命中演示项目命名规则；只归档，不删除来源。',
  }
  if (BARLEY_PROJECT.test(project)) {
    const related = evidenceEntries.filter(item => item.project === project)
    const consistent = !related.length || related.every(item =>
      /大麦|barley|NP1|IPE1|雄性不育|male.steril/i.test(`${item.title || ''} ${item.reason || ''} ${item.note || ''}`))
    return {
      from: project, to: '大麦雄性不育', category: 'research', confidence: consistent && related.length ? 'high' : 'review',
      reason: consistent && related.length ? '条目内容与大麦／NP1／IPE1 主题一致。' : '项目名指向科研任务，但来源内容不足或不一致，需在预览中确认目标课题。',
    }
  }
  return null
}

export function buildProjectOrganizationPlan({ evidence = [], assets = [], nodes = [], claims = [], researchClaims = [], links = [], runs = [] } = {}) {
  const collections = { evidence, assets, nodes, claims, researchClaims, links, runs }
  const names = new Set(Object.values(collections).flatMap(rows => rows.map(item => item.project).filter(Boolean)))
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN')).map(name => {
    const suggestion = classifyLegacyProject(name, evidence)
    if (!suggestion) return null
    const counts = Object.fromEntries(Object.entries(collections).map(([kind, rows]) =>
      [kind, rows.filter(item => item.project === name).length]))
    return { ...suggestion, counts, selected: suggestion.confidence === 'high' }
  }).filter(Boolean)
}
