#!/usr/bin/env node
// CLI 入口：校验 catalog/ 下的目录数据，失败时非零退出。
import { validateCatalogItems, loadCatalogFromDisk, readDirectQueryIds } from './validate-catalog-lib.mjs'

const items = loadCatalogFromDisk()
const directQueryIds = readDirectQueryIds()
const errors = validateCatalogItems(items, { directQueryIds })
if (errors.length) {
  console.error(`目录校验失败（${errors.length} 处）：`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log(`目录校验通过：${items.length} 个资源，${new Set(items.map(item => item.id)).size} 个唯一 ID，插件可直查 ${directQueryIds.length} 个来源。`)
