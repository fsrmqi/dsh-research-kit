import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RESEARCH_SLOTS, registerResearchSlots } from '../dsh/slot-registry.js'

// slot 注册表是纯数据模块（无 React 依赖），测试直接调用注册动作验证完整注册序列；
// 生成产物另做包含性检查，确认构建器把新模块拼进了 ui/client.js。
test('DSH 客户端注册唯一视图、输入框入口、浮层与草稿增强器', () => {
  const registrations = []
  const dispose = registerResearchSlots(
    {
      slots: {
        inject(_slot, callback) { return callback() },
        register(options, component) { registrations.push({ options, component }); return () => {} }
      }
    },
    RESEARCH_SLOTS.map(() => function PlaceholderComponent() {})
  )
  assert.equal(typeof dispose, 'function')
  assert.deepEqual(registrations.map(row => row.options.name), [
    'conversation.view',
    'conversation.input.left',
    'conversation.input.overlay',
    'conversation.input.right'
  ])
  // 三个并列视图已合并为单一容器视图；分区改由容器内部的二级导航承载。
  assert.deepEqual(registrations.filter(row => row.options.name === 'conversation.view').map(row => row.options.id), [
    'dsh-research-kit-console'
  ])
  assert.deepEqual(registrations.filter(row => row.options.name === 'conversation.input.right').map(row => row.options.id), [
    'dsh-research-kit-draft-enhancer'
  ])
  assert.ok(registrations.every(row => typeof row.component === 'function'))
  // 草稿增强器优先级必须低于发送按钮等宿主控件（order 越小越靠后/越次要）。
  const enhancer = RESEARCH_SLOTS.find(row => row.id === 'dsh-research-kit-draft-enhancer')
  assert.equal(enhancer.order, 80)
  assert.equal(RESEARCH_SLOTS.length, 4)
})

test('生成产物包含新模块并使用 research-kit 命名空间', () => {
  const source = readFileSync(new URL('../ui/client.js', import.meta.url), 'utf8')
  assert.match(source, /dsh-research-kit-draft-enhancer/)
  assert.match(source, /dsh-research-kit-console/)
  assert.match(source, /dsh-research-kit\/semantic-enhance/)
  // 合并后的分区契约与四个分区的实现都必须拼入产物。
  assert.match(source, /RESEARCH_CONSOLE_SECTIONS/)
  assert.match(source, /function ResearchConsole\(/)
  assert.match(source, /function ResearchWorkbench\(/)
  assert.match(source, /function ResearchVault\(/)
  assert.match(source, /function ResearchEvidenceGraph\(/)
  assert.match(source, /function ResearchPromptStudioHost\(/)
  // 不得出现 PromptKit 独立仓库的路径或默认 storage 前缀泄漏。
  assert.ok(!source.includes('/dsh-promptkit/semantic-enhance'), '浏览器端不得回退到 PromptKit 独立插件路由')
  assert.ok(!source.includes("storagePrefix: 'promptkit.'"), '不得使用 PromptKit 默认 storage 前缀')
})
