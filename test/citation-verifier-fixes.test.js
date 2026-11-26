import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyCitation, detectIdentifierType } from '../mcp/execution/citation-verifier.js'
import { auditClaims } from '../mcp/execution/claim-auditor.js'

function mockCrossref(t, metadata, status = 200) {
  t.mock.method(globalThis, 'fetch', async () => new Response(
    JSON.stringify({ message: { DOI: '10.9999/fixture', title: [metadata.title || ''], ...metadata } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  ))
}

test('相反断言与完全相同措辞均不能凭关键词判为支持', async t => {
  mockCrossref(t, { title: ['Treatment does not improve survival'], abstract: 'Treatment does not improve survival.' })
  for (const claim of ['Treatment improves survival', 'Treatment does not improve survival']) {
    const result = await verifyCitation('10.9999/negation', claim)
    assert.equal(result.exists, true)
    assert.equal(result.claim_supported, null)
    assert.ok(result.confidence <= 0.3)
    assert.ok(result.matched_terms.includes('survival'))
    assert.match(result.claim_evidence, /需人工核验全文/)
  }
})

test('低重合与纯中文措辞均不能判为不支持', async t => {
  mockCrossref(t, { title: ['水稻研究'], abstract: '本研究发现水稻产量没有提高。' })
  for (const claim of ['产量提高', '完全不同的研究问题', 'No shared keywords']) {
    const result = await verifyCitation('10.9999/chinese', claim)
    assert.equal(result.claim_supported, null)
  }
  const result = await verifyCitation('10.9999/chinese', '水稻研究')
  assert.ok(result.matched_terms.includes('水稻研究'), '测试真实生产模块的中文保留行为')
})

test('只有标题或没有文本时明确缺少摘要，保持待核验', async t => {
  mockCrossref(t, { title: ['Treatment improves survival'] })
  const titled = await verifyCitation('10.9999/title-only', 'Treatment improves survival')
  assert.equal(titled.claim_supported, null)
  assert.match(titled.claim_evidence, /缺少摘要/)
  t.mock.restoreAll()
  mockCrossref(t, { title: [] })
  const empty = await verifyCitation('10.9999/no-text', 'Treatment improves survival')
  assert.equal(empty.claim_supported, null)
  assert.deepEqual(empty.matched_terms, [])
})

test('detectIdentifierType 识别各种格式，未知格式不触发网络', async t => {
  for (const [value, type] of [['10.1038/test', 'doi'], ['PMC12345678', 'pmcid'], ['12345678', 'pmid'], ['2301.00001', 'arxiv'], ['NCT01234567', 'nct'], ['unknown', null]]) {
    assert.equal(detectIdentifierType(value), type)
  }
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('不应外呼') })
  assert.equal((await verifyCitation('unknown')).exists, false)
  assert.equal(fetch.mock.callCount(), 0)
})

test('未提供声明时只核验来源存在性', async t => {
  mockCrossref(t, { title: ['Source record'] })
  const result = await verifyCitation('10.9999/no-claim')
  assert.equal(result.exists, true)
  assert.equal(result.claim_supported, undefined)
})

test('声明审计将关键词命中归为需全文核验，不投影为支持', async t => {
  mockCrossref(t, { title: ['Treatment does not improve survival'], abstract: 'Treatment does not improve survival.' })
  const result = await auditClaims('Treatment improves survival [1](https://doi.org/10.9999/audit-negation).')
  assert.equal(result.data.summary.supported, 0)
  assert.equal(result.data.summary.not_supported, 0)
  assert.equal(result.data.summary.needs_review, 1)
  assert.equal(result.data.claims[0].supported, null)
  assert.equal(result.data.claims[0].category, 'needs-fulltext-review')
})

test('HTTP 错误仍会抛出，不伪装为已核验', async t => {
  mockCrossref(t, {}, 404)
  await assert.rejects(verifyCitation('10.9999/http-error'), /HTTP/)
})

test('arXiv Atom XML 解析取 entry 内标题而非 feed 查询头，并折叠换行空白', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query: id_list=2401.99999</title>
  <entry>
    <id>http://arxiv.org/abs/2401.99999v1</id>
    <published>2024-01-15T00:00:00Z</published>
    <title>
      Accurate Protein
      Structure Prediction
    </title>
    <summary>Abstract text here.</summary>
    <author><name>Jane Doe</name></author>
  </entry>
</feed>`,
    { status: 200, headers: { 'Content-Type': 'application/xml' } },
  ))
  const result = await verifyCitation('2401.99999')
  assert.equal(result.exists, true)
  assert.equal(result.metadata.title, 'Accurate Protein Structure Prediction')
})
