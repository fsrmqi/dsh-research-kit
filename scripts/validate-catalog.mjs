#!/usr/bin/env node
// CLI 入口：校验 catalog/ 下的目录数据，失败时非零退出。
// 除单条契约外，这里执行「分片 ↔ 聚合入口」互证与分片登记检查：
// 目录里的每个分片都必须被对应 index.js 引用，且两路读取逐条一致。
import { shardRegistrationErrors, loadCatalogEntries } from './lib/catalog-entries.mjs'
import { validateCatalogItems, loadCatalogFromDisk, readDirectQueryIds, compareShardsWithEntries } from './validate-catalog-lib.mjs'

const items = loadCatalogFromDisk()
const { workflows, skills, resources } = await loadCatalogEntries()
const directQueryIds = readDirectQueryIds()

const structuralErrors = [
  ...['workflows', 'skills', 'resources'].flatMap(kind => shardRegistrationErrors(kind)),
  ...compareShardsWithEntries(items, [...workflows, ...skills, ...resources]),
]
const errors = validateCatalogItems(items, { directQueryIds })

if (structuralErrors.length || errors.length) {
  for (const error of [...structuralErrors, ...errors]) console.error(`- ${error}`)
  console.error(`目录校验失败（结构 ${structuralErrors.length} 处、契约 ${errors.length} 处）。`)
  process.exit(1)
}
console.log(`目录校验通过：${items.length} 个资源（工作流 ${workflows.length} / 技能 ${skills.length} / 数据源 ${resources.length}），${new Set(items.map(item => item.id)).size} 个唯一 ID，分片与聚合入口一致，插件可直查 ${directQueryIds.length} 个来源。`)
