// 受控二级主题与检索维度。规则命中是内容索引建议，不是来源或结论核验。
export const RESEARCH_TOPIC_RULES = [
  { primary: '作物遗传育种', secondary: '雄性不育', pattern: /雄性不育|不育系|male.steril|pollen.steril|NP1|IPE1/i },
  { primary: '作物遗传育种', secondary: '抗逆性状', pattern: /耐盐|抗旱|盐胁迫|抗病|stress.toleran|salt.toleran|drought/i },
  { primary: '作物遗传育种', secondary: '产量性状', pattern: /产量|粒重|穗长|yield|grain.weight/i },
  { primary: '分子机制', secondary: '基因功能', pattern: /基因功能|候选基因|突变体|gene.function|candidate.gene|mutant/i },
  { primary: '分子机制', secondary: '表达调控', pattern: /表达量|基因表达|转录因子|调控网络|gene.expression|transcription.factor/i },
  { primary: '生物信息学', secondary: '单细胞分析', pattern: /单细胞|single.cell|scRNA/i },
  { primary: '生物信息学', secondary: '转录组分析', pattern: /转录组|RNA.seq|transcriptom/i },
  { primary: '临床研究', secondary: '临床试验', pattern: /临床试验|随机对照|clinical.trial|randomized.controlled/i },
  { primary: '研究方法', secondary: '系统综述', pattern: /系统综述|荟萃分析|systematic.review|meta.analysis/i },
  { primary: '研究方法', secondary: '统计分析', pattern: /统计模型|回归分析|置信区间|regression|confidence.interval/i },
]

export const RESEARCH_TOPIC_OPTIONS = [...new Map(RESEARCH_TOPIC_RULES.map(rule =>
  [`${rule.primary}/${rule.secondary}`, { primary: rule.primary, secondary: rule.secondary }])).values()]

export function isControlledResearchTopic(primary, secondary) {
  return RESEARCH_TOPIC_OPTIONS.some(item => item.primary === primary && item.secondary === secondary)
}

const FACET_RULES = {
  organism: [
    ['大麦', /大麦|barley|hordeum/i], ['水稻', /水稻|rice|oryza/i],
    ['小麦', /小麦|wheat|triticum/i], ['玉米', /玉米|maize|zea.mays/i],
  ],
  method: [
    ['RNA-seq', /RNA.seq|转录组测序/i], ['CRISPR', /CRISPR|基因编辑/i],
    ['GWAS', /GWAS|全基因组关联/i], ['系统综述', /systematic.review|系统综述/i],
  ],
}

export function inferResearchClassification(text) {
  const source = String(text || '').slice(0, 8000)
  return {
    topics: RESEARCH_TOPIC_RULES.filter(rule => rule.pattern.test(source)).map(rule => ({
      primary: rule.primary, secondary: rule.secondary, confidence: 'rule-match', source: 'local-rule',
    })),
    facets: Object.fromEntries(Object.entries(FACET_RULES).map(([name, rules]) =>
      [name, rules.filter(([, pattern]) => pattern.test(source)).map(([label]) => label)])),
    reviewed: false,
  }
}

export function normalizeResearchClassification(value, text = '') {
  if (!value || value.reviewed !== true) return inferResearchClassification(text)
  return {
    topics: (Array.isArray(value.topics) ? value.topics : []).slice(0, 12).map(item => ({
      primary: String(item.primary || '').slice(0, 80), secondary: String(item.secondary || '').slice(0, 80),
      confidence: 'human', source: 'researcher',
    })).filter(item => item.primary && item.secondary),
    facets: value.facets && typeof value.facets === 'object' ? value.facets : {},
    reviewed: true,
  }
}
