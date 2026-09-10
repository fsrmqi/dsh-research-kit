import test from 'node:test'
import assert from 'node:assert/strict'
import { assertManageableBody, filterAssets, MAX_ASSET_BODY_CHARS } from '../src/lib/vault-core.js'

test('超长正文被拒绝（隐私边界：原始数据/完整查询结果不入库）', () => {
  const huge = 'x'.repeat(MAX_ASSET_BODY_CHARS + 1)
  assert.throws(() => assertManageableBody(huge), /超过.*字符/)
  assert.doesNotThrow(() => assertManageableBody('正常长度的研究假设'))
})

test('筛选器支持关键词与预设分组', () => {
  const assets = [
    { id: 'a', title: '批次效应假设', body: '单细胞数据的批次效应待验证', tags: ['单细胞'], favorite: true, epistemicStatus: 'to_verify' },
    { id: 'b', title: '引言模板', body: '可复用的引言写作提示词', tags: [], favorite: false, epistemicStatus: 'inferred' },
    { id: 'c', title: '派生假设', body: '从 a 派生', parentId: 'a', epistemicStatus: 'inferred' },
  ]
  assert.equal(filterAssets(assets, { query: '单细胞' }).length, 1)
  assert.deepEqual(filterAssets(assets, { filter: 'favorites' }).map(item => item.id), ['a'])
  assert.deepEqual(filterAssets(assets, { filter: 'to_verify' }).map(item => item.id), ['a'])
  assert.deepEqual(filterAssets(assets, { filter: 'derived' }).map(item => item.id), ['c'])
  assert.equal(filterAssets(assets, {}).length, 3)
  assert.equal(filterAssets(null, {}).length, 0)
})
