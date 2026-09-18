
import { wrap } from './wrapper.js'

const FLAGGED_TERMS = [
  { term: 'delve', why: 'Overused "explore" substitute', alternatives: 'examine, investigate, analyze, explore' },
  { term: 'tapestry', why: 'Cliché metaphor', alternatives: 'network, interplay, system, landscape' },
  { term: 'landscape', why: 'Vague when not literal', alternatives: 'field, domain, context, state of' },
  { term: 'pivotal', why: 'Inflation of importance', alternatives: 'important, significant, central, key' },
  { term: 'crucial', why: 'Same as pivotal', alternatives: 'essential, necessary, critical, vital' },
  { term: 'foster', why: 'Vague verb', alternatives: 'promote, develop, cultivate, encourage' },
  { term: 'showcase', why: 'Non-academic register', alternatives: 'demonstrate, illustrate, present, reveal' },
  { term: 'testament', why: 'Cliché', alternatives: 'evidence, indicator, demonstration' },
  { term: 'navigate', why: 'Vague when not literal', alternatives: 'manage, address, handle, negotiate' },
  { term: 'leverage', why: 'Business jargon', alternatives: 'use, employ, utilize, apply' },
  { term: 'realm', why: 'Archaic/poetic', alternatives: 'domain, field, area, sphere' },
  { term: 'embark', why: 'Overwrought for "begin"', alternatives: 'begin, initiate, undertake, start' },
  { term: 'underscore', why: 'Overused emphasis verb', alternatives: 'emphasize, highlight, stress, reinforce' },
  { term: 'multifaceted', why: 'Vague complexity claim', alternatives: 'complex, varied, diverse, multilayered' },
  { term: 'nuanced', why: 'Often vacuous', alternatives: 'subtle, detailed, fine-grained, qualified' },
  { term: 'comprehensive', why: 'Often unjustified', alternatives: 'thorough, extensive, broad, detailed' },
  { term: 'robust', why: 'Vague quality claim', alternatives: 'reliable, strong, rigorous, resilient' },
  { term: 'intricate', why: 'Same as multifaceted', alternatives: 'complex, detailed, elaborate, involved' },
  { term: 'cornerstone', why: 'Cliché metaphor', alternatives: 'foundation, basis, core element, pillar' },
  { term: 'paradigm', why: 'Overused outside philosophy of science', alternatives: 'framework, model, approach' },
  { term: 'synergy', why: 'Business jargon', alternatives: 'interaction, cooperation, combined effect' },
  { term: 'holistic', why: 'Vague without definition', alternatives: 'comprehensive, integrated, whole-system' },
  { term: 'streamline', why: 'Non-academic', alternatives: 'simplify, optimize, improve efficiency' },
  { term: 'cutting-edge', why: 'Cliché', alternatives: 'recent, advanced, state-of-the-art, novel' },
  { term: 'groundbreaking', why: 'Inflation', alternatives: 'novel, innovative, pioneering, original' },
]

const THROAT_CLEARING = [
  { phrase: 'in the realm of', fix: 'Delete. Start with the actual subject' },
  { phrase: "it's important to note that", fix: 'Delete. The content speaks for itself' },
  { phrase: 'it is worth mentioning that', fix: 'Delete. Same as above' },
  { phrase: "in today's rapidly evolving", fix: 'Delete. Timestamped cliché' },
  { phrase: 'this serves as a testament to', fix: 'Replace with direct claim' },
  { phrase: 'it goes without saying that', fix: 'If it goes without saying, don\'t say it' },
  { phrase: 'in order to', fix: 'Replace with "To"' },
  { phrase: 'it should be noted that', fix: 'Delete. Just note it' },
  { phrase: 'as a matter of fact', fix: 'Delete. State the fact' },
  { phrase: 'when it comes to', fix: 'Replace with the subject directly' },
  { phrase: 'at the end of the day', fix: 'Delete. Colloquial and vague' },
  { phrase: 'with that being said', fix: 'Delete or use "However"' },
  { phrase: 'this section will discuss', fix: 'Just discuss it' },
  { phrase: 'the following paragraph examines', fix: 'Just examine it' },
  { phrase: 'we now turn our attention to', fix: 'Just turn to it' },
]

const EXCEPTION_TERMS = new Set([
  'paradigm shift', 'robust estimator', 'robust regression',
])

const CJK_FLAGGED_TERMS = [
  { term: '众所周知', why: '空洞的引导语，不提供新信息', alternatives: '直接引用具体来源' },
  { term: '不言而喻', why: '如果真的不言而喻就不需要说', alternatives: '直接陈述论据' },
  { term: '毋庸置疑', why: '过度自信，削弱论证严谨性', alternatives: '提供证据后让读者自行判断' },
  { term: '日益增长', why: '泛化的趋势描述，缺乏数据支撑', alternatives: '引用具体增长率或统计数据' },
  { term: '广泛的应用前景', why: '空泛的贡献声明', alternatives: '描述具体应用场景和目标用户' },
  { term: '具有重要意义', why: '意义需要论证而非声明', alternatives: '用具体数据或案例说明重要性' },
  { term: '取得了显著进展', why: '进展的幅度和方向不明确', alternatives: '具体说明在哪个方向取得了什么进展' },
  { term: '引起广泛关注', why: '关注来源和程度模糊', alternatives: '引用具体的后续研究或引用数据' },
  { term: '深入研究', why: '过度使用的研究动词', alternatives: '系统考察、定量分析、实证检验' },
  { term: '可见一斑', why: '比喻模糊，不精确', alternatives: '直接说明这说明什么' },
]

