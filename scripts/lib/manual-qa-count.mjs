// docs/MANUAL-QA.md 里「（N 项）」的自洽检查。
//
// 为什么要单独一条：MANUAL-QA.md **有意**不进 `TEST_COUNT_PATTERNS`（它讲人工验收步骤，不是测试
// 计数），但它的每个章节都在标题里声明「本章有 N 项」。这个数字过去没有任何看守——本轮加上门禁
// 后就立刻抓到一处真实漂移：「自动与逐条沉淀链路」声明 9 项，实际 A1–A10 共 10 项。
//
// 规则是**自洽**而非对照某个外部真值：标题声明的数字必须等于该章节里真实存在的条目数。条目有两种
// 写法——表格行 `| F1 | … |` 与小节标题 `### F1 …`——两种都算；只认表格行会把 §2 快线（F1–F4 是
// 小节标题）、§3 发布门槛（R1–R2 同理）误判成 0 项。
//
// fail-closed：声明了 N 项却一条都没识别出来 = 条目句式漂移（门变成空转），必须失败而不是放过。
// 另设「章节数」与「条目总数」两条下限，防止删掉几个章节让门悄悄失去看守对象。

const HEADING_RE = /^(#{2,4})\s+(.*)$/
const DECLARED_COUNT_RE = /（[^）]*?([0-9]+)\s*项[^）]*）/
const ITEM_ROW_RE = /^\|\s*([A-Z][0-9]{1,2})\s*\|/
const ITEM_SUBHEADING_RE = /^#{3,4}\s+([A-Z][0-9]{1,2})(?:\s|$)/

// 下限（只许涨）：受看守章节数与这些章节里的条目总数。
export const MIN_COUNTED_SECTIONS = 11
export const MIN_COUNTED_ITEMS = 43

/**
 * 审计 markdown 里每个声明了「N 项」的章节。
 *
 * 下限可注入只为测试方便（小夹具不该被真实文档的规模下限拦住）；CLI 走默认值。
 * @returns {{sections: Array<{title: string, line: number, declared: number, ids: string[]}>, problems: string[]}}
 */
export function auditManualQaCounts(markdown, { minSections = MIN_COUNTED_SECTIONS, minItems = MIN_COUNTED_ITEMS } = {}) {
  const lines = String(markdown ?? '').split('\n')
  const headings = []
  lines.forEach((line, index) => {
    const match = HEADING_RE.exec(line)
    if (match) headings.push({ level: match[1].length, title: match[2].trim(), line: index + 1 })
  })

  const sections = []
  const problems = []
  headings.forEach((heading, position) => {
    const declared = DECLARED_COUNT_RE.exec(heading.title)
    if (!declared) return
    const expected = Number(declared[1])
    // 章节块 = 本标题之后，直到下一个层级不高于它的标题。
    let end = lines.length
    for (let index = position + 1; index < headings.length; index++) {
      if (headings[index].level <= heading.level) { end = headings[index].line - 1; break }
    }
    const ids = []
    for (let index = heading.line; index < end; index++) {
      const row = ITEM_ROW_RE.exec(lines[index])
      if (row) { ids.push(row[1]); continue }
      const subheading = ITEM_SUBHEADING_RE.exec(lines[index])
      if (subheading) ids.push(subheading[1])
    }
    sections.push({ title: heading.title, line: heading.line, declared: expected, ids })
    if (ids.length === 0) {
      problems.push(`${heading.line} 行的「${heading.title}」声明 ${expected} 项，却一条条目都没识别到——条目句式变了，这个数字门会变成空转，必须修`)
    } else if (ids.length !== expected) {
      problems.push(`${heading.line} 行的「${heading.title}」声明 ${expected} 项，实际 ${ids.length} 项（${ids.join(' / ')}）`)
    }
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
    if (duplicates.length) problems.push(`${heading.line} 行的「${heading.title}」有重复条目 ID：${duplicates.join('、')}`)
  })

  if (sections.length < minSections) {
    problems.push(`声明「N 项」的章节只有 ${sections.length} 个（下限 ${minSections}）：删章节或改写标题都会让这些数字失去看守；确实要减少时同步改 scripts/lib/manual-qa-count.mjs 的下限并在 PR 说明`)
  }
  const total = sections.reduce((sum, section) => sum + section.ids.length, 0)
  if (total < minItems) {
    problems.push(`受看守章节的条目总数只有 ${total} 条（下限 ${minItems}）：条目被删或被挪出这些章节时要显式更新下限`)
  }
  return { sections, problems }
}
