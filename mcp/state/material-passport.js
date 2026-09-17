
import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const PASSPORT_DIR = path.join(os.homedir(), '.dsh-research-kit', 'passports')

function makeRunId() {
  return crypto.randomBytes(6).toString('hex')
}

function computeHash(passport) {
  return crypto.createHash('sha256').update(JSON.stringify(passport, null, 0)).digest('hex').slice(0, 12)
}

function toYaml(passport) {
  const lines = []
  lines.push(`run_id: ${passport.run_id}`)
  lines.push(`created_at: "${passport.created_at}"`)
  lines.push(`project: ${passport.project}`)
  lines.push(`current_stage: ${passport.current_stage}`)
  lines.push('')
  if (passport.completed?.length) {
    lines.push('completed:')
    for (const step of passport.completed) {
      lines.push(`  - stage: ${step.stage}`)
      lines.push(`    tool: ${step.tool}`)
      lines.push(`    summary: "${step.summary}"`)
      if (step.timestamp) lines.push(`    timestamp: "${step.timestamp}"`)
    }
  }
  if (passport.pending?.length) {
    lines.push('')
    lines.push('pending:')
    for (const step of passport.pending) {
      lines.push(`  - stage: ${step.stage}`)
      if (step.tool) lines.push(`    tool: ${step.tool}`)
      if (step.workflow_id) lines.push(`    workflow_id: ${step.workflow_id}`)
      if (step.note) lines.push(`    note: "${step.note}"`)
    }
  }
  if (passport.constraints?.length) {
    lines.push('')
    lines.push('constraints:')
    for (const c of passport.constraints) lines.push(`  - "${c}"`)
  }
  if (passport.evidence_ids?.length) {
    lines.push('')
    lines.push('evidence_ids:')
    for (const id of passport.evidence_ids) lines.push(`  - "${id}"`)
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
          passport[key] = value.replace(/^["']|["']$/g, '')
        }
      }
      continue
    }

    if (section === 'constraints' || section === 'evidence_ids') {
      const value = trimmed.replace(/^-\s*/, '').replace(/^["']|["']$/g, '')
      if (value) passport[section].push(value)
      continue
    }

    if (section === 'completed' || section === 'pending') {
      if (trimmed.startsWith('- ')) {
        currentItem = {}
        passport[section].push(currentItem)
        const rest = trimmed.slice(2)
        const kv = rest.match(/^(\w+):\s*(.*)/)
        if (kv) currentItem[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
      } else if (currentItem) {
        const kv = trimmed.match(/^(\w+):\s*(.*)/)
        if (kv) currentItem[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
      }
    }
  }
  return passport
}

async function exportPassport({ project, current_stage, completed, pending, constraints, evidence_ids }) {
  const passport = {
    run_id: makeRunId(),
    created_at: new Date().toISOString(),
    project: project || 'default',
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

export { exportPassport, importPassport, listPassports, toYaml, fromYaml }
