// 文档里「测试用例数 / 测试文件数」的规范句式。
//
// 两个消费者共用这一份清单：
//   scripts/check-doc-stats.mjs —— 只查「各文档彼此一致」（抓 429/437 那类互相矛盾）；
//   scripts/check-test-count.mjs —— 查「文档 == 实测」（真值来自跑一遍测试套件）。
// 拆成 lib 是为了避免两份正则各自漂移：以前只有前者，于是文档从 429 一路漂到 437 也没人发现。

/** 规范句式 → 该句式出现在哪个文档。捕获组 1 = 用例数，捕获组 2 = 文件数（可选）。 */
export const TEST_COUNT_PATTERNS = [
  { file: 'README.md', re: /(\d+) 项回归测试（(\d+) 个测试文件/, label: 'README 中文门面' },
  { file: 'README.md', re: /(\d+) 项 \/ (\d+) 个测试文件/, label: 'README 中文正文' },
  { file: 'README.en.md', re: /(\d+) regression tests in (\d+) files/, label: 'README 英文门面' },
  { file: 'README.en.md', re: /\((\d+) \/ (\d+) files\)/, label: 'README 英文命令段' },
  { file: 'docs/README.md', re: /(\d+) 项测试（(\d+) 个测试文件）/, label: '文档索引' },
  { file: 'docs/ARCHITECTURE.md', re: /(\d+) 项测试（(\d+) 个测试文件/, label: '架构文档' },
  { file: 'docs/DEVELOPMENT.md', re: /(\d+) 项 \/ (\d+) 个测试文件/, label: '开发手册命令段' },
  { file: 'docs/DEVELOPMENT.md', re: /仓库内 (\d+) 项测试/, label: '开发手册正文' },
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
 *   hits: Array<{file: string, label: string, testCount: number, fileCount?: number, raw: string, line: number}>,
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
      hits.push({ file: pattern.file, label: pattern.label, testCount, fileCount, raw: match[0], line })
      testValues.add(testCount)
      if (fileCount !== undefined) fileValues.add(fileCount)
    }
  }
  return { hits, testValues, fileValues, uncovered }
}
