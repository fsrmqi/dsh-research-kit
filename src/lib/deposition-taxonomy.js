// 只用本地、可解释的词表归类；不调用模型，不把原始回答交给外部服务。
// 分类不是事实核验，多个主题可并存，未命中时明确留在「待归类」。
export const DEPOSITION_TOPIC_RULES = [
  { topic: '植物科学', pattern: /水稻|小麦|玉米|拟南芥|作物|植物|盐胁迫|耐盐|抗旱|产量|rice|wheat|maize|arabidopsis|crop|plant\b/i },
  { topic: '基因与分子', pattern: /基因|蛋白|转录因子|表达量|突变|变异|基因组|转录组|gene\b|protein|genom|transcript|mutation|variant/i },
  { topic: '临床医学', pattern: /临床|患者|疾病|肿瘤|治疗|药物|队列|诊断|clinical|patient|disease|cancer|therapy|drug|cohort/i },
  { topic: '生物信息', pattern: /单细胞|测序|生物信息|组学|批次效应|空间转录|single.cell|sequenc|bioinform|omics|batch.effect/i },
  { topic: '统计与方法', pattern: /统计|回归|显著性|置信区间|随机对照|荟萃分析|系统综述|方法学|statistic|regression|confidence.interval|randomized|meta.analysis|systematic.review/i },
  { topic: '文献与证据', pattern: /文献|引用|DOI|PMID|arXiv|证据等级|参考文献|literature|citation|evidence/i },
]

export const UNCLASSIFIED_TOPIC = '待归类'
const TOPIC_PREFIX = '主题:'
const KIND_TAGS = { question: '研究问题', hypothesis: '待验证假设', finding: '研究发现', method: '研究方法' }

export function inferDepositionTopics(text) {
  const source = String(text || '').slice(0, 8000)
  return DEPOSITION_TOPIC_RULES.filter(rule => rule.pattern.test(source)).map(rule => rule.topic)
}

export function autoDepositionTags({ text = '', kind = '', identifierKind = '' } = {}) {
  const tags = ['自动沉淀', ...(KIND_TAGS[kind] ? [KIND_TAGS[kind]] : [])]
  for (const topic of inferDepositionTopics(text)) tags.push(`${TOPIC_PREFIX}${topic}`)
  if (identifierKind && identifierKind !== 'none') tags.push(`来源:${String(identifierKind).toUpperCase()}`)
  return [...new Set(tags)].slice(0, 10)
}

// 新条目读已保存的主题标签；旧条目仅在视图中推导，不修改其人工标签或备份。
export function topicForDepositedItem(item) {
  const tags = Array.isArray(item?.tags) ? item.tags : []
  const saved = tags.find(tag => String(tag).startsWith(TOPIC_PREFIX))
  if (saved) return saved.slice(TOPIC_PREFIX.length)
  return inferDepositionTopics(`${item?.title || ''} ${item?.body || ''} ${item?.reason || ''} ${item?.note || ''}`)[0] || UNCLASSIFIED_TOPIC
}

export function visibleDepositionTags(item) {
  const saved = Array.isArray(item?.tags) ? item.tags : []
  if (saved.some(tag => String(tag).startsWith(TOPIC_PREFIX))) return saved
  const inferred = inferDepositionTopics(`${item?.title || ''} ${item?.body || ''} ${item?.reason || ''} ${item?.note || ''}`)
  return [...saved, ...inferred.map(topic => `${TOPIC_PREFIX}${topic}`)]
}

export function groupDepositedItems(items) {
  const groups = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const topic = topicForDepositedItem(item)
    if (!groups.has(topic)) groups.set(topic, [])
    groups.get(topic).push(item)
  }
  const order = DEPOSITION_TOPIC_RULES.map(rule => rule.topic)
  return [...groups].sort(([a], [b]) => {
    const ai = order.indexOf(a), bi = order.indexOf(b)
    return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi)
  }).map(([topic, rows]) => ({ topic, rows }))
}
