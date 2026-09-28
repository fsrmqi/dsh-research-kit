#!/usr/bin/env node
// 覆盖率棘轮：把「测试覆盖了多少」变成一条不许下滑的线。
//
// 为什么不是「一次到位的 100%」：本仓库 75% 上下的覆盖率里有大量视图层代码，
// 硬拉到 100% 的代价远高于收益（真实的交互路径要靠 docs/MANUAL-QA.md 的 profile 验收）。
// 但「覆盖率无人看守」是另一个极端——新增一个上千行的模块却不带测试，整体覆盖率会静默掉十几个点。
// 因此这里记一个**地板**：低于它即失败；提高了就用 `npm run coverage:update` 抬高地板。
//
// 用法：
//   npm run coverage            # 跑测试 + 覆盖率，低于地板即非零退出（CI 用它）
//   npm run coverage:update     # 重新测量，按「只抬不降」更新当前 Node 主版本的地板
//   node scripts/check-coverage.mjs --report   # 只跑一次并列出覆盖率最低的若干文件
//
// 退出码：0 通过；1 套件没跑绿 / 覆盖率低于地板 / 解析不出报告；2 用法或配置错误
// （未知参数、当前 Node 主版本没有地板、地板字段非法）。
//
// 五条刻意的设计，每条都对应一类「看起来在守、其实没守」：
//   1. **地板按 Node 主版本分别记录**。覆盖率数字是 V8 给的，统计口径随版本变：同代码同用例
//      Node 26 = 75.70/69.95/69.95，Node 22.19（CI）= 82.40/75.40/77.76，差 7~8 个点。
//      单一地板要么在 CI 上松掉近 10 个点（棘轮形同虚设），要么在另一版本上假红。
//      当前主版本没有地板时**失败退出**（2），并说明该在哪台版本上跑 coverage:update。
//   2. **阈值必须显式校验**。Node 对 `--test-coverage-lines=undefined` 是静默忽略的（NaN、
//      非法值同理），那条指标的门禁会当场消失，而脚本还会打印「通过」。
//   3. **分得清「套件没跑绿」与「覆盖率低于地板」**。以前只看子进程退出码：一个失败用例
//      会被报成「覆盖率低于地板」，还被建议去跑 coverage:update——正好把地板调低。
//   4. **fail closed**。一个测试文件都没匹配到时 `node --test` 会报 `all files 100.00` 并退出 0。
//   5. **棘轮单调**。--update 只抬不降，先自检通过再落盘；覆盖率真下降时它失败并要求补测试。
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = join(ROOT, 'coverage-baseline.json')
const TOLERANCE = 2
const TEST_GLOBS = ['test/*.test.js', 'test/*.test.mjs']
const METRICS = ['lines', 'branches', 'functions']
const KNOWN_FLAGS = new Set(['--update', '--report'])

// 与 npm test / check:test-count 同一口径的测试文件清点：用来抓「glob 没匹配到任何文件」。
const testFiles = readdirSync(join(ROOT, 'test')).filter(name => /\.test\.(js|mjs)$/.test(name))
const nodeMajor = process.versions.node.split('.')[0]

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

const args = process.argv.slice(2)
for (const arg of args) {
  // 未知参数必须当场失败：拼错 --update 会静默退化成普通门禁，拼错 --report 会跑一整套测试。
  if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) fail(`未知参数：${arg}（已知参数：${[...KNOWN_FLAGS].join(' / ')}）`, 2)
}
const update = args.includes('--update')
const report = args.includes('--report')

