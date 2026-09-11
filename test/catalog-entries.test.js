import test from 'node:test'
import assert from 'node:assert/strict'
import { listShardFiles, readShards, readShardEntries, loadCatalogEntries, missingRegistrations, shardRegistrationErrors } from '../scripts/lib/catalog-entries.mjs'
import { compareShardsWithEntries } from '../scripts/validate-catalog-lib.mjs'

// Node 侧目录加载的两条路径（fs 直读分片 / ESM 聚合入口）本身也要有单元测试：
// 构建器与校验器都建立在它们之上，加载函数漂移会让一切下游断言空转。

test('分片枚举：只列 *.json、不含聚合入口、按相对路径确定排序', () => {
  for (const kind of ['workflows', 'skills', 'resources']) {
    const files = listShardFiles(kind)
    assert.ok(files.length > 0, `${kind} 未枚举到分片`)
    assert.ok(files.every(file => file.endsWith('.json')), `${kind} 枚举出非 JSON 文件`)
    assert.ok(!files.includes('index.js'), '聚合入口 index.js 不得作为分片出现')
    assert.deepEqual([...files].sort(), files, `${kind} 分片清单未按路径排序`)
  }
  assert.equal(listShardFiles('workflows').length, 24, '工作流分片数应为 24（16 个有内容 + 8 个预留流程族）')
  assert.deepEqual(listShardFiles('skills'), ['bioinformatics.json', 'core.json', 'crop-breeding.json'])
  assert.deepEqual(listShardFiles('resources'), ['crop-breeding.json', 'general-science.json', 'genomics.json', 'literature.json', 'omics.json'])
  assert.ok(!listShardFiles('resources').includes('database-metadata.json'), '分组元数据不是条目分片，不得参与枚举与登记')
})

test('分片登记：目录中的每个分片都被 index.js 引用', () => {
  for (const kind of ['workflows', 'skills', 'resources']) {
    assert.deepEqual(shardRegistrationErrors(kind), [], `${kind} 存在未登记的分片`)
  }
})

test('登记纯函数：未登记的分片会被点名', () => {
  assert.deepEqual(missingRegistrations(['core.json', 'new-shard.json'], "import core from './core.json' with { type: 'json' }"), ['new-shard.json'])
  assert.deepEqual(missingRegistrations(['sub/new.json'], "import newShard from './sub/new.json' with { type: 'json' }"), [], '子目录分片应可登记')
})

test('聚合入口：数量、类型与分组元数据形状正确', async () => {
  const { workflows, skills, resources, databaseMetadataConfig } = await loadCatalogEntries()
  assert.equal(workflows.length, 308)
  assert.equal(skills.length, 23)
  assert.equal(resources.length, 122)
  assert.ok(workflows.every(item => item.type === 'workflow'))
  assert.ok(skills.every(item => item.type === 'skill'))
  assert.ok(resources.every(item => item.type === 'database'))
  assert.ok(Array.isArray(databaseMetadataConfig.groups) && databaseMetadataConfig.groups.length > 0)
  const grouped = databaseMetadataConfig.groups.flatMap(group => group.ids)
  assert.equal(new Set(grouped).size, grouped.length, '分组元数据中同一 id 不得出现在两个研究入口')
})

test('fs 直读分片与 ESM 聚合入口逐条一致', async () => {
  const { workflows, skills, resources } = await loadCatalogEntries()
  const fromDisk = [...readShardEntries('workflows'), ...readShardEntries('skills'), ...readShardEntries('resources')]
  assert.deepEqual(compareShardsWithEntries(fromDisk, [...workflows, ...skills, ...resources]), [])
  assert.equal(readShards('skills').length, 3, 'skills 应枚举出 3 个分片')
})
