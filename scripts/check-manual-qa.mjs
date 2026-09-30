// 手工验收清单的「N 项」自洽门：每个章节标题声明的条目数必须等于该章节里真实的条目数。
//
// 与 scripts/check-test-count.mjs 的分工：那条查「文档里的测试数字 == 实测套件规模」，
// 这条查 MANUAL-QA.md 内部的「章节声明 vs 章节内容」。MANUAL-QA.md 有意不进测试数字清单，
// 但它的章节计数同样会漂移（本轮加门时抓到 9 项 vs 实际 A1–A10 共 10 项）。
//
// 无参数、无网络、无外部真值：判定全在 scripts/lib/manual-qa-count.mjs 里，测试直接复用同一函数。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { auditManualQaCounts, MIN_COUNTED_ITEMS, MIN_COUNTED_SECTIONS } from './lib/manual-qa-count.mjs'

const FILE = fileURLToPath(new URL('../docs/MANUAL-QA.md', import.meta.url))

let markdown
try {
  markdown = readFileSync(FILE, 'utf8')
} catch (error) {
  process.stderr.write(`读不到 docs/MANUAL-QA.md：${error.message}\n`)
  process.exit(2)
}

const { sections, problems } = auditManualQaCounts(markdown)
if (problems.length) {
  process.stderr.write(`手工验收清单的「N 项」自洽检查失败（${problems.length} 处）：\n- ${problems.join('\n- ')}\n`)
  process.exit(1)
}

const total = sections.reduce((sum, section) => sum + section.ids.length, 0)
process.stdout.write(`手工验收清单计数通过：${sections.length} 个章节声明「N 项」（下限 ${MIN_COUNTED_SECTIONS}）、受看守条目 ${total} 条（下限 ${MIN_COUNTED_ITEMS}），逐章与声明一致。\n`)
