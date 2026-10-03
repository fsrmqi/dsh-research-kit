// 浏览器侧标签函数：只依赖工具数据与产物标签表。
// 单独成文件，客户端产物才能「投影后的数据 + 这两个函数」，而不必整份打进浏览器。
import { ARTIFACT_KIND_LABELS, TOOL_REGISTRY } from './tool-registry-data.js'

export const REGISTRY_BY_NAME = new Map(TOOL_REGISTRY.map(tool => [tool.name, tool]))

export function toolLabel(name) {
  return REGISTRY_BY_NAME.get(String(name || ''))?.labelZh || String(name || '')
}

export function artifactKindLabel(kind) {
  return ARTIFACT_KIND_LABELS[kind] || '运行产物'
}
