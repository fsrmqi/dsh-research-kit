#!/usr/bin/env node
// 覆盖率棘轮：把「测试覆盖了多少」变成一条不许下滑的线。
//
// 为什么不是「一次到位的 100%」：本仓库 75% 上下的覆盖率里有大量视图层代码，
// 硬拉到 100% 的代价远高于收益（真实的交互路径要靠 docs/MANUAL-QA.md 的 profile 验收）。
// 但「覆盖率无人看守」是另一个极端——新增一个上千行的模块却不带测试，整体覆盖率会静默掉十几个点。
// 因此这里记一个**地板**：低于它即失败；提高了就用 `npm run coverage:update` 抬高地板。
//
// 用法：
//   npm run coverage          # 跑测试 + 覆盖率，低于地板即非零退出（CI 用它）
//   npm run coverage:update   # 重新测量并把地板抬到当前水平（记录 measured 与 enforced）
//   node scripts/check-coverage.mjs --report   # 只跑一次并列出覆盖率最低的若干文件
//
// 地板的取值：floor(实测) - 容差。容差存在的原因是 V8 覆盖率数字会随 Node 大版本小幅漂移
// （本地 Node 26 与 CI Node 22.19 不是同一个 V8），钉死实测值会变成「版本一换就红」的假门禁。
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = join(ROOT, 'coverage-baseline.json')
const TOLERANCE = 2
const TEST_GLOBS = ['test/*.test.js', 'test/*.test.mjs']

const args = new Set(process.argv.slice(2))
const update = args.has('--update')
const report = args.has('--report')

function runCoverage(thresholds) {
  const flags = []
  if (thresholds) {
    flags.push(`--test-coverage-lines=${thresholds.lines}`)
    flags.push(`--test-coverage-branches=${thresholds.branches}`)
    flags.push(`--test-coverage-functions=${thresholds.functions}`)
  }
  const result = spawnSync(
    process.execPath,
    ['--test', '--experimental-test-coverage', ...flags, ...TEST_GLOBS],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}` }
}

/** 解析覆盖率表：返回 { total: {statements, branches, functions}, files: [{file, statements, branches, functions}] }。 */
function parseCoverage(output) {
  const files = []
  let total
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/^[#ℹ]\s?/, '').trimEnd()
    if (!line.includes('|')) continue
    const cells = line.split('|').map(cell => cell.trim())
    if (cells.length < 4) continue
    const numbers = [cells[1], cells[2], cells[3]].map(Number)
    if (numbers.some(Number.isNaN)) continue
    const name = cells[0]
    if (name === 'all files') total = { statements: numbers[0], branches: numbers[1], functions: numbers[2] }
    else files.push({ file: name, statements: numbers[0], branches: numbers[1], functions: numbers[2] })
  }
  return { total, files }
}

function readBaseline() {
  if (!existsSync(BASELINE_FILE)) return undefined
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  } catch {
    return undefined
  }
}

if (update) {
  const { status, output } = runCoverage()
  const { total } = parseCoverage(output)
  if (status !== 0) {
    process.stderr.write('测试未全部通过，不更新覆盖率地板。\n')
    process.exit(1)
  }
  if (!total) {
    process.stderr.write('没能从覆盖率报告里解析出 all files 行——Node 版本改了输出格式？\n')
    process.exit(1)
  }
  const enforced = {
    lines: Math.max(0, Math.floor(total.statements) - TOLERANCE),
    branches: Math.max(0, Math.floor(total.branches) - TOLERANCE),
    functions: Math.max(0, Math.floor(total.functions) - TOLERANCE),
  }
  const baseline = {
    note: '覆盖率地板（棘轮）。低于此值 npm run coverage 失败；提高后用 npm run coverage:update 抬高。',
    enforced,
    tolerance: TOLERANCE,
    recorded: {
      statements: total.statements,
      branches: total.branches,
      functions: total.functions,
      node: process.version,
      at: new Date().toISOString().slice(0, 10),
    },
  }
  writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`)
  process.stdout.write(`覆盖率地板已更新：lines>=${enforced.lines} branches>=${enforced.branches} functions>=${enforced.functions}`
    + `（实测 ${total.statements}/${total.branches}/${total.functions}，${process.version}）\n`)
  // 写完立刻自检一次：Node 各版本报告列的含义若有差异，这里会当场暴露，而不是等 CI 变红。
  const verify = runCoverage(enforced)
  if (verify.status !== 0) {
    process.stderr.write('自检失败：新地板在本机跑不过，说明列语义与阈值旗标不一致，请下调 tolerance 或检查 Node 版本。\n')
    process.exit(1)
  }
  process.stdout.write('自检通过。\n')
  process.exit(0)
}

const baseline = readBaseline()
if (!baseline) {
  process.stderr.write('缺少 coverage-baseline.json（运行 npm run coverage:update 生成）。\n')
  process.exit(1)
}

if (report) {
  const { output } = runCoverage()
  const { total, files } = parseCoverage(output)
  process.stdout.write(`实测：stmts ${total?.statements} / branch ${total?.branches} / funcs ${total?.functions}`
    + `　地板：${JSON.stringify(baseline.enforced)}\n`)
  const lowest = files.filter(f => f.statements > 0).sort((a, b) => a.statements - b.statements).slice(0, 8)
  process.stdout.write('覆盖率最低的 8 个文件（提醒，不是门禁）：\n')
  for (const file of lowest) process.stdout.write(`  ${String(file.statements).padStart(6)}%  ${file.file}\n`)
  process.exit(0)
}

const { status } = runCoverage(baseline.enforced)
if (status !== 0) {
  process.stderr.write(`\n覆盖率低于地板 ${JSON.stringify(baseline.enforced)}（记录于 ${BASELINE_FILE}）。\n`
    + '要么补测试把覆盖率拉回来，要么——只有当下降确实是设计取舍时——运行 npm run coverage:update 记录新的地板。\n')
  process.exit(1)
}
process.stdout.write(`覆盖率棘轮通过：不低于 ${JSON.stringify(baseline.enforced)}（实测记录 ${JSON.stringify(baseline.recorded)} @ ${baseline.recorded.node}）。\n`)
