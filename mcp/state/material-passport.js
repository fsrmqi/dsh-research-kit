
import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { dataPath } from '../paths.js'
import crypto from 'node:crypto'

const PASSPORT_DIR = dataPath('passports')

function makeRunId() {
  return crypto.randomBytes(6).toString('hex')
}

function validRunId(value) {
  const id = String(value || '').trim()
  if (!id) return ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(id)) throw new Error('run_id 格式不合法。')
  return id
}

function computeHash(passport) {
  return crypto.createHash('sha256').update(JSON.stringify(passport, null, 0)).digest('hex').slice(0, 12)
}

// JSON 字符串是 YAML 双引号标量的安全子集：换行、引号和反斜杠都会转义，
// 不会逃逸到新的顶层字段。读取时仍兼容历史护照里的未加引号标量。
function yamlScalar(value) {
  return JSON.stringify(String(value ?? ''))
}

function parseYamlScalar(value) {
  const raw = String(value ?? '').trim()
  if (raw.startsWith('"')) {
    try { return JSON.parse(raw) } catch { /* 兼容旧版未正确转义的双引号文本 */ }
  }
  return raw.replace(/^["']|["']$/g, '')
}

function toYaml(passport) {
  const lines = []
  // run_id 已由 validRunId 限制为安全字符，保持历史输出格式供现有消费者识别。
  lines.push(`run_id: ${passport.run_id}`)
  lines.push(`created_at: ${yamlScalar(passport.created_at)}`)
  lines.push(`project: ${yamlScalar(passport.project)}`)
  if (passport.workflow_id) lines.push(`workflow_id: ${yamlScalar(passport.workflow_id)}`)
  lines.push(`current_stage: ${yamlScalar(passport.current_stage)}`)
  lines.push('')
  if (passport.completed?.length) {
    lines.push('completed:')
    for (const step of passport.completed) {
      lines.push(`  - stage: ${yamlScalar(step.stage)}`)
      lines.push(`    tool: ${yamlScalar(step.tool)}`)
      lines.push(`    summary: ${yamlScalar(step.summary)}`)
      if (step.timestamp) lines.push(`    timestamp: ${yamlScalar(step.timestamp)}`)
    }
  }
  if (passport.pending?.length) {
    lines.push('')
    lines.push('pending:')
    for (const step of passport.pending) {
      lines.push(`  - stage: ${yamlScalar(step.stage)}`)
      if (step.tool) lines.push(`    tool: ${yamlScalar(step.tool)}`)
      if (step.workflow_id) lines.push(`    workflow_id: ${yamlScalar(step.workflow_id)}`)
      if (step.note) lines.push(`    note: ${yamlScalar(step.note)}`)
    }
  }
  if (passport.constraints?.length) {
    lines.push('')
    lines.push('constraints:')
    for (const c of passport.constraints) lines.push(`  - ${yamlScalar(c)}`)
  }
  if (passport.evidence_ids?.length) {
    lines.push('')
    lines.push('evidence_ids:')
    for (const id of passport.evidence_ids) lines.push(`  - ${yamlScalar(id)}`)
  }
  return lines.join('\n') + '\n'
}

function fromYaml(text) {
  const passport = {}
  let section = null
  let currentItem = null

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    if (!line.startsWith(' ') && !line.startsWith('-')) {
      const match = trimmed.match(/^(\w+):\s*(.*)/)
      if (match) {
        const [, key, value] = match
        if (key === 'completed' || key === 'pending' || key === 'constraints' || key === 'evidence_ids') {
          section = key
          passport[key] = []
        } else {
          section = null
          passport[key] = parseYamlScalar(value)
        }
      }
      continue
    }

    if (section === 'constraints' || section === 'evidence_ids') {
      const value = parseYamlScalar(trimmed.replace(/^-\s*/, ''))
      if (value) passport[section].push(value)
      continue
    }

    if (section === 'completed' || section === 'pending') {
      if (trimmed.startsWith('- ')) {
        currentItem = {}
        passport[section].push(currentItem)
        const rest = trimmed.slice(2)
        const kv = rest.match(/^(\w+):\s*(.*)/)
        if (kv) currentItem[kv[1]] = parseYamlScalar(kv[2])
      } else if (currentItem) {
        const kv = trimmed.match(/^(\w+):\s*(.*)/)
        if (kv) currentItem[kv[1]] = parseYamlScalar(kv[2])
      }
    }
  }
  return passport
}

async function exportPassport({ run_id, project, current_stage, completed, pending, constraints, evidence_ids, workflow_id }) {
  const passport = {
    run_id: validRunId(run_id) || makeRunId(),
    created_at: new Date().toISOString(),
    project: project || 'default',
    workflow_id: String(workflow_id || '').trim(),
    current_stage: current_stage || 'unknown',
    completed: completed || [],
    pending: pending || [],
    constraints: constraints || ['所有结论需人工核验', '不得虚构引用、数据、结论'],
    evidence_ids: evidence_ids || [],
  }

  await mkdir(PASSPORT_DIR, { recursive: true })
  const hash = computeHash(passport)
  const file = path.join(PASSPORT_DIR, `${passport.run_id}.yaml`)
  await writeFile(file, toYaml(passport))

  return { passport_yaml: toYaml(passport), hash, file_path: file, run_id: passport.run_id }
}

async function importPassport(passportYaml) {
  const passport = typeof passportYaml === 'string' ? fromYaml(passportYaml) : passportYaml
  if (!passport.run_id) throw new Error('Passport 缺少 run_id，无法导入。')

  return {
    recovered_stage: passport.current_stage,
    project: passport.project,
    workflow_id: passport.workflow_id || '',
    completed: passport.completed || [],
    pending: passport.pending || [],
    constraints: passport.constraints || [],
    evidence_ids: passport.evidence_ids || [],
  }
}

async function listPassports() {
  if (!existsSync(PASSPORT_DIR)) return []
  const files = await readdir(PASSPORT_DIR)
  return files.filter(f => f.endsWith('.yaml')).map(f => f.replace('.yaml', ''))
}

// 读取单个 run 的护照（不校验 hash）；run 无护照时返回 null 而不是抛错，
// 供状态总览对 passports 与 checkpoints 目录不同步的旧 run 优雅降级。
async function loadPassport(runId) {
  const id = validRunId(runId)
  const file = path.join(PASSPORT_DIR, `${id}.yaml`)
  if (!existsSync(file)) return null
  try {
    const passport = fromYaml(await readFile(file, 'utf8'))
    return passport.run_id ? passport : null
  } catch {
    return null
  }
}

export { exportPassport, importPassport, listPassports, loadPassport, toYaml, fromYaml }
