
import { wrap } from './wrapper.js'

const PROTECTED_PATTERNS = [
  { category: 'epistemic_hedge', patterns: [/\b(?:may|might|could)\b/gi, /\b(?:tentative|preliminary|exploratory)\b/gi, /\b(?:suggests?|indicates?|is consistent with)\b/gi], fix: '删除等同于静默升级声明强度' },
  { category: 'scope_hedge', patterns: [/\b(?:in (?:our|this) sample|for this cohort|under (?:the )?conditions tested)\b/gi], fix: '删除等同于扩大适用范围' },
  { category: 'epistemic_hedge', patterns: [/可能/g, /或许/g, /初步的/g, /暗示/g, /提示/g, /在本样本中/g], fix: '删除等同于静默升级声明强度' },
  { category: 'negative_boundary', patterns: [/\b(?:did not (?:reach|show)|was not significant|no significant difference)\b/gi], fix: '删除等同于删除阴性结果' },
]

function checkHedging(text) {
  const raw = String(text || '')
  if (raw.length < 20) return { hedging_phrases: [], total: 0 }
  const found = []
  for (const group of PROTECTED_PATTERNS) {
    for (const pattern of group.patterns) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(raw)) !== null) {
        found.push({
          phrase: match[0],
          category: group.category,
          position: match.index,
          context: raw.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40).replace(/\s+/g, ' ').trim().slice(0, 160),
          warning: group.fix,
        })
      }
    }
  }
  found.sort((a, b) => a.position - b.position)
  return { hedging_phrases: found, total: found.length }
}

async function checkHedgingPhrases(text) {
  const result = checkHedging(text)
  return wrap(result, {
    source: 'hedging-phrases',
    confidence: 'cached',
    disclaimer: '这些短语受预算保护——修改或压缩摘要时不得静默删除。删除等同于改变论文的认识论立场。',
  })
}

export { checkHedgingPhrases, checkHedging }
