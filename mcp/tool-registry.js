// MCP 工具元数据门面：数据在 ./tool-registry-data.js，浏览器侧标签函数在 ./tool-labels.js。
// 服务端（mcp/server.js、mcp/execution/call-logger.js）、脚本门禁与文档派生都从这里取，公开面保持不变。
// 客户端产物不走这里——它由 mcp/tool-registry-projection.js 投影生成。
import { ARTIFACT_KIND_LABELS, TOOL_REGISTRY } from './tool-registry-data.js'
import { REGISTRY_BY_NAME, toolLabel, artifactKindLabel } from './tool-labels.js'

function toolMeta(name) {
  return REGISTRY_BY_NAME.get(String(name || '')) || null
}

function toolAnnotations(name) {
  const meta = toolMeta(name)
  if (!meta) return undefined
  return {
    title: meta.labelZh,
    readOnlyHint: meta.access === 'read-only',
    destructiveHint: false,
    idempotentHint: meta.access === 'read-only',
    openWorldHint: meta.access === 'external',
  }
}

function artifactKindOf(toolName) {
  return REGISTRY_BY_NAME.get(String(toolName || ''))?.artifactKind || ''
}

function entryTools() {
  return TOOL_REGISTRY.filter(tool => tool.tier === 'entry').map(tool => tool.name)
}

const toolCount = TOOL_REGISTRY.length

export { TOOL_REGISTRY, ARTIFACT_KIND_LABELS, toolMeta, toolAnnotations, toolLabel, artifactKindOf, artifactKindLabel, entryTools, toolCount }
