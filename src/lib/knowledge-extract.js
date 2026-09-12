// 自动沉淀的结构化提取器（纯逻辑，无 React、无浏览器依赖、无网络请求）。
//
// 职责：把一条助手回答的文本解析成「知识节点 + 关系 + 引用来源」三组结构，
// 供 knowledge-store 去重入库、knowledge-deposition 联动灵感资产/证据库、
// 证据图谱绘制。它是规则提取器，不是理解器：
//   - 只捕捉显式的陈述模式（X 影响 Y、A 与 B 相关、研究表明……），
//     捕捉不到不算失败，捕捉到的一律「待核验」；
//   - 输出必须确定：同一文本重复提取必得同一结果（回归测试钉住）；
//   - 输出必须有界：单条消息的节点/关系/引用各设上限，防止长回答撑爆存储。
//
// 旗舰样例（需求原文）：“某基因可能影响水稻耐盐性” 应得到
//   基因(某基因) —可能影响→ 性状(耐盐性) ←研究对象— 物种(水稻)。
// 由 extractClaims + expandEntityPhrase 两级实现：先抽二元关系，
// 再把「物种+性状」复合短语拆开并补 research-subject 关系。

// ── 词表与标签 ────────────────────────────────────────────────────────────────

export const KNOWLEDGE_KINDS = ['question', 'hypothesis', 'finding', 'method', 'entity']
export const KNOWLEDGE_KIND_LABELS = {
  question: '研究问题', hypothesis: '假设', finding: '研究发现', method: '方法', entity: '实体',
}
export const KNOWLEDGE_ENTITY_KINDS = ['gene', 'protein', 'trait', 'organism', 'pathway', 'compound', 'generic']
export const KNOWLEDGE_ENTITY_LABELS = {
  gene: '基因', protein: '蛋白质', trait: '性状', organism: '物种/材料', pathway: '通路', compound: '物质', generic: '实体',
}
export const KNOWLEDGE_STATUSES = ['to_verify', 'verified', 'disputed']
export const KNOWLEDGE_STATUS_LABELS = { to_verify: '待核验', verified: '已核验', disputed: '存疑' }
export const KNOWLEDGE_POLARITIES = ['positive', 'negative', 'uncertain', 'neutral']
export const KNOWLEDGE_POLARITY_LABELS = { positive: '正向', negative: '负向', uncertain: '不确定', neutral: '' }

// 关系词表：前六种由提取器产生；about/records/supports/deposited 由入库与图谱层生成。
export const CLAIM_RELATIONS = ['may-affect', 'promotes', 'inhibits', 'causes', 'correlates', 'research-subject', 'about', 'records', 'supports', 'deposited']
export const CLAIM_RELATION_LABELS = {
  'may-affect': '可能影响', promotes: '促进', inhibits: '抑制', causes: '导致',
  correlates: '相关', 'research-subject': '研究对象', about: '涉及',
  records: '记录自', supports: '支持', deposited: '沉淀为资产',
}

// 性状词表：显式列举 + 「X性」后缀规则（X 含 耐/抗/稳/敏 时才认，避免「可能性」这类误报）。
const TRAIT_WORDS = [
  '耐盐性', '耐盐碱性', '抗旱性', '耐旱性', '耐涝性', '耐热性', '耐寒性', '抗寒性', '抗病性', '抗虫性',
  '抗倒伏性', '耐逆性', '抗逆性', '耐低氮性', '抗氧化性', '产量', '品质', '株高', '穗长', '穗数',
  '千粒重', '粒重', '分蘖数', '结实率', '发芽率', '萌发率', '成活率', '存活率', '表达量', '丰度',
  '活性', '含量', '积累量', '存活', '整精米率', '垩白度', '直链淀粉含量',
]
const ORGANISM_WORDS = [
  '水稻', '小麦', '大麦', '玉米', '拟南芥', '大豆', '棉花', '油菜', '马铃薯', '番茄', '高粱', '谷子',
  '花生', '苜蓿', '杨树', '葡萄', '柑橘', '小鼠', '大鼠', '斑马鱼', '果蝇', '线虫', '酵母', '大肠杆菌', '人类',
]

// ── 限额与常量 ────────────────────────────────────────────────────────────────

