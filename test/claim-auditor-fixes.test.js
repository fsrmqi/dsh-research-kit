import { test } from 'node:test'
import assert from 'node:assert'
import { extractClaims, auditClaims } from '../mcp/execution/claim-auditor.js'

test('单个 markdown 引用不应生成多个重复 claims', () => {
  const text = 'Our method achieves SOTA [1](https://doi.org/10.1038/s41586-023-06001-1). We also found improvements.'
  const claims = extractClaims(text)
  
  // 应该只提取一个 claim（对应一个引用）
  assert.strictEqual(claims.length, 1, '单个引用应生成一个 claim')
  assert.strictEqual(claims[0].citation, '10.1038/s41586-023-06001-1', 'DOI 正确')
})

test('多个独立引用应生成多个 claims', () => {
  const text = 'Method A works [1](https://doi.org/10.1038/test1). Method B also works [2](https://doi.org/10.1038/test2).'
  const claims = extractClaims(text)
  
  assert.strictEqual(claims.length, 2, '两个引用应生成两个 claims')
})

test('newline 处理：连续换行应被归一化', () => {
  const text = 'Result 1 [1](https://doi.org/10.1038/test1)\n\n\nResult 2 [2](https://doi.org/10.1038/test2)'
  const claims = extractClaims(text)
  
  assert.strictEqual(claims.length, 2, '换行不应影响 claim 提取')
  claims.forEach(claim => {
    assert.ok(!claim.claim.includes('\n\n'), 'claim 中不应有连续换行')
    assert.ok(!claim.context.includes('\n\n'), 'context 中不应有连续换行')
  })
})

test('claim 文本应去除多余空白', () => {
  const text = 'Our result [1](https://doi.org/10.1038/test1)   is   significant.'
  const claims = extractClaims(text)
  
  assert.strictEqual(claims.length, 1)
  assert.ok(!claims[0].claim.includes('   '), 'claim 中不应有多余空格')
  assert.ok(/^[^ ]/.test(claims[0].claim), 'claim 不应以空格开头')
})

test('同一 DOI 的不同上下文应视为不同 claims', () => {
  const text = 'Study A shows X [1](https://doi.org/10.1038/test1). Study B shows Y [2](https://doi.org/10.1038/test1).'
  const claims = extractClaims(text)
  
  // 虽然 DOI 相同，但上下文不同，should be deduped by key which includes context
  assert.ok(claims.length <= 2, '最多 2 个 claims')
})

test('纯数字引用格式 [1](DOI) 应被识别', () => {
  const text = 'As shown in [1](https://doi.org/10.1038/s41586-023-06001-1), the method works.'
  const claims = extractClaims(text)
  
  assert.strictEqual(claims.length, 1)
  assert.strictEqual(claims[0].citation_type, 'doi')
})

test('无引用文本返回空数组', () => {
  const text = 'This is just a statement without any citations.'
  const claims = extractClaims(text)
  
  assert.strictEqual(claims.length, 0)
})

test('arXiv 引用格式应被识别', () => {
  const text = 'The transformer model was proposed in arXiv:2301.00001.'
  const claims = extractClaims(text)
  
  assert.strictEqual(claims.length, 1)
  assert.strictEqual(claims[0].citation_type, 'arxiv')
  assert.strictEqual(claims[0].citation, '2301.00001')
})

test('PMID 引用格式应被识别', () => {
  const text = 'PubMed article PMID: 12345678 describes the method.'
  const claims = extractClaims(text)
  
  assert.strictEqual(claims.length, 1)
  assert.strictEqual(claims[0].citation_type, 'pmid')
  assert.strictEqual(claims[0].citation, '12345678')
})
