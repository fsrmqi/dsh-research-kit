import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractKnowledge, extractCitations, classifyEntityKind, expandEntityPhrase,
  knowledgeKeyFor, hashKey, normalizeKnowledgeLabel,
  MAX_NODES_PER_MESSAGE, MAX_CLAIMS_PER_MESSAGE, MAX_CITATIONS_PER_MESSAGE,
} from '../src/lib/knowledge-extract.js'

// 提取器是自动沉淀的地基：这里钉住需求原文的旗舰样例、确定性与有界性两大契约。

test('旗舰样例：基因 可能影响 性状，物种以「研究对象」并列接入', () => {
  const { nodes, claims } = extractKnowledge('Ghd7 可能影响水稻耐盐性。')
  const gene = nodes.find(node => node.label === 'Ghd7')
  const trait = nodes.find(node => node.label === '耐盐性')
  const organism = nodes.find(node => node.label === '水稻')
  assert.ok(gene?.kind === 'entity' && gene.entityKind === 'gene', 'Ghd7 应识别为基因')
  assert.ok(trait?.kind === 'entity' && trait.entityKind === 'trait', '耐盐性应识别为性状')
  assert.ok(organism?.kind === 'entity' && organism.entityKind === 'organism', '水稻应识别为物种')
  assert.ok(claims.some(claim => claim.fromKey === gene.key && claim.toKey === trait.key && claim.relation === 'may-affect' && claim.polarity === 'uncertain'),
    '基因→性状应为「可能影响」且极性不确定')
  assert.ok(claims.some(claim => claim.fromKey === organism.key && claim.toKey === trait.key && claim.relation === 'research-subject'),
    '物种→性状应为「研究对象」关系')
})

test('提取是确定性的：同一文本重复提取结果完全一致', () => {
  const text = '研究表明，OsNAC3 促进水稻耐盐性；干旱抑制耐盐性。参见 https://doi.org/10.1038/abc123。'
  assert.deepEqual(extractKnowledge(text), extractKnowledge(text))
})

test('促进/抑制/导致/相关的方向与极性', () => {
  const promotes = extractKnowledge('OsNAC3 促进水稻耐盐性。').claims
  assert.ok(promotes.some(claim => claim.relation === 'promotes' && claim.polarity === 'positive'))
  const inhibits = extractKnowledge('ABA 显著抑制种子萌发。').claims
  assert.ok(inhibits.some(claim => claim.relation === 'inhibits' && claim.polarity === 'negative'))
  const causes = extractKnowledge('干旱导致水稻减产。').claims
  assert.ok(causes.some(claim => claim.relation === 'causes'))
  const correlates = extractKnowledge('Ghd7 表达量与耐盐性呈正相关。').claims
  assert.ok(correlates.some(claim => claim.relation === 'correlates' && claim.polarity === 'positive'))
  const negativeCorrelates = extractKnowledge('Ghd7 表达量与耐盐性呈负相关。').claims
  assert.ok(negativeCorrelates.some(claim => claim.relation === 'correlates' && claim.polarity === 'negative'))
})

test('引导句式：研究发现/假设/问题/方法各自成节点，且发现与实体相连', () => {
  const finding = extractKnowledge('研究表明，OsNAC3 促进水稻耐盐性。')
  const findingNode = finding.nodes.find(node => node.kind === 'finding')
  assert.ok(findingNode, '应有发现节点')
  assert.ok(finding.claims.some(claim => claim.fromKey === findingNode.key && claim.relation === 'about'), '发现节点应通过 about 关系接入实体')
  assert.ok(extractKnowledge('假设 Ghd7 通过调控茉莉酸途径影响耐盐性。').nodes.some(node => node.kind === 'hypothesis'))
  assert.ok(extractKnowledge('水稻耐盐性的主效基因有哪些？').nodes.some(node => node.kind === 'question'))
  assert.ok(extractKnowledge('本研究采用 CRISPR-Cas9 方法验证基因功能。').nodes.some(node => node.kind === 'method' && node.label.includes('CRISPR-Cas9')),
    '方法节点应保留工具名')
})

test('「X的Y」复合短语拆成两个实体并补研究对象关系', () => {
  const expansion = expandEntityPhrase('水稻的耐盐性')
  assert.equal(expansion.entities.length, 2)
  assert.equal(expansion.entities[1].entityKind, 'trait')
  assert.ok(expansion.extras.some(extra => extra.relation === 'research-subject'))
})

test('实体分类：基因代号/蛋白/通路/物种/性状', () => {
  assert.equal(classifyEntityKind('Ghd7'), 'gene')
  assert.equal(classifyEntityKind('转录因子DREB蛋白'), 'protein')
  assert.equal(classifyEntityKind('茉莉酸信号通路'), 'pathway')
  assert.equal(classifyEntityKind('拟南芥'), 'organism')
  assert.equal(classifyEntityKind('耐盐性'), 'trait')
})

