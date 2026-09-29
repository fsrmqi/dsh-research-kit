// TAP 汇总行解析：check-test-count.mjs 与 check-coverage.mjs 共用一份。
//
// 这里压着一层**隐形依赖**，必须显式守住：
// 测试用例往 stdout/stderr 打的任何内容，都会被 node 的 TAP reporter 加上 `# ` 前缀、
// 并把行首的 `#` 转义（实测：console.log / process.stdout.write / fs.writeSync(1|2) /
// process.on('exit') 钩子 / console.error / process.emitWarning 全都被挡），汇总行与
// 覆盖率表由父 runner 最后输出。因此用例无法伪造 `# tests` / `# fail 0` 来把真实失败洗白。
//
// 但这个保护来自 Node 的行为，不是我们的代码。所以这里要求每种汇总行**有且仅有一条**：
// 一旦 Node 改了转义行为，注入出来的第二条汇总行会立刻让门禁报「输出结构变了」，
// 而不是让「最后一次匹配获胜」的解析规则悄悄选到伪造值。
const KEYS = ['tests', 'pass', 'fail']

/**
 * @param {string} output node --test --test-reporter=tap 的输出（stdout 或 stdout+stderr）
 * @returns {{tests?: number, pass?: number, fail?: number, problems: string[]}}
 */
export function parseTapSummary(output) {
  const found = { tests: [], pass: [], fail: [] }
  for (const match of String(output || '').matchAll(/^# (tests|pass|fail) (\d+)$/gm)) {
    found[match[1]].push(Number(match[2]))
  }
  const problems = []
  for (const key of KEYS) {
    if (found[key].length === 0) problems.push(`没解析到 # ${key} 汇总行（测试可能根本没跑起来）`)
    else if (found[key].length > 1) {
      problems.push(`解析到 ${found[key].length} 条 # ${key} 汇总行：TAP 输出结构变了`
        + `（测试输出可能已能注入汇总行，last-wins 解析会选到伪造值）`)
    }
  }
  return {
    tests: found.tests.at(-1),
    pass: found.pass.at(-1),
    fail: found.fail.at(-1),
    problems,
  }
}