function runCoverage(thresholds) {
  const flags = []
  if (thresholds) {
    for (const metric of METRICS) flags.push(`--test-coverage-${metric}=${thresholds[metric]}`)
  }
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', '--experimental-test-coverage', ...flags, ...TEST_GLOBS],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const output = `${result.stdout || ''}${result.stderr || ''}`
  const summary = Object.fromEntries(
    [...output.matchAll(/^# (tests|pass|fail) (\d+)$/gm)].map(match => [match[1], Number(match[2])]),
  )
  const failing = output.split('\n')
    .filter(line => /^\s*not ok \d+ - /.test(line) && !/#\s*(SKIP|TODO)\b/.test(line))
    .map(line => line.replace(/^\s*not ok \d+ - /, '').trim())
  return { status: result.status, output, summary, failing }
}

/**
 * 解析覆盖率表。**按表头名字取列**，不按位置：表头是
 * `file | line % | branch % | funcs % | uncovered lines`（Node 22.19 与 26 实测一致），
 * 但列序若有变化，位置解析会把错列当地板，而且因为阈值是交给 Node 判断的，脚本自己不会发现。
 * 字段名跟着表头走：line/branch/funcs，不叫 statements。
 */
function parseCoverage(output) {
  const files = []
  let total
  let columns
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/^[#ℹ]\s?/, '').trimEnd()
    if (!line.includes('|')) continue
    const cells = line.split('|').map(cell => cell.trim())
    if (!columns) {
      // 表头必须锚定第一格是 file：否则测试往 stdout 写的一行（TAP 不转义不以 # 开头的行）
      // 就能冒充表头，把真实 all files 行按错列解析（实测把 funcs 100 报成 0）。
      if (cells[0] !== 'file') continue
      const index = {
        lines: cells.findIndex(cell => /line/i.test(cell) && !/uncovered/i.test(cell)),
        branches: cells.findIndex(cell => /branch/i.test(cell)),
        functions: cells.findIndex(cell => /func/i.test(cell)),
      }
      if (METRICS.every(metric => index[metric] >= 0)) columns = index
      continue
    }
    // 空单元格必须丢弃：`Number('')` 是 0，会被当成"该项覆盖率 0%"或"100%"悄悄算进地板。
    const raw = METRICS.map(metric => cells[columns[metric]])
    if (raw.some(value => value === undefined || value === '')) continue
    const numbers = Object.fromEntries(METRICS.map((metric, index) => [metric, Number(raw[index])]))
    if (METRICS.some(metric => Number.isNaN(numbers[metric]))) continue
    if (cells[0] === 'all files') total = numbers
    else files.push({ file: cells[0], ...numbers })
  }
  return { total, files, headerFound: Boolean(columns) }
}

function readBaseline() {
  if (!existsSync(BASELINE_FILE)) return { missing: true }
  try {
    return { baseline: JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) }
  } catch (error) {
    fail(`coverage-baseline.json 解析失败（${error.message}）：请修复或重新生成（npm run coverage:update）。`, 2)
  }
}

/**
 * 阈值兜底：Node 会静默忽略非法值，所以必须自己拒绝。
 * 下界是 1 而不是 0：Node 对阈值**向下取整**，`0 < v < 1` 会被取整成 0 → 那条指标的门禁
 * 彻底消失，而脚本还会打印「通过」（实测 enforced=0.5 时确实如此）。
 */
function thresholdProblems(thresholds) {
  if (!thresholds || typeof thresholds !== 'object') return ['整个 enforced 对象缺失']
  return METRICS.filter(metric => {
    const value = thresholds[metric]
    return !Number.isFinite(value) || value < 1 || value > 100
  }).map(metric => `${metric}=${JSON.stringify(thresholds[metric])}`)
}

/** 套件是否跑绿。跑不绿时覆盖率数字不予采信，更不该拿它去调地板。 */
function suiteProblems(run) {
  const problems = []
  if (run.summary.fail > 0) problems.push(`有 ${run.summary.fail} 个用例失败`)
  // 用 isFinite 而不是 === 0：解析不到汇总行时 summary.tests 是 undefined，
  // `undefined === 0` 为假会让「没解析到」被当成没问题。
  if (!Number.isFinite(run.summary.tests)) problems.push('没能从 TAP 输出里解析出用例数（汇总行缺失）')
  else if (run.summary.tests === 0) problems.push('一个用例都没跑到')
  if (testFiles.length === 0) problems.push('test/ 下没有任何 *.test.js|mjs（glob 匹配不到文件时 node --test 会报 all files 100% 并退出 0）')
  return problems
}

function reportSuiteFailure(run, problems) {
  process.stderr.write(`测试套件没跑绿：${problems.join('；')}。\n`)
  if (run.failing.length) {
    process.stderr.write('失败用例（最多 10 条）：\n')
    for (const name of run.failing.slice(0, 10)) process.stderr.write(`  ✗ ${name}\n`)
  }
  process.stderr.write('这不代表覆盖率下降——先修用例；不要用 coverage:update 去"解决"它。\n')
}

const loaded = readBaseline()
if (loaded.missing && !update) {
  fail('缺少 coverage-baseline.json（运行 npm run coverage:update 生成）。', 2)
}
const baseline = loaded.baseline || { note: '', tolerance: TOLERANCE, floors: {} }
const floors = baseline.floors || {}
const entry = floors[nodeMajor]

if (update) {
  const run = runCoverage()
  const suite = suiteProblems(run)
  if (suite.length) {
    reportSuiteFailure(run, suite)
    process.exit(1)
  }
  if (run.status !== 0) {
    fail(`测试进程非零退出（${run.status}）但没解析出失败用例——先看上面的输出，不更新地板。`)
  }
  const { total } = parseCoverage(run.output)
  if (!total) {
    fail('没能从覆盖率报告里解析出 all files 行（表头可能变了）——不更新地板，请检查 Node 输出格式。')
  }
  const measured = Object.fromEntries(METRICS.map(metric => [metric, total[metric]]))
  const candidate = Object.fromEntries(METRICS.map(metric => [metric, Math.max(0, Math.floor(total[metric]) - TOLERANCE)]))
  // F4：以前 enforced 非法就把 previous 丢掉，于是「先把字段改成 null，再跑一次官方
  // --update」会带着"自检通过"把地板从 90/90/90 降到 73/67/67。要降就必须显式改文件。
  let previous
  if (entry) {
    const existing = thresholdProblems(entry.enforced)
    if (existing.length) {
      fail(`coverage-baseline.json 里已有 Node ${nodeMajor} 条目，但它的地板非法（${existing.join('、')}）：\n`
        + '--update 不会静默重建它——否则「先把字段弄坏、再跑 update」就绕过了只抬不降。\n'
        + '请先把该条目改成合法值或**显式删掉整个条目**，再运行 npm run coverage:update。', 2)
    }
    previous = entry.enforced
  }
  // 只抬不降：地板一旦写进仓库就只许往上走，否则「覆盖率下降那天跑一次 update」就把线降了。
  const enforced = previous
    ? Object.fromEntries(METRICS.map(metric => [metric, Math.max(previous[metric], candidate[metric])]))
    : candidate
  const keptHigher = previous ? METRICS.filter(metric => enforced[metric] > candidate[metric]) : []

  // 先自检通过再落盘：否则一次失败的 update 会留下一个跑不过的地板。
  const verify = runCoverage(enforced)
  const verifySuite = suiteProblems(verify)
  if (verifySuite.length) {
    reportSuiteFailure(verify, verifySuite)
    fail('自检没跑绿，未写入新地板（coverage-baseline.json 保持原样）。')
  }
  if (verify.status !== 0) {
    if (keptHigher.length) {
      fail(`覆盖率已低于既有地板：${keptHigher.map(metric => `${metric} 实测 ${measured[metric]} < 地板 ${enforced[metric]}`).join('，')}。\n`
        + '棘轮只抬不降，所以这次 update 不会下调地板——请补测试，而不是改数字。\n'
        + '（若下降确实是设计取舍：直接改 coverage-baseline.json 并在提交信息里写明理由。）')
    }
    fail('自检失败：新地板在本机跑不过，说明列语义与阈值旗标不一致，请检查 Node 输出格式。')
  }

  const next = {
    note: '覆盖率地板（棘轮，按 Node 主版本分别记录）。低于当前主版本的地板即失败；'
      + '提高后用 npm run coverage:update 抬高，它只抬不降。换 Node 主版本要重新记录该版本的地板。',
    tolerance: TOLERANCE,
    floors: {
      ...floors,
      [nodeMajor]: {
        enforced,
        measured,
        node: process.version,
        at: new Date().toISOString().slice(0, 10),
      },
    },
  }
  writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`)
  process.stdout.write(`Node ${nodeMajor} 的覆盖率地板已更新：${METRICS.map(metric => `${metric}>=${enforced[metric]}`).join(' ')}`
    + `（本次实测 ${METRICS.map(metric => `${metric} ${measured[metric]}`).join(' / ')} @ ${process.version}）\n`)
  if (keptHigher.length) {
    process.stdout.write(`注意：${keptHigher.join('、')} 的既有地板高于本次实测，已按「只抬不降」保持原值。\n`)
  }
  process.stdout.write('自检通过（用新地板跑了一遍，套件绿且阈值生效）。\n')
  process.exit(0)
}

if (report) {
  const run = runCoverage()
  const { total, files } = parseCoverage(run.output)
  const measured = total ? METRICS.map(metric => `${metric} ${total[metric]}`).join(' / ') : '解析失败'
  process.stdout.write(`本次实测：${measured} @ ${process.version}　`
    + `当前主版本地板：${entry ? JSON.stringify(entry.enforced) : '（未记录）'}\n`)
  if (run.summary.fail > 0) process.stdout.write(`注意：套件有 ${run.summary.fail} 个失败用例，上述数字不予采信。\n`)
  const lowest = files.filter(file => file.lines > 0).sort((a, b) => a.lines - b.lines).slice(0, 8)
  process.stdout.write('覆盖率最低的 8 个文件（提醒，不是门禁）：\n')
  for (const file of lowest) process.stdout.write(`  ${String(file.lines).padStart(6)}%  ${file.file}\n`)
  process.exit(0)
}

if (!entry) {
  fail(`当前是 Node ${process.version}（主版本 ${nodeMajor}），coverage-baseline.json 里没有这个主版本的地板：`
    + `${JSON.stringify(Object.keys(floors))}。\n`
    + '覆盖率口径随 Node 主版本变（同代码同用例 Node 26 与 22.19 差 7~8 个点），'
    + '所以换版本必须在**该版本上**记录一次地板；用别的版本的数字充数只会得到假门禁。\n'
    + `在该版本上运行：npm run coverage:update`, 2)
}
const problems = thresholdProblems(entry.enforced)
if (problems.length) {
  fail(`coverage-baseline.json 里 Node ${nodeMajor} 的地板字段非法：${problems.join('、')}。\n`
    + 'Node 对 --test-coverage-* 的非法值是静默忽略的——那等于这条指标的门禁消失，所以这里必须拒绝。\n'
    + '运行 npm run coverage:update 重新生成。', 2)
}

const run = runCoverage(entry.enforced)
const suite = suiteProblems(run)
if (suite.length) {
  reportSuiteFailure(run, suite)
  process.exit(1)
}
const { total, headerFound } = parseCoverage(run.output)
if (!headerFound && run.status !== 0) {
  fail('既没解析出覆盖率表头、进程又非零退出——无法判断是覆盖率不足还是输出格式变了。请先看上面的输出。')
}
if (run.status !== 0) {
  const measured = total ? METRICS.map(metric => `${metric} ${total[metric]}`).join(' / ') : '解析失败'
  process.stderr.write(`\n覆盖率低于地板 ${JSON.stringify(entry.enforced)}（Node ${nodeMajor}，记录于 ${BASELINE_FILE}）：本次实测 ${measured}。\n`
    + '要么补测试把覆盖率拉回来；只有当下降确实是设计取舍时才运行 npm run coverage:update'
    + '（它只抬不降，真下降时会失败并要求你说明理由）。\n')
  process.exit(1)
}
const measured = total ? METRICS.map(metric => `${metric} ${total[metric]}`).join(' / ') : '解析失败'
process.stdout.write(`覆盖率棘轮通过：>= ${JSON.stringify(entry.enforced)}`
  + `（Node ${nodeMajor}　本次实测 ${measured} @ ${process.version}　套件 ${run.summary.pass ?? '?'}/${run.summary.tests ?? '?'} 通过）。\n`)