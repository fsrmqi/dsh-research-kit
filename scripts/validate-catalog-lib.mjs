#!/usr/bin/env node
// 目录契约校验：任何违反 ARCHITECTURE.md 第 4 章数据契约的条目都会被报告。
// 校验逻辑抽为 validateCatalogItems() 供 CLI 与测试共用；本文件只含纯逻辑。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function validateCatalogItems(all, { directQueryIds } = {}) {
  const errors = []
  const fail = (id, message) => errors.push(`[${id}] ${message}`)
  const BASE_FIELDS = ['id', 'type', 'name', 'description', 'category']
  const PLACEHOLDER_KEY = /^[a-zA-Z0-9_-]+$/
  const ID_FORMAT = /^[a-z0-9-]+$/
  const GUARD = /核验|不得编造|不编造|待核验|待补充|需作者确认|需人工|待确认|需补充|不得虚构|禁止虚构|never fabricate|do not fabricate|human verification|\[verify\]/i
  const AVAILABILITY = {
    skill: new Set(['prompt-guidance', 'requires-host-capability']),
    // available-in-plugin：插件内置直查适配器，无需宿主 MCP；
    // available-in-host：宿主声明可用（须先实现真实能力探测，见 ROADMAP §6）。
    database: new Set(['reference-only', 'requires-mcp', 'available-in-plugin', 'available-in-host'])
  }
  const ids = new Set()

  for (const item of all) {
    const id = item.id || '(缺少 id)'
    if (ids.has(item.id)) fail(id, `id 重复：${item.id}`)
    ids.add(item.id)
    if (!ID_FORMAT.test(item.id || '')) fail(id, 'id 必须是小写 kebab-case')
    for (const field of BASE_FIELDS) {
      if (item[field] === undefined || item[field] === '') fail(id, `缺少公共字段 ${field}`)
    }
    if ((!Array.isArray(item.tags) || item.tags.length === 0) && item.type !== 'workflow') fail(id, 'tags 必须是非空数组')
    if (item.type === 'workflow') {
      const placeholders = item.placeholders || []
      const declared = new Set()
      for (const field of placeholders) {
        if (!PLACEHOLDER_KEY.test(field.key || '')) fail(id, `占位符 key 非法：${field.key}`)
        if (declared.has(field.key)) fail(id, `占位符重复声明：${field.key}`)
        declared.add(field.key)
        if (typeof field.label !== 'string' || !field.label) fail(id, `占位符 ${field.key} 缺少 label`)
        if (typeof field.required !== 'boolean') fail(id, `占位符 ${field.key} 缺少 required 布尔值`)
      }
      const used = [...String(item.prompt || '').matchAll(/\{([a-zA-Z0-9_-]+)\}/g)].map(m => m[1])
      for (const key of used) {
        if (!declared.has(key)) fail(id, `Prompt 使用了未声明的占位符 {${key}}`)
      }
      for (const key of declared) {
        if (!used.includes(key)) fail(id, `占位符 ${key} 未出现在 Prompt 中`)
      }
      if (!GUARD.test(item.prompt || '') && !GUARD.test((item.limitations || []).join(' '))) fail(id, 'Prompt 缺少防编造或待核验边界表述')
    }
    if (item.type === 'skill') {
      if (!item.guidance) fail(id, 'skill 缺少 guidance')
      if (!AVAILABILITY.skill.has(item.availability)) fail(id, `非法 availability：${item.availability}`)
      if (item.promptFragment !== undefined && (typeof item.promptFragment !== 'string' || item.promptFragment.length < 10)) {
        fail(id, 'promptFragment 存在时必须是有实际内容的字符串')
      }
      if (item.checklist !== undefined && (!Array.isArray(item.checklist) || !item.checklist.every(entry => typeof entry === 'string' && entry))) {
        fail(id, 'checklist 存在时必须是非空字符串数组')
      }
      if (item.availability !== 'prompt-guidance' && item.promptFragment) {
        fail(id, '只有 prompt-guidance 技能可以携带 promptFragment')
      }
    }
    if (item.type === 'database') {
      if (!item.accessNote) fail(id, 'database 缺少 accessNote')
      if (!AVAILABILITY.database.has(item.availability)) fail(id, `非法 availability：${item.availability}`)
    }
    if (item.type !== 'workflow' && item.type !== 'skill' && item.type !== 'database') {
      fail(id, `未知资源类型：${item.type}`)
    }
  }

  for (const item of all) {
    for (const ref of [...(item.suggestedSkillIds || []), ...(item.suggestedDatabaseIds || [])]) {
      if (!ids.has(ref)) fail(item.id, `关联资源不存在：${ref}`)
    }
  }

  // 「插件可直查」是目录标注与实现之间的双向契约：适配器存在就必须标出来（否则用户
  // 看到「需要 MCP」而实际能查，属于少报能力），标注了就必须有适配器（否则是虚假承诺）。
  // 仅在调用方显式传入清单时校验，避免只测单条合法性的用例被牵连。
  if (Array.isArray(directQueryIds)) {
    const directSet = new Set(directQueryIds)
    for (const id of directSet) {
      if (!ids.has(id)) fail(id, '直查适配器指向的 id 不在目录中')
    }
    for (const item of all) {
      if (item.type !== 'database') continue
      const declared = item.availability === 'available-in-plugin'
      if (directSet.has(item.id) && !declared) {
        fail(item.id, `已实现直查适配器，availability 应标为 available-in-plugin（当前为 ${item.availability}）`)
      }
      if (declared && !directSet.has(item.id)) {
        fail(item.id, '标为 available-in-plugin 但没有对应的直查适配器')
      }
    }
  }
  return errors
}

// 从 Node half 的查询实现里读出「插件能直查哪些来源」，供目录契约校验比对。
// 适配器表 `DIRECT_ADAPTERS` 是主要来源；PubMed 走 esearch + esummary 两步、结构不同，
// 以 `database.id === '...'` 独立分支实现，故一并提取。两边漂移时校验会直接失败。
export function readDirectQueryIds(path = resolve(root, 'dsh', 'database-query.js')) {
  const source = readFileSync(path, 'utf8')
  const block = source.match(/const DIRECT_ADAPTERS = \{([\s\S]*?)\n\}/)
  const ids = block ? [...block[1].matchAll(/^ {2}'?([a-z0-9-]+)'?:\s*\{/gm)].map(match => match[1]) : []
  for (const match of source.matchAll(/database\.id === '([a-z0-9-]+)'/g)) ids.push(match[1])
  return [...new Set(ids)]
}

export function loadCatalogFromDisk() {
  const load = file => JSON.parse(readFileSync(resolve(root, 'catalog', file), 'utf8'))
  return [...load('workflows.json'), ...load('skills.json'), ...load('databases.json')]
}
