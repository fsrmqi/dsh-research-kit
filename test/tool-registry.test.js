
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOL_REGISTRY, toolMeta, toolLabel, artifactKindOf, artifactKindLabel, entryTools, toolCount } from '../mcp/tool-registry.js'
import { tools, DISCOVERY_ROUTES } from '../mcp/tools/index.js'
import { logCall, readCallLogs } from '../mcp/execution/call-logger.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('工具注册表：名称与 tools 数组 1:1 对齐（31 个，不多不少）', () => {
  assert.equal(tools.length, 31, 'mcp/tools/index.js 应有 31 个工具')
  assert.equal(toolCount, 31, '注册表应有 31 条元数据')
  const defined = tools.map(tool => tool.name).sort()
  const registered = TOOL_REGISTRY.map(tool => tool.name).sort()
  assert.deepEqual(registered, defined, '注册表与工具定义的名称集合应完全一致')
})

test('工具注册表：元数据字段完整且取值合法', () => {
  const CATEGORIES = ['navigation', 'catalog', 'workflow', 'source', 'metadata', 'evidence', 'run', 'review', 'figure', 'disclosure', 'literature']
  const ACCESS = ['read-only', 'writes', 'external']
  const ROUTE_IDS = new Set(DISCOVERY_ROUTES.map(route => route.id))
  for (const tool of TOOL_REGISTRY) {
    assert.ok(CATEGORIES.includes(tool.category), `${tool.name} category 非法`)
    assert.ok(['entry', 'fine'].includes(tool.tier), `${tool.name} tier 非法`)
    assert.ok(ACCESS.includes(tool.access), `${tool.name} access 非法`)
    assert.equal(typeof tool.requiresConfirmation, 'boolean', `${tool.name} requiresConfirmation 应为布尔`)
    if (tool.helpRoute) assert.ok(ROUTE_IDS.has(tool.helpRoute), `${tool.name} helpRoute 指向不存在的路由`)
    assert.ok(tool.labelZh, `${tool.name} 缺少中文名`)
    assert.ok(tool.summaryZh, `${tool.name} 缺少中文描述`)
    assert.equal(typeof tool.artifactKind, 'string', `${tool.name} artifactKind 应为字符串`)
  }
})

test('帮助路由：推荐链引用的工具都存在，且 helpRoute 路由包含该工具', () => {
  const names = new Set(TOOL_REGISTRY.map(tool => tool.name))
  const routesById = new Map(DISCOVERY_ROUTES.map(route => [route.id, route]))
  for (const route of DISCOVERY_ROUTES) {
    for (const [toolName] of route.chain) {
      assert.ok(names.has(toolName), `路由 ${route.id} 推荐了未注册的工具 ${toolName}`)
      const meta = toolMeta(toolName)
      assert.ok(meta.helpRoute && routesById.has(meta.helpRoute), `${toolName} 的 helpRoute 指向不存在的路由`)
    }
  }
  for (const tool of TOOL_REGISTRY) {
    if (tool.helpRoute) {
      const inChain = routesById.get(tool.helpRoute).chain.some(([toolName]) => toolName === tool.name)
      assert.ok(inChain, `${tool.name} 的 helpRoute ${tool.helpRoute} 的推荐链未包含该工具`)
    }
  }
})

test('产物映射：call-logger 与注册表一致（无本地第二份表）', async () => {
  const source = readFileSync(path.join(root, 'mcp/execution/call-logger.js'), 'utf8')
  assert.ok(!source.includes('ARTIFACT_KINDS'), 'call-logger 不应再维护本地 ARTIFACT_KINDS 表')
  assert.ok(source.includes("from '../tool-registry.js'"), 'call-logger 应从注册表取产物映射')
  assert.equal(artifactKindOf('research_review_output'), 'review-report')
  assert.equal(artifactKindOf('research_help'), '')
})

test('UI 标签：agent-activity 从注册表取中文名（无本地副本）', () => {
  const source = readFileSync(path.join(root, 'src/agent-activity.js'), 'utf8')
  assert.ok(!source.includes('TOOL_LABELS'), 'agent-activity 不应再维护本地 TOOL_LABELS')
  assert.ok(!source.includes('ARTIFACT_LABELS'), 'agent-activity 不应再维护本地 ARTIFACT_LABELS')
  assert.ok(source.includes("from '../mcp/tool-registry.js'"), 'agent-activity 应从注册表取标签')
  assert.equal(toolLabel('research_run_status'), '运行状态总览')
})

test('注册表 helper：toolMeta 未知名返回 null，artifactKindLabel 未知名回退', () => {
  assert.equal(toolMeta('research_not_exist'), null)
  assert.equal(toolLabel('research_not_exist'), 'research_not_exist')
  assert.equal(artifactKindLabel('unknown-kind'), '运行产物')
  assert.equal(artifactKindLabel('figure'), '图表脚本')
  assert.ok(entryTools().includes('research_run_status'), 'run_status 应为聚合入口')
  assert.ok(!entryTools().includes('research_review_hedging'), '限制语检查是细粒度工具')
})

test('写入类工具都要求确认，只读入口都不写', () => {
  for (const tool of TOOL_REGISTRY) {
    if (tool.access === 'writes') {
      assert.ok(tool.requiresConfirmation, `${tool.name} 写入状态但未要求确认`)
    }
    if (tool.name === 'research_run_status') {
      assert.equal(tool.access, 'read-only', 'run_status 必须只读')
      assert.equal(tool.requiresConfirmation, false)
    }
  }
})

test('日志层：readCallLogs 支持 runId 过滤', async () => {
  await logCall({ tool: 'research_run_start', params: { run_id: 'status-filter-test' }, result: { data: { run_id: 'status-filter-test' } }, duration_ms: 1 })
  await logCall({ tool: 'research_help', params: {}, result: { data: {} }, duration_ms: 1 })
  const filtered = await readCallLogs({ limit: 10, runId: 'status-filter-test' })
  assert.ok(filtered.length >= 1, 'runId 过滤应能取到该 run 的调用')
  assert.ok(filtered.every(record => record.run_id === 'status-filter-test'), '过滤结果不应混入其他 run')
})
