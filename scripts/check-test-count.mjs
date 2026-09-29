#!/usr/bin/env node
// 文档里的测试数字**对实测负责**：跑一遍测试套件 + 数一遍测试文件，与文档逐一比对。
//
// 为什么单独有这个脚本：scripts/check-doc-stats.mjs 只查「各文档彼此一致」，
// 真值它明确不管（见该文件注释）。于是文档里的数字从 429 漂到 437、文件数停在 62，
// 全套 check 依然全绿——门禁看住了「互相不矛盾」，没看住「说的是真的」。
//
// 用法：
//   npm run check:test-count
// 退出码：0 一致；1 有文档与实测不符（会点名文件与该改成多少）。
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { TEST_COUNT_PATTERNS, collectDocTestCounts } from './lib/doc-test-count.mjs'
import { parseTapSummary } from './lib/tap-summary.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 实测真值之一：测试文件数（与 npm test 的 glob 保持同一口径）。
const testFiles = readdirSync(resolve(ROOT, 'test')).filter(name => /\.test\.(js|mjs)$/.test(name))

// 实测真值之二：用例数。跑一遍 TAP reporter，只取汇总行，不重复解析每个用例。
const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/*.test.js', 'test/*.test.mjs'], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
})
// 汇总行解析交给共享 lib：它要求每种汇总行唯一（TAP 转义行为一变就会报结构异常），
// 而不是像 last-wins 那样悄悄取"最后一条"。
const { tests, pass, fail, problems: summaryProblems } = parseTapSummary(run.stdout || '')
if (summaryProblems.length) {
  process.stderr.write(`没能可信地解析测试汇总：${summaryProblems.join('；')}\n`
    + '若 node --test 的输出格式确实变了，请同步 scripts/lib/tap-summary.mjs。\n')
  process.exit(1)
}

const failures = []
if (fail !== 0) failures.push(`测试未全部通过（fail ${fail}），文档数字不予采信`)

const cache = new Map()
const readOnce = file => {
  if (!cache.has(file)) cache.set(file, readFileSync(resolve(ROOT, file), 'utf8'))
  return cache.get(file)
}
const { hits, uncovered } = collectDocTestCounts(readOnce)

// 句式清单本身也是被看守对象：删掉一条句式就会让那条数字彻底无人看守（uncovered 为空，
// 于是「零处引用」也变成通过）。这里钉住数量下限——要减就必须显式改这个数字。
const MIN_PATTERNS = 9
if (TEST_COUNT_PATTERNS.length < MIN_PATTERNS) {
  failures.push(`文档测试数字的句式只有 ${TEST_COUNT_PATTERNS.length} 条（下限 ${MIN_PATTERNS}）：`
    + '删句式等于让那条数字无人看守；确实不需要看守时请同步改 scripts/check-test-count.mjs 的 MIN_PATTERNS 并在 PR 说明')
}

// 句式未命中不是「文档恰好换了说法」这么简单：它意味着这条数字**再也没有人看守**。
// 本脚本存在的理由正是「门禁看住了互相不矛盾，却没看住说的是真的」，所以这里必须失败。
for (const item of uncovered) {
  failures.push(`${item.file} 的「${item.label}」句式已失效：正则不再命中任何内容——`
    + `文档换了措辞就同步 scripts/lib/doc-test-count.mjs 的 TEST_COUNT_PATTERNS，`
    + `确实是这条数字不需要看守了就把该句式删掉（否则它会一直静默失效）`)
}

for (const hit of hits) {
  // expected 存在时代表这条句式的真值不是套件总数（例如「每个基线恒定 N 个用例」是矩阵自己的常量）。
  const expected = hit.expected ?? tests
  if (hit.testCount !== expected) {
    failures.push(`${hit.file}:${hit.line} 的「${hit.raw}」写作 ${hit.testCount} 项，应为 ${expected} 项（${hit.label}）`)
  }
  if (hit.fileCount !== undefined && hit.fileCount !== testFiles.length) {
    failures.push(`${hit.file}:${hit.line} 的「${hit.raw}」写作 ${hit.fileCount} 个测试文件，实测 ${testFiles.length} 个（${hit.label}）`)
  }
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`)
  process.stderr.write(`\n文档测试数字与实测不符（${failures.length} 处）：把上述数字改成实测值即可——`
    + `实测 ${tests} 项 / ${testFiles.length} 个测试文件。\n`)
  process.exit(1)
}

process.stdout.write(`文档测试数字与实测一致：${hits.length} 处引用均为 ${tests} 项 / ${testFiles.length} 个测试文件`
  + `（实测 pass ${pass}），脚本自身不适用退化断言。\n`)
