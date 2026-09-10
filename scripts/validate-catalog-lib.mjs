#!/usr/bin/env node
// 目录契约校验：任何违反 ARCHITECTURE.md 第 4 章数据契约的条目都会被报告。
// 校验逻辑抽为 validateCatalogItems() 供 CLI 与测试共用；本文件只含纯逻辑。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function validateCatalogItems(all) {
  const errors = []
  const fail = (id, message) => errors.push(`[${id}] ${message}`)
  const BASE_FIELDS = ['id', 'type', 'name', 'description', 'category', 'tags']
  const PLACEHOLDER_KEY = /^[a-zA-Z0-9_-]+$/
  const ID_FORMAT = /^[a-z0-9-]+$/
  const GUARD = /核验|不得编造|不编造|待核验|待补充|需作者确认|需人工|待确认|需补充|不得虚构|禁止虚构/
  const AVAILABILITY = {
    skill: new Set(['prompt-guidance', 'requires-host-capability']),
    database: new Set(['reference-only', 'requires-mcp', 'available-in-host'])
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
    if (!Array.isArray(item.tags) || item.tags.length === 0) fail(id, 'tags 必须是非空数组')
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
      if (!GUARD.test(item.prompt || '')) fail(id, 'Prompt 缺少防编造或待核验边界表述')
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
  return errors
}

export function loadCatalogFromDisk() {
  const load = file => JSON.parse(readFileSync(resolve(root, 'catalog', file), 'utf8'))
  return [...load('workflows.json'), ...load('skills.json'), ...load('databases.json')]
}
