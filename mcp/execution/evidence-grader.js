// 自动规则只检查来源线索是否缺失，不能由标识符类型或断言措辞推定证据强度。
function gradeEvidence(entry) {
  const identifierType = String(entry.identifier_type || 'none').trim().toLowerCase()
  const hasIdentifier = identifierType !== 'none' && Boolean(String(entry.identifier || '').trim())
  const hasUrl = Boolean(String(entry.url || '').trim())

  if (!hasIdentifier && !hasUrl) {
    return {
      grade: 'missing',
      confidence: 0.9,
      reasoning: '缺少来源标识符和链接，无法追溯原文；这不代表研究结论已被否定。',
    }
  }

  return {
    grade: 'ungraded',
    confidence: 0.3,
    reasoning: '已提供来源标识符或链接，但未据此核验来源、研究类型或结论支持性。标识符、核验状态及措辞均不能单独证明实证或推论等级，需人工核验原文后分级。',
  }
}

function gradeLabel(grade) {
  return { empirical: '实证', inference: '推论', missing: '缺失', ungraded: '未分级' }[grade] || grade
}

export { gradeEvidence, gradeLabel }
