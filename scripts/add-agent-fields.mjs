
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const WORKFLOWS_DIR = path.resolve(import.meta.dirname, '../catalog/workflows')

function inferToolMode(entry) {
  const prompt = entry.prompt || ''
  if (/检索|搜索|查询|查找/.test(entry.name + prompt) && !/分析|评估|审阅|撰写/.test(entry.name)) return 'direct'
  return 'guided'
}

function inferInputSchema(entry) {
  const properties = {}
  const required = []
  for (const field of entry.placeholders || []) {
    properties[field.key] = {
      type: 'string',
      description: field.hint || field.label,
      ...(field.required ? {} : { default: '' }),
    }
    if (field.required) required.push(field.key)
  }
  if (entry.requiresFiles) {
    properties.files = {
      type: 'array',
      items: { type: 'string' },
      description: '使用 @文件 引用的材料文件路径',
    }
    required.push('files')
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
  }
}

function inferAgentGuidance(entry) {
  const name = entry.name || ''
  if (/审阅|评审|review/i.test(name)) {
    return '审阅前先用 verify_citation 检查论文中关键引用的 DOI 是否存在且支持对应 claim。输出按 [实证]/[推论]/[缺失] 分级标注每条意见。'
  }
  if (/文献|综述|literature/i.test(name)) {
    return '检索文献时使用 query_source 工具查询 Crossref/OpenAlex/Semantic Scholar。保存关键来源到证据库（save_evidence），标注来源标识符。综述中每条引用须标注 [实证]/[推论]/[缺失] 分级。'
  }
  if (/统计|数据分析|statistical/i.test(name)) {
    return '分析结论须区分统计显著性与实际意义。样本量不足时标注为 [缺失]。不得将 p 值作为效应量大小的证据。'
  }
  if (/撰写|写作|write|draft/i.test(name)) {
    return '写入正文前先核实所有引用（verify_citation）。无法核验的引用用 [待补充] 标记，禁止编造。'
  }
  return '基于已提供材料或已核验来源工作；无法确认时标记为待核验；不得编造数据、引用、结论。'
}

async function main() {
  const files = (await readdir(WORKFLOWS_DIR)).filter(f => f.endsWith('.json') && f !== 'index.js')
  let total = 0
  let updated = 0
  for (const file of files) {
    const filePath = path.join(WORKFLOWS_DIR, file)
    const raw = await readFile(filePath, 'utf-8')
    let data
    try { data = JSON.parse(raw) } catch { console.error(`SKIP ${file}: invalid JSON`); continue }
    const entries = Array.isArray(data) ? data : [data]
    let dirty = false
    for (const entry of entries) {
      if (!entry.id || !entry.prompt) continue
      total++
      if (entry.tool_mode !== undefined) continue
      entry.tool_mode = inferToolMode(entry)
      entry.input_schema = inferInputSchema(entry)
      entry.agent_guidance = inferAgentGuidance(entry)
      entry.checkpoints = []
      dirty = true
      updated++
    }
    if (dirty) {
      await writeFile(filePath, JSON.stringify(data, null, 2) + '\n')
      console.log(`UPDATED ${file} (${entries.length} entries)`)
    }
  }
  console.log(`\nDone: ${updated}/${total} workflows updated with tool_mode, input_schema, agent_guidance, checkpoints.`)
}

main().catch(err => { console.error(err); process.exit(1) })
