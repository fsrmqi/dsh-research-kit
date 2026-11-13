import test from 'node:test'
import assert from 'node:assert/strict'
import { isTestProjectName, selectTestProjects } from '../src/lib/test-projects.js'

test('测试课题识别：只命中明显的测试/演示/探针名，真实课题与 default 不误伤', () => {
  for (const name of ['mcp-test', 'openalex-test', 'demo-crispr', 'dedup-probe', 'list-order-2', 'concurrency-test-mu6ct9a4', 'codex-live-check', 'phase2-test', 'test-run']) {
    assert.equal(isTestProjectName(name), true, name)
  }
  for (const name of ['barley-NP1-IPE1-family', '大麦候选基因A-5438bp插入雄性不育', 'default', 'testosterone', 'attest', '', null]) {
    assert.equal(isTestProjectName(name), false, String(name))
  }
})

test('default 兜底桶：整桶都像调试/测试时才纳入，混有真实标题时不清理', () => {
  assert.deepEqual(selectTestProjects([{ project: 'default', title: 'Debug Entry' }]), [{ project: 'default', count: 1 }])
  assert.deepEqual(selectTestProjects([{ project: 'default', title: 'Nature 论文：真实证据' }]), [])
  assert.deepEqual(selectTestProjects([
    { project: 'default', title: 'Test Entry' },
    { project: 'default', title: '真实观测记录' },
  ]), [], '只要有一条像真实内容，整个 default 桶都不动')
})

test('测试课题汇总：按项目计数并按名称稳定排序', () => {
  const rows = selectTestProjects([
    { project: 'mcp-test' }, { project: 'list-order-2' }, { project: 'mcp-test' },
    { project: '大麦候选基因A-5438bp插入雄性不育' }, { project: '' }, null,
    { project: 'openalex-test' },
  ])
  assert.deepEqual(rows, [
    { project: 'list-order-2', count: 1 },
    { project: 'mcp-test', count: 2 },
    { project: 'openalex-test', count: 1 },
  ])
})
