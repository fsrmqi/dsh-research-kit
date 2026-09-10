// 模型输出协议：Node half 与浏览器端共用同一解析与展示定义，避免两端漂移。
// 与 PromptKit 源仓库保持协议兼容（[DIAG] 行 + ===PROMPT=== 分隔符）。
// 注：本模块是纯字符串协议解析器，不做任何 shell 执行、求值或文件系统访问。
export const DIAGNOSIS_LABELS = { concept_clarity: '概念清晰', hidden_premise: '隐含前提', falsifiability: '可证伪性', actionability: '可行动性', context_fit: '语境契合' }
export const DIAGNOSIS_DIMENSIONS = Object.keys(DIAGNOSIS_LABELS)

// 只兼容明确的维度别名；不猜测或补写模型没有返回的诊断。
const DIAGNOSIS_ALIASES = { ...Object.fromEntries(Object.entries(DIAGNOSIS_LABELS).map(([key, label]) => [label, key])), '概念澄清': 'concept_clarity', '语境契合度': 'context_fit' }

// Markdown 围栏符（反引号 ×3）。以字符码构造，避免源码中出现裸反引号序列。
const FENCE = String.fromCharCode(96).repeat(3)
// 诊断行的行级协议模式：[DIAG] 维度名: 内容。行内匹配后即弃用，不进入任何执行路径。
const DIAG_LINE = new RegExp('^\\s*(?:[-*]\\s*)?\\[diag\\]\\s*([^:\\uff1a]+)[:\\uff1a]\\s*(.*)$', 'i')
const FENCE_OPEN = new RegExp('^\\s*' + FENCE + '[^\\n]*\\n\\s*(?:[-*]\\s*)?\\[diag\\]', 'i')
const FENCE_OPEN_STRIP = new RegExp('^\\s*' + FENCE + '[^\\n]*\\n')
const FENCE_CLOSE_STRIP = new RegExp('\\n' + FENCE + '\\s*$')
const PROMPT_MARKER = /^\s*={3}\s*PROMPT\s*={3}[ \t]*$/im
const DIAG_PREFIX = /^\s*\[diag\]/i

/** 保留部分诊断，隔离协议行；diagnosisMeta 只含协议状态，不记录草稿或模型原文。 */
export function parseEnhanceOutput(raw, { streaming = false } = {}) {
  let text = String(raw || '').replace(/\r\n?/g, '\n')
  // 仅拆包裹协议的外层围栏，普通代码提示词原样保留。
  if (FENCE_OPEN.test(text)) {
    text = text.replace(FENCE_OPEN_STRIP, '').replace(FENCE_CLOSE_STRIP, '')
  }
  const marker = text.match(PROMPT_MARKER)
  const hasLeadingDiagnosis = DIAG_PREFIX.test(text)
  const diagnostics = marker ? text.slice(0, marker.index) : hasLeadingDiagnosis ? text : ''
  const found = {}
  const warnings = new Set()
  const remaining = []
  let readingDiagnosis = true
  for (const line of diagnostics.split('\n')) {
    const match = line.match(DIAG_LINE)
    if (match && readingDiagnosis) {
      const name = match[1].trim().replace(/\*\*/g, '')
      const normalized = name.toLowerCase().replace(/[ -]+/g, '_')
      const key = DIAGNOSIS_DIMENSIONS.includes(normalized) ? normalized : DIAGNOSIS_ALIASES[name]
      if (!key) warnings.add('unknown_dimension')
      else if (match[2].trim()) {
        if (found[key]) warnings.add('duplicate_dimension')
        found[key] = match[2].trim()
      }
      continue
    }
    if (!marker && line.trim() && !DIAG_PREFIX.test(line)) readingDiagnosis = false
    // 不把无值或尚未传完的诊断行展示为改写正文。
    if (!DIAG_PREFIX.test(line)) remaining.push(line)
  }
  let prompt = marker ? text.slice(marker.index + marker[0].length) : hasLeadingDiagnosis ? remaining.join('\n') : text
  if (streaming) {
    const lines = prompt.split('\n')
    const tail = lines.at(-1).trim().toUpperCase()
    if (tail && ('[DIAG]'.startsWith(tail) || DIAG_PREFIX.test(tail) || '===PROMPT==='.startsWith(tail))) lines.pop()
    prompt = lines.join('\n')
  }
  const diagnosis = Object.fromEntries(DIAGNOSIS_DIMENSIONS.filter(key => found[key]).map(key => [key, found[key]]))
  const missingDimensions = DIAGNOSIS_DIMENSIONS.filter(key => !found[key])
  if (hasLeadingDiagnosis && !marker) warnings.add('missing_separator')
  return {
    diagnosis: Object.keys(diagnosis).length ? diagnosis : null,
    prompt: prompt.trim(),
    diagnosisMeta: { status: missingDimensions.length === 0 ? 'complete' : Object.keys(diagnosis).length ? 'partial' : 'missing', missingDimensions, warnings: [...warnings] },
  }
}
