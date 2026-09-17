
const PEER_REVIEWED_TYPES = new Set(['doi', 'pmid', 'pmcid', 'nct'])
const INFERENCE_KEYWORDS = ['可能', '暗示', '推测', '或许', '大概', 'may', 'might', 'suggest', 'imply', 'infer', 'possibly', 'likely', 'presumably', 'hypothesize']
const STRONG_CLAIM_KEYWORDS = ['证明', '证实', '结果表明', 'conclude', 'demonstrate', 'confirm', 'prove', 'show that', 'establish']

function gradeEvidence(entry) {
  const identifierType = entry.identifier_type || 'none'
  const hasIdentifier = identifierType !== 'none' && entry.identifier
  const note = String(entry.note || '')
  const title = String(entry.title || '')
  const searchText = `${note} ${title}`.toLowerCase()

  const hasInferenceLanguage = INFERENCE_KEYWORDS.some(kw => searchText.includes(kw))
  const hasStrongClaim = STRONG_CLAIM_KEYWORDS.some(kw => searchText.includes(kw))

  if (!hasIdentifier && !entry.url) {
    return {
      grade: 'missing',
      confidence: 0.9,
      reasoning: '缺少稳定标识符和来源链接，无法追溯原文，不满足证据保存的最低要求。',
    }
  }

  if (PEER_REVIEWED_TYPES.has(identifierType) && hasIdentifier && !hasInferenceLanguage) {
    return {
      grade: 'empirical',
      confidence: hasStrongClaim ? 0.85 : 0.7,
      reasoning: `来源有可验证的 ${identifierType.toUpperCase()} 标识符，内容无推断性用语，可直接追溯原文。`,
    }
  }

  if (hasIdentifier && hasInferenceLanguage) {
    return {
      grade: 'inference',
      confidence: 0.6,
      reasoning: '来源有标识符可追溯，但内容包含推断性用语（如"可能""暗示"），应标注为推论而非实证。',
    }
  }

  if (entry.url && !hasIdentifier) {
    return {
      grade: 'inference',
      confidence: 0.5,
      reasoning: '仅有 URL 链接，缺少稳定学术标识符（DOI/PMID），可追溯性弱于实证级来源。',
    }
  }

  return {
    grade: 'missing',
    confidence: 0.7,
    reasoning: '来源标识符或链接不完整，无法确认证据来源的可靠性。',
  }
}

function gradeLabel(grade) {
  return { empirical: '实证', inference: '推论', missing: '缺失', ungraded: '未分级' }[grade] || grade
}

export { gradeEvidence, gradeLabel }
