import test from 'node:test'
import assert from 'node:assert/strict'
import { auditResearchDataQuality } from '../src/lib/research-quality.js'

test('数据质量审计只报告缺标识符、同源候选与断链，不自动改写数据', () => {
  const evidence = [
    { id: 'a', project: '课题甲', identifierKind: 'doi', identifier: '10.1000/X', status: 'verified' },
    { id: 'b', project: '课题乙', identifierKind: 'doi', identifier: '10.1000/x', status: 'unverified' },
    { id: 'c', project: '课题甲', identifierKind: 'none', identifier: '', url: 'https://example.org/c', status: 'stale' },
  ]
  const links = [
    { evidenceId: 'a', assetId: 'asset-1' },
    { evidenceId: 'missing', assetId: 'asset-1' },
    { evidenceId: 'b', assetId: 'missing-asset' },
  ]
  const snapshot = JSON.stringify({ evidence, links })
  const result = auditResearchDataQuality({ evidence, links, assetIds: ['asset-1'] })
  assert.equal(result.missingIdentifier, 1)
  assert.equal(result.unverified, 1)
  assert.equal(result.staleOrMissing, 1)
  assert.equal(result.duplicateGroups.length, 1)
  assert.equal(result.orphanLinks.length, 2)
  assert.equal(JSON.stringify({ evidence, links }), snapshot)
  assert.equal(auditResearchDataQuality({ evidence, links }).orphanLinks.length, 1, '资产端不可用时不能妄报资产断链')
})
