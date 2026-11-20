// 客户端工具注册表投影：浏览器产物只带渲染真正用得到的字段。
//
// 完整注册表（mcp/tool-registry-data.js）是服务端与文档派生的真值源，字段里有
// example / helpRoute / tier / artifactKind / category 等只有服务端才消费的内容。
// 原先整份打进 ui/client.js，占预算却对浏览器无用；这里改成构建期投影：
//   scripts/build-client.mjs → clientToolRegistrySource() → 产物里的 TOOL_REGISTRY
// 消费方只有两个（src/research-toolview.js 按 name 建索引、渲染 labelZh/summaryZh/
// access/requiresConfirmation），test/tool-registry-projection.test.js 守护这条边界。

import { ARTIFACT_KIND_LABELS, TOOL_REGISTRY } from './tool-registry-data.js'

// 浏览器读的字段：新增客户端字段时先加到这里，否则投影会把它裁掉（测试会拦住）。
export const CLIENT_TOOL_FIELDS = ['name', 'labelZh', 'summaryZh', 'access', 'requiresConfirmation']

// 只有服务端/文档需要、且明确不进浏览器的字段——测试用它反查消费方是否越界。
export const SERVER_ONLY_FIELDS = ['example', 'helpRoute', 'tier', 'artifactKind', 'category']

export function projectToolRegistry(registry = TOOL_REGISTRY) {
  return registry.map(tool => Object.fromEntries(CLIENT_TOOL_FIELDS.map(field => [field, tool[field]])))
}

// 产出可直接拼进产物的一段源码：只保留数据符号（const），标签函数走 mcp/tool-labels.js 原文。
export function clientToolRegistrySource(registry = TOOL_REGISTRY) {
  const tools = projectToolRegistry(registry)
  const missing = tools.filter(tool => !tool.name || !tool.labelZh || !tool.summaryZh).map(tool => tool.name || '(未命名)')
  if (missing.length) throw new Error(`客户端工具投影缺少必要字段（name/labelZh/summaryZh）：${missing.join('、')}`)
  const rows = tools.map(tool => `  { name: ${JSON.stringify(tool.name)}, labelZh: ${JSON.stringify(tool.labelZh)}, `
    + `summaryZh: ${JSON.stringify(tool.summaryZh)}, access: ${JSON.stringify(tool.access)}, `
    + `requiresConfirmation: ${Boolean(tool.requiresConfirmation)} },`)
  return [
    '// 由 scripts/build-client.mjs 生成（mcp/tool-registry-projection.js）：浏览器只带渲染用得到的字段。',
    `const ARTIFACT_KIND_LABELS = ${JSON.stringify(ARTIFACT_KIND_LABELS)}`,
    `const TOOL_REGISTRY = [`,
    ...rows,
    ']',
    '',
  ].join('\n')
}
