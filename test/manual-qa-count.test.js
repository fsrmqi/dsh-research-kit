import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { auditManualQaCounts, MIN_COUNTED_ITEMS, MIN_COUNTED_SECTIONS } from '../scripts/lib/manual-qa-count.mjs'

// 小夹具用注入下限，避免被真实文档的规模下限拦住（门禁本身走默认值）。
const loose = { minSections: 1, minItems: 1 }
const table = rows => `| # | 检查项 | 预期 | 结果 |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`

test('手工验收计数：条目是小节标题时也算（§2 快线那种写法）', () => {
  const markdown = '## 2. 快线（4 项，约 6 分钟）\n\n### F1 槽位注册无重复\n\n### F2 四分区可切换\n\n### F3 写入不发送\n\n### F4 切换会话不串台\n'
  const { sections, problems } = auditManualQaCounts(markdown, loose)
  assert.deepEqual(problems, [])
  assert.deepEqual(sections[0].ids, ['F1', 'F2', 'F3', 'F4'])
})

test('手工验收计数：条目是表格行时也算，且章节边界不吃掉下一章的条目', () => {
  const markdown = `## 2. 快线（2 项）\n\n${table(['| F1 | 甲 | 预期 |', '| F2 | 乙 | 预期 |'])}\n## 3. 发布门槛（1 项）\n\n| R1 | 丙 | 预期 |\n`
  const { sections, problems } = auditManualQaCounts(markdown, loose)
  assert.deepEqual(problems, [])
  assert.deepEqual(sections.map(section => section.ids), [['F1', 'F2'], ['R1']])
})

test('手工验收计数：声明数与实际数不符时点名章节与差值（真实漂移回归：9 项 vs A1–A10）', () => {
  const rows = Array.from({ length: 10 }, (_, index) => `| A${index + 1} | 步骤 | 预期 | |`)
  const markdown = `### 自动与逐条沉淀链路（9 项，尚未现场执行）\n\n${table(rows)}`
  const { problems } = auditManualQaCounts(markdown, loose)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /声明 9 项，实际 10 项/)
  assert.match(problems[0], /A1 \/ A2 \/ A3/)
})

test('手工验收计数：声明了 N 项却一条条目都识别不到 → fail-closed（不能当成通过）', () => {
  const markdown = '### 插件详情页（5 项，约 3 分钟）\n\n本章条目改用无序列表了：\n\n- P1 打开 Plugins 页\n'
  // minItems 归零：本用例只验「识别不到条目」这条 fail-closed，不叠加条目下限。
  const { problems } = auditManualQaCounts(markdown, { minSections: 1, minItems: 0 })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /一条条目都没识别到/)
})

test('手工验收计数：同一章节里的重复条目 ID 也要报出来', () => {
  const markdown = `### 数据源能力标注（2 项）\n\n${table(['| D1 | 甲 | 预期 |', '| D1 | 乙 | 预期 |'])}`
  const { problems } = auditManualQaCounts(markdown, loose)
  assert.deepEqual(problems, ['1 行的「数据源能力标注（2 项）」有重复条目 ID：D1'])
})

test('手工验收计数：章节数与条目总数低于下限时失败（防「删章节让门失去看守对象」）', () => {
  const markdown = `### 数据源能力标注（1 项）\n\n${table(['| D1 | 甲 | 预期 |'])}`
  const { problems } = auditManualQaCounts(markdown)
  assert.equal(problems.length, 2)
  assert.match(problems.join('\n'), new RegExp(`章节只有 1 个（下限 ${MIN_COUNTED_SECTIONS}）`))
  assert.match(problems.join('\n'), new RegExp(`条目总数只有 1 条（下限 ${MIN_COUNTED_ITEMS}）`))
})

test('手工验收计数：真实 docs/MANUAL-QA.md 通过门禁（默认下限）', () => {
  const markdown = readFileSync(new URL('../docs/MANUAL-QA.md', import.meta.url), 'utf8')
  const { sections, problems } = auditManualQaCounts(markdown)
  assert.deepEqual(problems, [])
  assert.ok(sections.length >= MIN_COUNTED_SECTIONS, `受看守章节应不少于 ${MIN_COUNTED_SECTIONS} 个，实际 ${sections.length}`)
  const total = sections.reduce((sum, section) => sum + section.ids.length, 0)
  assert.ok(total >= MIN_COUNTED_ITEMS, `受看守条目应不少于 ${MIN_COUNTED_ITEMS} 条，实际 ${total}`)
  // 抽查一章：声明的数字必须等于该章实际条目数（防止「有人把某个标题的数字删了」而门禁毫无感觉）。
  const spot = sections.find(section => section.title.includes('动线整合'))
  assert.ok(spot, '应能找到「动线整合 · 资产-证据互链」章节')
  assert.equal(spot.ids.length, spot.declared)
})
