import { readFileSync } from 'node:fs'
import { matchResearchSuggestion } from '../src/composer-overlay.js'

const casesBySet = JSON.parse(readFileSync(new URL('./lib/research-suggestion-cases.json', import.meta.url)))
const set = process.argv[2] ?? 'regression'
if (!Object.hasOwn(casesBySet, set)) {
  console.error('用法：node scripts/check-research-suggestions.mjs [development|regression]')
  process.exit(2)
}

let positive = 0
let negative = 0
let missed = 0
let falseTriggers = 0
let wrongWorkflow = 0
for (const { draft, materials = 0, previous = '', expected } of casesBySet[set]) {
  const actual = matchResearchSuggestion(draft, materials, () => previous)?.id ?? null
  if (expected === null) negative++
  else positive++
  if (actual === expected) continue
  if (expected === null) falseTriggers++
  else if (actual === null) missed++
  else wrongWorkflow++
  console.error(`- ${draft}  期望 ${expected ?? '不提示'}，实际 ${actual ?? '不提示'}`)
}
console.log(`科研推荐评测 ${set}：应提示 ${positive} 条，漏提示 ${missed} 条，选错 ${wrongWorkflow} 条；应静默 ${negative} 条，误提示 ${falseTriggers} 条。`)
if (set === 'regression' && (missed || falseTriggers || wrongWorkflow)) process.exitCode = 1