const CJK_THROAT_CLEARING = [
  { phrase: '在本研究中', fix: '删除。直接开始叙述研究内容' },
  { phrase: '下面将讨论', fix: '删除。直接讨论' },
  { phrase: '以下内容将探讨', fix: '删除。直接探讨' },
  { phrase: '本文将着重讨论', fix: '删除。直接讨论' },
  { phrase: '众所周知', fix: '删除或引用具体来源' },
  { phrase: '不言而喻', fix: '删除。直接陈述论据' },
  { phrase: '值得注意的是', fix: '删除。直接指出值得注意的内容' },
  { phrase: '需要指出的是', fix: '删除。直接指出' },
  { phrase: '综上所述', fix: '改为具体结论句。仅限结论节使用' },
]

function checkQuality(text) {
  const raw = String(text || '')
  if (raw.length < 100) {
    return {
      flagged_terms: [], throat_clearing: [], punctuation_issues: [],
      summary: { text_length: raw.length, message: '文本过短，无法进行有效质量检查。' },
    }
  }

  const lower = raw.toLowerCase()
  const flaggedTerms = []
  for (const item of FLAGGED_TERMS) {
    const pattern = new RegExp(`\\b${item.term.replace(/-/g, '[ -]')}\\b`, 'gi')
    const matches = raw.match(pattern)
    if (matches) {
      const isException = EXCEPTION_TERMS.has(item.term) ||
        (item.term === 'paradigm' && /paradigm\s+shift/i.test(raw)) ||
        (item.term === 'robust' && /robust\s+(estimator|regression|method)/i.test(raw)) ||
        (item.term === 'landscape' && /landscape\s+(ecology|architecture|genomics)/i.test(raw))
      if (!isException) {
        flaggedTerms.push({
          term: item.term, count: matches.length,
          why: item.why, alternatives: item.alternatives,
        })
      }
    }
  }

  const throatClearing = []
  for (const item of THROAT_CLEARING) {
    const index = lower.indexOf(item.phrase)
    if (index >= 0) {
      throatClearing.push({
        phrase: item.phrase, position: index, fix: item.fix,
        context: raw.slice(Math.max(0, index - 30), index + item.phrase.length + 30).replace(/\s+/g, ' ').trim().slice(0, 120),
      })
    }
  }

  const cjkFlagged = []
  for (const item of CJK_FLAGGED_TERMS) {
    const count = (raw.match(new RegExp(item.term, 'g')) || []).length
    if (count > 0) cjkFlagged.push({ term: item.term, count, why: item.why, alternatives: item.alternatives })
  }

  const cjkThroat = []
  for (const item of CJK_THROAT_CLEARING) {
    const index = raw.indexOf(item.phrase)
    if (index >= 0) {
      cjkThroat.push({
        phrase: item.phrase, position: index, fix: item.fix,
        context: raw.slice(Math.max(0, index - 30), index + item.phrase.length + 30).replace(/\s+/g, ' ').trim().slice(0, 120),
      })
    }
  }

  const punctuationIssues = []
  const emDashCount = (raw.match(/—|--/g) || []).length
  if (emDashCount > raw.split(/[.。]/).length * 0.3) {
    punctuationIssues.push({ type: 'em-dash', count: emDashCount, note: '破折号使用频率偏高，检查是否打断论证' })
  }
  const semicolonCount = (raw.match(/;/g) || []).length
  const sentences = raw.split(/[.。!?！？]/).filter(s => s.trim()).length
  if (sentences > 0 && semicolonCount / sentences > 0.15) {
    punctuationIssues.push({ type: 'semicolon', count: semicolonCount, note: '分号使用频率偏高，检查句子是否过载' })
  }

  const wordCounts = raw.split(/[.。!?！？]+/).filter(s => s.trim().split(/\s+/).length > 3).map(s => s.trim().split(/\s+/).length)
  const avgSentenceLength = wordCounts.length ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length) : 0
  const longSentences = wordCounts.filter(w => w > 40).length

  const summary = {
    text_length: raw.length,
    word_count: raw.split(/\s+/).filter(Boolean).length,
    flagged_term_count: flaggedTerms.reduce((a, b) => a + b.count, 0) + cjkFlagged.reduce((a, b) => a + b.count, 0),
    unique_flagged_terms: flaggedTerms.length + cjkFlagged.length,
    throat_clearing_count: throatClearing.length + cjkThroat.length,
    punctuation_issue_count: punctuationIssues.length,
    avg_sentence_length: avgSentenceLength,
    long_sentences_over_40_words: longSentences,
  }

  return {
    flagged_terms: [...flaggedTerms, ...cjkFlagged],
    throat_clearing: [...throatClearing, ...cjkThroat],
    punctuation_issues: punctuationIssues,
    summary,
  }
}

async function checkWritingQuality(text) {
  const result = checkQuality(text)
  return wrap(result, {
    source: 'writing-quality-check',
    confidence: 'cached',
    disclaimer: '基于规则匹配的辅助信号，不是人类化工具。判断权在作者和目标期刊。学科标准术语豁免需人工确认。',
  })
}

export { checkWritingQuality, checkQuality }
