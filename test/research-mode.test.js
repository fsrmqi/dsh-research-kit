import test from 'node:test'
import assert from 'node:assert/strict'
import skills from '../catalog/skills/index.js'
import { catalog } from '../src/catalog.js'
import { SCIENCE_MODE_PRESETS, filterWorkflowCategory } from '../src/research-workbench.js'

test('科研模式采用六项当前任务预设，不保留旧的基因遗传模式', () => {
  assert.deepEqual(Object.keys(SCIENCE_MODE_PRESETS), [
    'general', 'literature', 'bioinformatics', 'cropBreeding', 'clinical', 'dataVisualization',
  ])
  assert.deepEqual(Object.values(SCIENCE_MODE_PRESETS).map(preset => preset.label), [
    '通用研究', '文献与论文', '生物信息学', '作物遗传育种', '临床与人群研究', '数据分析与可视化',
  ])
})

test('科研模式引用的指导技能均来自当前目录', () => {
  const availableSkillIds = new Set(skills.map(skill => skill.id))
  for (const preset of Object.values(SCIENCE_MODE_PRESETS)) {
    assert.ok(preset.preamble.includes('【'), `${preset.label} 缺少领域纪律段`)
    for (const skillId of preset.skills) assert.ok(availableSkillIds.has(skillId), `${preset.label} 引用了不存在的技能 ${skillId}`)
  }
})

test('工作流程分类筛选仅保留所选分类，全部分类不丢失条目', () => {
  const workflows = catalog.filter(item => item.type === 'workflow')
  const bioinformatics = filterWorkflowCategory(workflows, '生物信息学')
  assert.ok(bioinformatics.length > 0)
  assert.ok(bioinformatics.every(item => item.category === '生物信息学'))
  assert.equal(filterWorkflowCategory(workflows).length, workflows.length)
})
