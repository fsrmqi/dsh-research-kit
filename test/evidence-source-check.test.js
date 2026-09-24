import test from 'node:test'
import assert from 'node:assert/strict'
import { checkEvidenceSource, compareSourceTitle, evidenceSourceCheckRoute } from '../dsh/evidence-source-check.js'

test('官方 DOI 元数据核对不等于原文核验', async () => {
  const web = { fetch: async () => ({ statusCode: 200, body: { content: JSON.stringify({ message: {
    title: ['Barley NP1 controls male sterility'], 'container-title': ['Plant Journal'], published: { 'date-parts': [[2025]] }, URL: 'https://doi.org/10.1234/barley',
  } }) } }) }
  const result = await checkEvidenceSource(web, { title: 'Barley NP1 controls male sterility', identifierKind: 'doi', identifier: '10.1234/barley' })
  assert.equal(result.status, 'matched')
  assert.equal(result.contentVerified, false)
  assert.equal(result.official.journal, 'Plant Journal')
  assert.equal(compareSourceTitle('Different title', result.official.title), 'mismatch')
  await assert.rejects(() => checkEvidenceSource(web, { identifierKind: 'accession', identifier: 'A-5438' }), /仅支持 DOI 或 PMID/)
  assert.equal(evidenceSourceCheckRoute({ web }).path, '/dsh-research-kit/evidence-source-check')
})
