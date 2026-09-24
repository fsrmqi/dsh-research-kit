import test from 'node:test'
import assert from 'node:assert/strict'
import { ARCHIVED_TEST_WORKSPACE, buildProjectOrganizationPlan, classifyLegacyProject } from '../src/lib/project-organizer.js'

test('任务型项目自动建议归档，科研项目只在内容一致时默认勾选', () => {
  assert.equal(classifyLegacyProject('concurrency-test-mu6ct9a4').to, ARCHIVED_TEST_WORKSPACE)
  assert.equal(classifyLegacyProject('list-order-3').category, 'test')
  assert.equal(classifyLegacyProject('demo-crispr').category, 'demo')
  assert.equal(classifyLegacyProject('barley-NP1-IPE1-family').confidence, 'review')
  assert.equal(classifyLegacyProject('真实课题'), null)
  const plan = buildProjectOrganizationPlan({
    evidence: [{ project: 'barley-NP1-IPE1-family', title: 'Barley NP1 family' }, { project: 'dedup-probe', title: '来源' }],
    assets: [{ project: 'barley-NP1-IPE1-family' }],
  })
  assert.equal(plan.find(item => item.category === 'research').selected, true)
  assert.equal(plan.find(item => item.category === 'research').counts.assets, 1)
  assert.equal(plan.find(item => item.category === 'test').selected, true)
})
