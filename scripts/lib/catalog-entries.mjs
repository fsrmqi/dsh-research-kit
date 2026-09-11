#!/usr/bin/env node
// Node 侧目录加载：两条相互独立的读取路径，用于互证「分片 ↔ 聚合入口」没有漂移。
//
// 1. fs 直读（readShards）：递归枚举分片目录下的 *.json，不经过任何 JS 模块；
//    校验器用它独立核对分片本身（文件漏登记、分片遗漏都会在这里显形）。
// 2. ESM 入口加载（loadCatalogEntries）：动态 import 三个 index.js 聚合入口；
//    构建器用它取得内联进浏览器产物的聚合数组 —— 分片必须先经入口登记才算真源。
//
// 测试与校验器同时走两条路径比对：总数、ID 集合与逐条内容一致才放行。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHARD_DIRS = {
  workflows: resolve(repoRoot, 'catalog/workflows'),
  skills: resolve(repoRoot, 'catalog/skills'),
  resources: resolve(repoRoot, 'catalog/resources'),
}

// 非条目文件：database-metadata.json 是分组展示元数据（对象而非条目数组），
// 由 resources/index.js 随入口导出，不作为「条目分片」参与枚举与登记。
const NON_SHARD_FILES = new Set(['resources/database-metadata.json'])

// 递归枚举分片目录下的 *.json（index.js 是聚合入口，不是分片，天然被排除）。
// 按相对路径排序保证结果确定，与目录遍历顺序解耦。
export function listShardFiles(kind) {
  const dir = SHARD_DIRS[kind]
  if (!dir) throw new Error(`未知分片目录：${kind}`)
  const found = []
  const walk = current => {
    for (const name of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, name.name)
      if (name.isDirectory()) walk(full)
      else if (name.isFile() && name.name.endsWith('.json')) {
        const file = relative(dir, full).split('\\').join('/')
        if (!NON_SHARD_FILES.has(`${kind}/${file}`)) found.push(file)
      }
    }
  }
  walk(dir)
  return found
}

// fs 直读全部分片：[{ file, entries }]，file 为分片目录内相对路径。
export function readShards(kind) {
  return listShardFiles(kind).map(file => ({
    file,
    entries: JSON.parse(readFileSync(join(SHARD_DIRS[kind], file), 'utf8')),
  }))
}

// fs 直读并摊平全部分片条目（校验器的独立真源）。
export function readShardEntries(kind) {
  return readShards(kind).flatMap(shard => shard.entries)
}

// 纯函数：目录中的分片文件清单里，哪些未被入口源码引用（含子目录分片 ./sub/foo.json）。
export function missingRegistrations(files, entrySource) {
  const registered = new Set([...entrySource.matchAll(/from\s+'\.\/([^']+)\.json'/g)].map(match => match[1]))
  return files.filter(file => !registered.has(file.replace(/\.json$/, '')))
}

// 分片登记完整性：目录里的每个 *.json 都必须被 index.js 引用。
// 仅靠总数断言抓不住「新增空分片忘记登记」，这里按文件集合硬校验。
export function shardRegistrationErrors(kind) {
  return missingRegistrations(listShardFiles(kind), readFileSync(join(SHARD_DIRS[kind], 'index.js'), 'utf8'))
    .map(file => `${kind}/${file} 未在 ${kind}/index.js 登记（分片不会被聚合，浏览器目录将缺项）`)
}

// ESM 入口加载：构建器与测试共用的聚合读取点。
// resources 入口同时带出 databaseMetadataConfig（分组展示元数据），保持 src/catalog.js 只有三个数据 import。
export async function loadCatalogEntries() {
  const [workflows, skills, resources] = await Promise.all(
    ['workflows', 'skills', 'resources'].map(kind => import(pathToFileURL(join(SHARD_DIRS[kind], 'index.js'))))
  )
  return {
    workflows: workflows.default,
    skills: skills.default,
    resources: resources.default,
    databaseMetadataConfig: resources.databaseMetadataConfig,
  }
}
