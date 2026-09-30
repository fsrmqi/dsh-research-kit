// 文档里「测试用例数 / 测试文件数」的规范句式。
//
// 三个消费者共用这一份清单与同一份判定：
//   scripts/check-doc-stats.mjs —— 只查「各文档彼此一致」（抓 429/437 那类互相矛盾）；
//   scripts/check-test-count.mjs —— 查「文档 == 实测」（真值来自跑一遍测试套件）；
//   scripts/check-coverage.mjs --with-docs —— 同上，但复用覆盖率那一遍套件的汇总，少跑一遍套件。
// 拆成 lib 是为了避免两份正则各自漂移：以前只有前者，于是文档从 429 一路漂到 437 也没人发现。
// 判定逻辑也只留一份（docTestCountProblems），否则「少跑一遍套件」会变成「两套口径」。

/**
 * 规范句式 → 该句式出现在哪个文档。捕获组 1 = 用例数，捕获组 2 = 文件数（可选）。
 *
 * `constant`：该句式的真值不是套件总数，而是一个**冻结常量**（见 COMPATIBILITY 的
 * 「每个基线恒定 N 个用例」——它说的是矩阵文件自己的形状）。带 constant 的句式不参与
 * 「各文档彼此一致」的比对（check-doc-stats），只由 check-test-count 按常量校验。
 *
 * 有意豁免、不进清单的文件：`CHANGELOG.md`（历史条目记录的是当时的数字，本就该留在过去）、
 * `docs/MANUAL-QA.md`（讲人工验收步骤，没有测试计数）。新增读者文档写进测试数字时，
 * 请同时在这里加一条句式——否则那个数字就是没人看守的。
 */
export const TEST_COUNT_PATTERNS = [
  { file: 'README.md', re: /(\d+) 项回归测试（(\d+) 个测试文件/, label: 'README 中文门面' },
  { file: 'README.md', re: /(\d+) 项 \/ (\d+) 个测试文件/, label: 'README 中文正文' },
  { file: 'README.en.md', re: /(\d+) regression tests in (\d+) files/, label: 'README 英文门面' },
  { file: 'README.en.md', re: /\((\d+) \/ (\d+) files\)/, label: 'README 英文命令段' },
  { file: 'docs/README.md', re: /(\d+) 项测试（(\d+) 个测试文件）/, label: '文档索引' },
  { file: 'docs/ARCHITECTURE.md', re: /(\d+) 项测试（(\d+) 个测试文件/, label: '架构文档' },
  { file: 'docs/DEVELOPMENT.md', re: /(\d+) 项 \/ (\d+) 个测试文件/, label: '开发手册命令段' },
  { file: 'docs/DEVELOPMENT.md', re: /仓库内 (\d+) 项测试/, label: '开发手册正文' },
  { file: 'docs/COMPATIBILITY.md', re: /每个基线恒定 (\d+) 个用例/, label: '兼容性矩阵每基线用例数', constant: 5 },
]

/**
 * 从文档里抽出所有命中的数字。
 *
 * 两个刻意的设计：
 *   1. **全局匹配同一句式在同一文件里的每一次出现**——以前用 `re.exec` 只看第一次，
 *      同一份文档里第二处写错数字不会被发现；
 *   2. **`uncovered` 报告未命中的句式**——句式被改写（或正则写错，例如把中文句式挂到
 *      英文文档上）会让这条数字**彻底无人看守**且毫无信号。消费者应当据此失败，
 *      而不是静默继续：check-test-count 就是这么做的。
 *
 * @param {(file: string) => string} readOnce 读取文档内容（带缓存由调用方决定）
 * @returns {{
 *   hits: Array<{file: string, label: string, testCount: number, fileCount?: number, raw: string, line: number, expected?: number}>,
 *   testValues: Set<number>, fileValues: Set<number>,
 *   uncovered: Array<{file: string, label: string}>,
 * }}
 */
