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
  { file: 'README.en.md', re: /(\d+) 项 \/ (\d+) 个测试文件/, label: 'README 英文正文' },
  { file: 'README.en.md', re: /(\d+) regression tests in (\d+) files/, label: 'README 英文门面' },
  { file: 'README.en.md', re: /\((\d+) \/ (\d+) files\)/, label: 'README 英文命令段' },
  { file: 'docs/README.md', re: /(\d+) 项测试（(\d+) 个测试文件）/, label: '文档索引' },
  { file: 'docs/ARCHITECTURE.md', re: /(\d+) 项测试（(\d+) 个测试文件/, label: '架构文档' },
  { file: 'docs/DEVELOPMENT.md', re: /(\d+) 项 \/ (\d+) 个测试文件/, label: '开发手册命令段' },
  { file: 'docs/DEVELOPMENT.md', re: /仓库内 (\d+) 项测试/, label: '开发手册正文' },
]

/**
 * 从文档里抽出所有命中的数字。
 * @param {(file: string) => string} readOnce 读取文档内容（带缓存由调用方决定）
 * @returns {{ hits: Array<{file: string, label: string, testCount: number, fileCount?: number, raw: string}>, testValues: Set<number>, fileValues: Set<number> }}
 */
export function collectDocTestCounts(readOnce) {
  const hits = []
  const testValues = new Set()
  const fileValues = new Set()
  for (const pattern of TEST_COUNT_PATTERNS) {
    const match = pattern.re.exec(readOnce(pattern.file))
    if (!match) continue
    const testCount = Number(match[1])
    const fileCount = match[2] === undefined ? undefined : Number(match[2])
    hits.push({ file: pattern.file, label: pattern.label, testCount, fileCount, raw: match[0] })
    testValues.add(testCount)
    if (fileCount !== undefined) fileValues.add(fileCount)
  }
  return { hits, testValues, fileValues }
}
