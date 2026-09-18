
import { wrap } from './wrapper.js'

const REDUNDANCY_MARKERS = [
  { pattern: /(.)\1{2,}/g, label: '字符重复', description: '同一字符连续出现 3 次以上' },
  { pattern: /(\b\w+\b)(\s+\1\b){2,}/gi, label: '词语重复', description: '同一词语在短距离内重复出现 3 次以上' },
  { pattern: /(?:非常){2,}/g, label: '程度副词堆叠', description: '"非常"连用可能是不必要的强调' },
  { pattern: /(\b(?:also|additionally|furthermore|moreover|in addition)\b.*\b(?:also|additionally|furthermore|moreover|in addition)\b)/gi, label: '连接词冗余', description: '同一段落内重复使用同类递进连接词' },
]

const CONTRADICTION_PAIRS = [
  { a: /\b(?:increase|increased|higher|improve[ds]?)\b/i, b: /\b(?:decrease|decreased|lower|reduce[ds]?|diminish\w*)\b/i, label: '方向矛盾', description: '同一段落同时声称增加和减少' },
  { a: /\b(?:significant|significantly)\b/i, b: /\b(?:no effect|not significant|no significant|no difference)\b/i, label: '显著性矛盾', description: '同时声称显著和不显著' },
  { a: /\b(?:novel|first|new)\b/i, b: /\b(?:previously reported|known|established)\b/i, label: '新颖性矛盾', description: '同时声称首创和已知' },
  { a: /\b(?:proves?|proven|confirmed)\b/i, b: /\b(?:suggests?|may|might|possibly|hypoth\w+)\b/i, label: '确定性矛盾', description: '同时使用确定性语言和推测性语言' },
  { a: /\b(?:outperform|superior|better than)\b/i, b: /\b(?:comparable|similar to|no significant difference)\b/i, label: '优越性矛盾', description: '同时声称优于和等同于对照组' },
]

const SILENCE_PATTERNS = [
  { pattern: /(?:limitation|limitazione|drawback|caveat|局限性|不足|局限)/i, label: '局限性提及', description: '检测到局限性讨论', isGood: true },
  { pattern: /(?:replication|reproducib|replicat)/i, label: '可重复性提及', description: '检测到可重复性讨论', isGood: true },
  { pattern: /(?:fail|failed|negative result|no significant|阴性结果|未显著)/i, label: '阴性结果', description: '包含阴性结果讨论', isGood: true },
  { pattern: /(?:conflict of interest|competing interest|COI|利益冲突)/i, label: '利益冲突声明', description: '包含利益冲突声明', isGood: true },
]

const MISSING_ELEMENTS = [
  { key: 'sample_size', pattern: /\b(?:n\s*=|sample size|participants|subjects|N\s*=)\b/i, label: '样本量', description: '未提及样本量或实验对象数量' },
  { key: 'statistical_test', pattern: /\b(?:p\s*[<=]|t-test|ANOVA|chi-square|regression|confidence interval|CI\b)/i, label: '统计方法', description: '未提及具体统计检验方法' },
  { key: 'limitation', pattern: SILENCE_PATTERNS[0].pattern, label: '局限性讨论', description: '未讨论研究局限性' },
  { key: 'data_availability', pattern: /\b(?:data availab|supplementary|additional file|github|zenodo|osf\.io)\b/i, label: '数据可得性', description: '未提供数据获取方式' },
  { key: 'ethical_approval', pattern: /\b(?:ethic|IRB|consent|approval number)\b/i, label: '伦理声明', description: '未提及伦理审批或知情同意（如涉及人类/动物实验）' },
]

const MAX_FINDINGS = 30

function detectAnomalies(text) {
  const raw = String(text || '')
  if (raw.length < 50) {
    return {
      findings: [],
      presentElements: [],
      missingElements: [],
      summary: { text_length: raw.length, total_anomalies: 0, contradictions: 0, redundancies: 0, present_good_practices: 0, missing_elements: 0, message: '文本过短，无法进行有效分析。' },
    }
  }

  const findings = []

  for (const marker of REDUNDANCY_MARKERS) {
    marker.pattern.lastIndex = 0
    let match
    while ((match = marker.pattern.exec(raw)) !== null) {
      const context = raw.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40).replace(/\s+/g, ' ').trim()
      findings.push({
        type: 'redundancy',
        label: marker.label,
        description: marker.description,
        matched: match[0].slice(0, 60),
        position: match.index,
        context: context.slice(0, 160),
        severity: 'advisory',
      })
      if (findings.length >= MAX_FINDINGS) break
    }
    if (findings.length >= MAX_FINDINGS) break
  }

  const paragraphs = raw.split(/\n\s*\n|(?<=[.。])\s+(?=[A-Z\u4e00-\u9fff])/)
  for (const pair of CONTRADICTION_PAIRS) {
    for (const para of paragraphs) {
      if (para.length < 20) continue
      if (pair.a.test(para) && pair.b.test(para)) {
        findings.push({
          type: 'contradiction',
          label: pair.label,
          description: pair.description,
          matched: para.slice(0, 100),
          position: raw.indexOf(para),
          context: para.replace(/\s+/g, ' ').trim().slice(0, 160),
          severity: 'high-warn',
        })
        break
      }
    }
  }

  const presentElements = SILENCE_PATTERNS.filter(sp => sp.pattern.test(raw)).map(sp => ({
    type: 'present', label: sp.label, description: sp.description,
  }))

  const missingElements = MISSING_ELEMENTS.filter(me => !me.pattern.test(raw)).map(me => ({
    type: 'missing', label: me.label, description: me.description, severity: 'advisory',
  }))

  const summary = {
    text_length: raw.length,
    total_anomalies: findings.filter(f => f.type !== 'present').length,
    contradictions: findings.filter(f => f.type === 'contradiction').length,
    redundancies: findings.filter(f => f.type === 'redundancy').length,
    present_good_practices: presentElements.length,
    missing_elements: missingElements.length,
  }

  return { findings, presentElements, missingElements, summary }
}

async function detectTextAnomalies(text) {
  const result = detectAnomalies(text)
  return wrap(result, {
    source: 'anomaly-detector',
    confidence: 'cached',
    disclaimer: '异常检测基于模式匹配，不能替代人工审查。矛盾检测和沉默区分析为辅助信号。',
  })
}

export { detectTextAnomalies, detectAnomalies }