export function collectDocTestCounts(readOnce) {
  const hits = []
  const testValues = new Set()
  const fileValues = new Set()
  const uncovered = []
  for (const pattern of TEST_COUNT_PATTERNS) {
    const content = readOnce(pattern.file)
    const global = new RegExp(pattern.re.source, pattern.re.flags.includes('g') ? pattern.re.flags : `${pattern.re.flags}g`)
    const matches = [...content.matchAll(global)]
    if (!matches.length) {
      uncovered.push({ file: pattern.file, label: pattern.label })
      continue
    }
    for (const match of matches) {
      const testCount = Number(match[1])
      const fileCount = match[2] === undefined ? undefined : Number(match[2])
      const line = content.slice(0, match.index).split('\n').length
      hits.push({
        file: pattern.file,
        label: pattern.label,
        testCount,
        fileCount,
        raw: match[0],
        line,
        expected: pattern.constant,
      })
      // 常量句式不参与「文档之间彼此一致」的比对：它的真值来自矩阵形状，不是套件总数。
      if (pattern.constant === undefined) {
        testValues.add(testCount)
        if (fileCount !== undefined) fileValues.add(fileCount)
      }
    }
  }
  return { hits, testValues, fileValues, uncovered }
}

/**
 * 句式清单数量下限：删句式 = 让那条数字无人看守（新增句式时同步抬高）。
 */
export const MIN_PATTERNS = 9

/**
 * 「文档测试数字是否说了真话」的完整判定：句式完整性 + 逐处与实测比对。
 *
 * 只保留一份实现，供两条路径共用：`npm run check:test-count`（自己跑一遍套件）与
 * `npm run coverage:ci`（复用覆盖率那一遍套件的汇总）。两条路径不可能给出不同结论。
 *
 * @param {{tests: number, testFiles: number, readOnce: (file: string) => string}} measured
 * @returns {{problems: string[], hits: ReturnType<typeof collectDocTestCounts>['hits']}}
 */
export function docTestCountProblems({ tests, testFiles, readOnce }) {
  const problems = []
  const { hits, uncovered } = collectDocTestCounts(readOnce)
  if (TEST_COUNT_PATTERNS.length < MIN_PATTERNS) {
    problems.push(`文档测试数字的句式只有 ${TEST_COUNT_PATTERNS.length} 条（下限 ${MIN_PATTERNS}）：`
      + '删句式等于让那条数字无人看守；确实不需要看守时请同步改 scripts/lib/doc-test-count.mjs 的 MIN_PATTERNS 并在 PR 说明')
  }
  // 句式未命中不是「文档恰好换了说法」这么简单：它意味着这条数字**再也没有人看守**。
  // 本检查存在的理由正是「门禁看住了互相不矛盾，却没看住说的是真的」，所以这里必须失败。
  for (const item of uncovered) {
    problems.push(`${item.file} 的「${item.label}」句式已失效：正则不再命中任何内容——`
      + `文档换了措辞就同步 scripts/lib/doc-test-count.mjs 的 TEST_COUNT_PATTERNS，`
      + `确实是这条数字不需要看守了就把该句式删掉（否则它会一直静默失效）`)
  }
  for (const hit of hits) {
    // expected 存在时代表这条句式的真值不是套件总数（例如「每个基线恒定 N 个用例」是矩阵自己的常量）。
    const expected = hit.expected ?? tests
    if (hit.testCount !== expected) {
      problems.push(`${hit.file}:${hit.line} 的「${hit.raw}」写作 ${hit.testCount} 项，应为 ${expected} 项（${hit.label}）`)
    }
    if (hit.fileCount !== undefined && hit.fileCount !== testFiles) {
      problems.push(`${hit.file}:${hit.line} 的「${hit.raw}」写作 ${hit.fileCount} 个测试文件，实测 ${testFiles} 个（${hit.label}）`)
    }
  }
  return { problems, hits }
}