test('引用来源：DOI/URL/访问号，markdown 链接标题优先，同一 DOI 的链接不重复', () => {
  const citations = extractCitations('关键文献见 https://example.org/paper1 与 doi.org/10.1038/abc123。')
  assert.equal(citations.length, 2)
  assert.ok(citations.some(item => item.identifierKind === 'doi' && item.identifier === '10.1038/abc123'))
  assert.ok(citations.some(item => item.identifierKind === 'none' && item.url === 'https://example.org/paper1'))
  const linked = extractCitations('参考 [Genome-wide study](https://example.org/gw) 的结论。')
  assert.equal(linked[0].title, 'Genome-wide study', 'markdown 链接标题应作为证据标题')
  const deduped = extractCitations('见 https://doi.org/10.1038/abc123。')
  assert.equal(deduped.length, 1, 'doi.org 链接与 DOI 标识符是同一来源，不应重复入库')
  assert.equal(deduped[0].identifierKind, 'doi')
})

test('同一条消息的输出有界：节点、关系、引用各自封顶', () => {
  const manyClaims = Array.from({ length: 30 }, (_, index) => `基因X${index} 促进水稻耐盐性。`).join('')
  const claimsResult = extractKnowledge(manyClaims)
  assert.ok(claimsResult.nodes.length <= MAX_NODES_PER_MESSAGE, '节点数必须封顶')
  assert.ok(claimsResult.claims.length <= MAX_CLAIMS_PER_MESSAGE, '关系数必须封顶')
  assert.ok(claimsResult.claims.every(claim => {
    const keys = new Set(claimsResult.nodes.map(node => node.key))
    return keys.has(claim.fromKey) && keys.has(claim.toKey)
  }), '被保留的关系端点必须都在节点集合里，不允许悬挂')
  const manyCitations = Array.from({ length: 10 }, (_, index) => `https://example.org/${index}`).join(' ')
  assert.equal(extractKnowledge(manyCitations).citations.length, MAX_CITATIONS_PER_MESSAGE, '引用数必须封顶')
})

test('空文本与无关文本返回空结构', () => {
  assert.deepEqual(extractKnowledge(''), { nodes: [], claims: [], citations: [] })
  const chatty = extractKnowledge('你好！很高兴见到你。')
  assert.equal(chatty.citations.length, 0)
})

test('hashKey 与规范化标签是稳定去重的地基', () => {
  assert.equal(hashKey('abc'), hashKey('abc'))
  assert.notEqual(hashKey('abc'), hashKey('abd'))
  assert.equal(knowledgeKeyFor('entity', 'gene', 'Ghd7'), knowledgeKeyFor('entity', 'gene', ' ghd7 '), '拉丁文大小写与空白不影响身份')
  assert.notEqual(knowledgeKeyFor('entity', 'gene', 'Ghd7'), knowledgeKeyFor('entity', 'trait', 'Ghd7'), '不同实体类型不合并')
  assert.equal(normalizeKnowledgeLabel('  水稻的耐盐性。'), '水稻的耐盐性', '首尾标点应剥离')
})

// ── 英文句式 ──────────────────────────────────────────────────────────────────

test('英文：may affect + in <物种> 尾巴拆出研究对象关系', () => {
  const { nodes, claims } = extractKnowledge('Ghd7 may affect salt tolerance in rice.')
  const gene = nodes.find(node => node.label === 'Ghd7')
  const trait = nodes.find(node => node.label === 'salt tolerance')
  const organism = nodes.find(node => node.label === 'rice')
  assert.ok(gene?.entityKind === 'gene' && trait?.entityKind === 'trait' && organism?.entityKind === 'organism')
  assert.ok(claims.some(claim => claim.fromKey === gene.key && claim.toKey === trait.key && claim.relation === 'may-affect' && claim.polarity === 'uncertain'))
  assert.ok(claims.some(claim => claim.fromKey === organism.key && claim.toKey === trait.key && claim.relation === 'research-subject'))
})

test('英文：促进/抑制/相关的方向与极性', () => {
  const promotes = extractKnowledge('OsNAC3 significantly promotes salt tolerance.').claims
  assert.ok(promotes.some(claim => claim.relation === 'promotes' && claim.polarity === 'positive'))
  const inhibits = extractKnowledge('ABA inhibits seed germination.').claims
  assert.ok(inhibits.some(claim => claim.relation === 'inhibits' && claim.polarity === 'negative'))
  const correlates = extractKnowledge('Ghd7 expression is positively associated with salt tolerance.').claims
  assert.ok(correlates.some(claim => claim.relation === 'correlates' && claim.polarity === 'positive'))
})

test('英文：Our results show… 得到发现节点并与实体相连', () => {
  const { nodes, claims } = extractKnowledge('Our results show that OsNAC3 enhances salt tolerance in rice.')
  const finding = nodes.find(node => node.kind === 'finding')
  assert.ok(finding, '英文发现句式应识别为发现节点')
  assert.ok(claims.some(claim => claim.fromKey === finding.key && claim.relation === 'about'))
  assert.ok(nodes.some(node => node.label === 'rice' && node.entityKind === 'organism'))
})

test('英文：疑问句得到研究问题节点；中文旗舰样例不受影响', () => {
  assert.ok(extractKnowledge('How does Ghd7 regulate salt tolerance?').nodes.some(node => node.kind === 'question'))
  const flagship = extractKnowledge('Ghd7 可能影响水稻耐盐性。')
  assert.ok(flagship.claims.some(claim => claim.relation === 'may-affect'))
})