export const MAX_NODES_PER_MESSAGE = 24
export const MAX_CLAIMS_PER_MESSAGE = 24
export const MAX_CITATIONS_PER_MESSAGE = 8
export const MAX_LABEL_CHARS = 60
export const MAX_EXCERPT_CHARS = 200

const SENTENCE_SPLIT = /(?<=[。！？!?；;])\s*|\n+/
const MARKDOWN_CODE_BLOCK = /```[\s\S]*?```/g
const MARKDOWN_INLINE_CODE = /`([^`]*)`/g
const MARKDOWN_BOLD = /\*\*([^*]+)\*\*/g
const MARKDOWN_ITALIC = /\*([^*]+)\*/g
const MARKDOWN_HEADING = /^#{1,6}\s+/gm
const MARKDOWN_LIST = /^\s*[-*+]\s+/gm
const MARKDOWN_LINK = /\[([^\]]{1,120})\]\((https?:\/\/[^)\s]+)\)/g

// 二元关系模式（按优先级排列，逐短句只取第一个命中的模式）。
// 主体/客体各限 24 字：科学陈述的主语通常是短语而非长句，超限多半是没抽对。
// polarity 是模式自带的方向先验；句中含不确定词时统一收敛为 uncertain。
const CLAIM_PATTERNS = [
  { relation: 'may-affect', re: /^(.{1,24}?)(?:可能|或许|也许|有望)(?:会|将|将会)?(?:显著|明显)?(?:地)?(影响|调控|调节|改变|决定)(?:了)?(.{1,24}?)(?:[，。；！？、\s]|$)/ },
  { relation: 'promotes', re: /^(.{1,24}?)(?:显著|明显)?(?:地)?(促进|增强|提高|上调|提升|增加|延长|改善|激活)(?:了)?(.{1,24}?)(?:[，。；！？、\s]|$)/ },
  { relation: 'inhibits', re: /^(.{1,24}?)(?:显著|明显)?(?:地)?(抑制|削弱|减弱|降低|下调|减少|缩短|阻碍|损害|破坏)(?:了)?(.{1,24}?)(?:[，。；！？、\s]|$)/ },
  { relation: 'causes', re: /^(.{1,24}?)(?:直接|间接)?(导致|引起|造成|诱发|引发)(?:了)?(.{1,24}?)(?:[，。；！？、\s]|$)/ },
  { relation: 'correlates', re: /^(.{1,24}?)与(.{1,24}?)(?:之间)?(?:呈|存在)?(?:显著)?(正|负)?相关/ },
]

// 主体/客体里不允许再出现关系动词或介词引导——出现说明切分失败，宁可丢掉这条关系。
const CLAIM_SPAN_STOPWORDS = /(促进|抑制|影响|调控|导致|引起|相关|激活|通过|利用|借助|采用|使用|研究表明|可能)/
// 裸代词/泛指主语没有图谱价值。
const CLAIM_SPAN_PRONOUNS = /^(我们|本研究|研究|作者|其|该|此|这|它们|他们|它|两者|二者|两者之间|二者之间)$/

// 引导句式：剥离后得到「发现/假设/问题/方法」节点，剩余短句继续抽二元关系。
const FINDING_MARKER = /^(?:研究|实验|结果|数据|分析|测序|观察|文献)(?:表明|显示|发现|说明|证实|提示|指出|报道|证明)|^(?:表明|显示|发现|说明|证实|提示|指出|报道|证明)/
const HYPOTHESIS_MARKER = /^(?:我们|本研究|作者|团队)?(?:假设|猜想|推测|被认为可能是)/
const QUESTION_MARKER = /^(?:研究问题|科学问题|核心问题|关键问题)(?:是|为)?(?:：|:|\s)?/
const METHOD_MARKER = /^(?:采用|使用|借助|利用)[^，。；]{0,40}?(?:方法|技术|平台|流程|协议|体系)|^方法(?:是|：|:)/
// 主语前缀（本研究/我们…）不影响句式类型，先剥掉再匹配引导词。
const SUBJECT_PREFIX = /^(?:本研究|本文|我们|团队|笔者)(?=采用|使用|借助|利用|发现|表明|显示|证实|说明|假设|推测|猜想|观察到)/
const QUESTION_HINT = /(如何|是否|为何|为什么|怎样|哪些|哪种|哪些个|什么|多少|能否|可否|哪个)/
const UNCERTAIN_HINT = /(可能|或许|也许|有望|疑似|推测|大概)/

// ── 基础工具 ──────────────────────────────────────────────────────────────────

// FNV-1a 32 位哈希：给「规范化 key」生成确定性短 id（无 crypto 依赖，纯同步）。
export function hashKey(text) {
  const str = String(text || '')
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(16).padStart(8, '0')}${str.length.toString(16)}`
}

export function normalizeKnowledgeLabel(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(MARKDOWN_BOLD, '$1')
    .replace(/^[「『"'\s]+|[。；，,、.!！?？：:」』"'\s]+$/g, '')
    .trim()
}

export function clampKnowledgeLabel(value, max = MAX_LABEL_CHARS) {
  const text = normalizeKnowledgeLabel(value)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// 去重 key：kind（实体再带 entityKind）+ 规范化标签。拉丁文统一小写，中文不受影响。
export function normalizeEntityKey(label) {
  return normalizeKnowledgeLabel(label).toLowerCase()
}

export function knowledgeKeyFor(kind, entityKind, label) {
  const suffix = kind === 'entity' && entityKind ? `:${entityKind}` : ''
  return `${kind}${suffix}:${normalizeEntityKey(label)}`
}

// ── 实体识别 ──────────────────────────────────────────────────────────────────

function isGeneLike(text) {
  if (/基因$|^基因/.test(text)) return true
  if (/^miR/i.test(text)) return true
  // 拉丁短代号：含数字或多个大写字母（Ghd7、OsNAC3、SPL9、NRT1.1B），且不是普通英文单词。
  if (/^[A-Za-z][A-Za-z0-9.-]{1,11}$/.test(text) && (/\d/.test(text) || /[A-Z].*[A-Z]/.test(text))) return true
  return false
}

export function classifyEntityKind(label) {
  const text = normalizeKnowledgeLabel(label)
  if (!text) return 'generic'
  if (isGeneLike(text)) return 'gene'
  if (/(蛋白|蛋白质|酶)$/.test(text)) return 'protein'
  if (/(途径|通路)$/.test(text)) return 'pathway'
  if (TRAIT_WORDS.includes(text) || (/[耐抗稳敏][^性]*性$/.test(text) && text.length <= 8)) return 'trait'
  for (const word of ORGANISM_WORDS) { if (text === word || text.startsWith(word)) return 'organism' }
  if (/(素|酸|碱|苷|醇|酯)$/.test(text) && text.length <= 8) return 'compound'
  return 'generic'
}

// 「X的T」「物种+性状」复合短语拆分：返回实体序列与额外的 research-subject 关系。
// 端点约定：关系的主体/客体取展开序列的**最后一个**实体（「水稻耐盐性」→ 性状），
// 其余实体用 research-subject 串到该端点上（「水稻」→研究对象→「耐盐性」）。
export function expandEntityPhrase(phrase) {
  const text = normalizeKnowledgeLabel(phrase)
  if (!text) return { entities: [], endpoint: null, extras: [] }
  // 形如「P的T」且 T 是性状：P 与 T 各自成实体。
  const possessive = /^(.{1,16}?)的(.{1,12})$/.exec(text)
  if (possessive && (TRAIT_WORDS.includes(possessive[2]) || /[耐抗稳敏][^性]*性$/.test(possessive[2]))) {
    return splitSubjectTrait(possessive[1], possessive[2])
  }
  // 形如「物种+性状」连写（水稻耐盐性）。
  for (const word of ORGANISM_WORDS) {
    if (text.startsWith(word) && text.length > word.length) {
      const tail = text.slice(word.length)
      if (TRAIT_WORDS.includes(tail) || /[耐抗稳敏][^性]*性$/.test(tail)) return splitSubjectTrait(word, tail)
    }
  }
  const kind = classifyEntityKind(text)
  return { entities: [{ key: knowledgeKeyFor('entity', kind, text), label: text, entityKind: kind }], endpoint: knowledgeKeyFor('entity', kind, text), extras: [] }
}

function splitSubjectTrait(subject, trait) {
  const sKind = classifyEntityKind(subject)
  const tKind = 'trait'
  const sKey = knowledgeKeyFor('entity', sKind, subject)
  const tKey = knowledgeKeyFor('entity', tKind, trait)
  return {
    entities: [
      { key: sKey, label: subject, entityKind: sKind },
      { key: tKey, label: trait, entityKind: tKind },
    ],
    endpoint: tKey,
    extras: [{ fromKey: sKey, toKey: tKey, relation: 'research-subject', polarity: 'neutral' }],
  }
}

// ── 引用来源 ──────────────────────────────────────────────────────────────────

const CITATION_PATTERNS = [
  { kind: 'doi', regex: /\b10\.\d{4,9}\/[-._;()/:a-z0-9]+/gi, trim: /[.,;)\]}>]+$/ },
  { kind: 'pmcid', regex: /\bPMC\d{6,9}\b/gi },
  { kind: 'nct', regex: /\bNCT\d{8}\b/gi },
  { kind: 'arxiv', regex: /\barxiv:\s*([\d.]+v\d+)/gi, group: 1 },
  { kind: 'pmid', regex: /\bpmid:?\s*(\d{5,8})\b/gi, group: 1 },
  { kind: 'accession', regex: /\b(?:GSE|GSM|SRP|PRJNA|PRJEB|PRJDA)\d{4,9}\b/g },
]
const URL_PATTERN = /https?:\/\/[^\s"'<>()\[\]{}，。；、！？]+/g

function sentenceAt(sentences, index) {
  return clampKnowledgeLabel(sentences[index], 100)
}

// 从原文提取引用：markdown 链接标题优先，其余用所在句做标题兜底（normalizeEvidenceEntry 需要标题）。
export function extractCitations(text) {
  const source = String(text || '')
  if (!source.trim()) return []
  const sentences = source.split(SENTENCE_SPLIT).map(part => part.trim()).filter(Boolean)
  const linkTitles = new Map()
  for (const match of source.matchAll(MARKDOWN_LINK)) linkTitles.set(match[2], match[1].trim())
  const results = []
  const seen = new Set()
  const push = citation => {
    if (!citation) return
    const key = citation.identifier ? `${citation.identifierKind}:${citation.identifier.toLowerCase()}` : `url:${citation.url.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    results.push(citation)
  }
  for (const pattern of CITATION_PATTERNS) {
    pattern.regex.lastIndex = 0
    for (const match of source.matchAll(pattern.regex)) {
      const raw = match[pattern.group || 0]
      if (!raw) continue
      const value = pattern.trim ? raw.replace(pattern.trim, '') : raw
      if (!value) continue
      const at = match.index || 0
      push({ title: sentenceAt(sentences, sentenceIndexAt(source, at, sentences)), url: '', identifier: value, identifierKind: pattern.kind })
    }
  }
  for (const match of source.matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,;)\]]+$/, '')
    if (!url) continue
    const at = match.index || 0
    push({ title: linkTitles.get(url) || sentenceAt(sentences, sentenceIndexAt(source, at, sentences)), url, identifier: '', identifierKind: 'none' })
  }
  // DOI 常以 https://doi.org/<doi> 链接形式出现：同一来源会同时命中 doi 与 url 两条，
  // 保留带稳定标识符的那条，丢弃与之重复的纯链接。
  const identifiers = results.filter(item => item.identifier).map(item => item.identifier.toLowerCase())
  return results.filter(item => item.identifier || !identifiers.some(id => item.url.toLowerCase().includes(id)))
}

function sentenceIndexAt(text, index, sentences) {
  let consumed = 0
  for (let i = 0; i < sentences.length; i++) {
    const found = text.indexOf(sentences[i], consumed)
    if (found < 0) continue
    consumed = found + sentences[i].length
    if (index < consumed) return i
  }
  return 0
}

// ── 关系抽取 ──────────────────────────────────────────────────────────────────

function cleanClaimSpan(span) {
  const text = normalizeKnowledgeLabel(span)
  if (!text || text.length > 24) return ''
  if (CLAIM_SPAN_PRONOUNS.test(text)) return ''
  if (CLAIM_SPAN_STOPWORDS.test(text)) return ''
  return text
}

function extractClaimsFromClause(clause) {
  const rows = []
  const fragments = clause.split(/[；;]/).map(part => part.trim()).filter(Boolean)
  for (const fragment of fragments) {
    for (const pattern of CLAIM_PATTERNS) {
      const match = pattern.re.exec(fragment)
      if (!match) continue
      if (pattern.re === CLAIM_PATTERNS[4].re) {
        // correlates：A 与 B 相关；「正相关/负相关」决定极性，无修饰词时是不确定。
        const subject = cleanClaimSpan(match[1])
        const object = cleanClaimSpan(match[2])
        if (!subject || !object) continue // 本模式切分失败：换下一个模式再试，不放弃整句
        const polarity = match[3] === '正' ? 'positive' : match[3] === '负' ? 'negative' : 'uncertain'
        rows.push({ subjectPhrase: subject, objectPhrase: object, relation: 'correlates', polarity })
        break
      }
      const subject = cleanClaimSpan(match[1])
      const object = cleanClaimSpan(match[3])
      if (!subject || !object) continue // 同上：切分失败就换模式（例：「……降低」会先被 inhibits 撞上空宾语）
      // 极性：模式自带方向先验（抑制=负向，其余=正向）；句中含不确定词（可能/或许/有望…）时收敛为 uncertain。
      const polarity = UNCERTAIN_HINT.test(fragment) ? 'uncertain' : pattern.re === CLAIM_PATTERNS[2].re ? 'negative' : 'positive'
      rows.push({ subjectPhrase: subject, objectPhrase: object, relation: pattern.re === CLAIM_PATTERNS[2].re ? 'inhibits' : relationOf(pattern), polarity })
      break
    }
  }
  return rows
}

function relationOf(pattern) {
  return pattern.relation
}

// ── 引导句式 ──────────────────────────────────────────────────────────────────

function stripLeadingMarker(sentence) {
  const text = sentence.trim().replace(SUBJECT_PREFIX, '')
  const attempt = (regex, kind, keepFull = false) => {
    const match = regex.exec(text)
    if (!match) return null
    // 方法句的标记（采用…方法）本身含工具名，整句保留；其余句式剥离引导词。
    const clause = keepFull ? text : text.slice(match[0].length).replace(/^[，,：:、\s]+/, '')
    return clause.length >= 4 ? { kind, clause } : null
  }
  return attempt(FINDING_MARKER, 'finding')
    || attempt(HYPOTHESIS_MARKER, 'hypothesis')
    || attempt(QUESTION_MARKER, 'question')
    || attempt(METHOD_MARKER, 'method', true)
}

function isQuestionSentence(sentence) {
  return /[？?]/.test(sentence) && QUESTION_HINT.test(sentence)
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

function stripMarkdownForClaims(text) {
  return String(text || '')
    .replace(MARKDOWN_CODE_BLOCK, ' ')
    .replace(MARKDOWN_INLINE_CODE, '$1')
    .replace(MARKDOWN_BOLD, '$1')
    .replace(MARKDOWN_ITALIC, '$1')
    .replace(MARKDOWN_HEADING, '')
    .replace(MARKDOWN_LIST, '')
    .replace(MARKDOWN_LINK, '$1')
}

// 从一条助手回答提取知识结构。确定性与有界性是本函数的契约：
//   - 同一文本两次调用返回 deepEqual 的结果；
//   - 节点 ≤ 24、关系 ≤ 24、引用 ≤ 8，超限按出现顺序截断（关系在节点截断后丢弃失端者）。
export function extractKnowledge(rawText) {
  const text = String(rawText || '')
  if (!text.trim()) return { nodes: [], claims: [], citations: [] }
  const citations = extractCitations(text)
  const clean = stripMarkdownForClaims(text)
  const sentences = clean.split(SENTENCE_SPLIT).map(part => part.trim()).filter(part => part.length >= 4)

  const nodes = new Map()
  const claims = []
  const addNode = (kind, entityKind, label, excerpt) => {
    const cleanLabel = clampKnowledgeLabel(label)
    if (!cleanLabel) return null
    const key = knowledgeKeyFor(kind, entityKind, cleanLabel)
    if (!nodes.has(key)) nodes.set(key, { key, kind, entityKind: kind === 'entity' ? entityKind : '', label: cleanLabel, excerpt: clampExcerpt(excerpt) })
    return key
  }
  const addClaim = row => {
    if (!row || !row.fromKey || !row.toKey || row.fromKey === row.toKey) return
    if (claims.some(item => item.fromKey === row.fromKey && item.toKey === row.toKey && item.relation === row.relation)) return
    claims.push({ ...row, excerpt: clampExcerpt(row.excerpt) })
  }

  for (const sentence of sentences) {
    const marked = stripLeadingMarker(sentence)
    const clause = marked ? marked.clause : sentence
    let claimEntityKeys = []
    for (const found of extractClaimsFromClause(clause).slice(0, 6)) {
      const subject = expandEntityPhrase(found.subjectPhrase)
      const object = expandEntityPhrase(found.objectPhrase)
      if (!subject.endpoint || !object.endpoint) continue
      for (const entity of [...subject.entities, ...object.entities]) addNode('entity', entity.entityKind, entity.label, sentence)
      addClaim({ fromKey: subject.endpoint, toKey: object.endpoint, relation: found.relation, polarity: found.polarity, excerpt: sentence })
      for (const extra of [...subject.extras, ...object.extras]) addClaim({ ...extra, excerpt: sentence })
      claimEntityKeys = [...claimEntityKeys, subject.endpoint, object.endpoint, ...subject.extras.map(item => item.fromKey), ...object.extras.map(item => item.fromKey)]
    }
    if (marked) {
      const key = addNode(marked.kind, '', clause, sentence)
      // 发现/假设/问题节点与该句关系涉及的实体相连（最多 3 个），否则知识节点会悬浮成孤岛。
      for (const entityKey of [...new Set(claimEntityKeys)].slice(0, 3)) addClaim({ fromKey: key, toKey: entityKey, relation: 'about', polarity: 'neutral', excerpt: sentence })
    } else if (isQuestionSentence(sentence)) {
      addNode('question', '', sentence, sentence)
    }
  }

  const limitedNodes = [...nodes.values()].slice(0, MAX_NODES_PER_MESSAGE)
  const presentKeys = new Set(limitedNodes.map(node => node.key))
  const limitedClaims = claims
    .filter(claim => presentKeys.has(claim.fromKey) && presentKeys.has(claim.toKey))
    .slice(0, MAX_CLAIMS_PER_MESSAGE)
  return { nodes: limitedNodes, claims: limitedClaims, citations: citations.slice(0, MAX_CITATIONS_PER_MESSAGE) }
}

function clampExcerpt(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.length > MAX_EXCERPT_CHARS ? `${text.slice(0, MAX_EXCERPT_CHARS - 1)}…` : text
}

// 入库前的节点/关系规范化（knowledge-store 复用）：非法条目由调用方跳过并计数。
export function normalizeKnowledgeNodeDraft(input = {}) {
  const kind = KNOWLEDGE_KINDS.includes(input.kind) ? input.kind : ''
  const label = clampKnowledgeLabel(input.label)
  if (!kind || !label) throw new Error('知识节点缺少类型或标签。')
  const entityKind = kind === 'entity' ? (KNOWLEDGE_ENTITY_KINDS.includes(input.entityKind) ? input.entityKind : 'generic') : ''
  return {
    key: input.key || knowledgeKeyFor(kind, entityKind, label),
    kind, entityKind, label,
    excerpt: clampExcerpt(input.excerpt),
  }
}

export function normalizeKnowledgeClaimDraft(input = {}) {
  const relation = String(input.relation || '').trim()
  const polarity = KNOWLEDGE_POLARITIES.includes(input.polarity) ? input.polarity : 'neutral'
  if (!relation || relation.length > 40) throw new Error('知识关系缺少类型。')
  if (!input.fromKey || !input.toKey) throw new Error('知识关系缺少端点。')
  return { fromKey: String(input.fromKey), toKey: String(input.toKey), relation, polarity, excerpt: clampExcerpt(input.excerpt) }
}
