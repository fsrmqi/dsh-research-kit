import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { serializeResearchTransfer, parseResearchTransfer, previewResearchTransfer } from '../src/lib/research-transfer.js'
import { ResearchToolView } from '../src/research-toolview.js'

function samplePayload() {
  return {
    evidence: { kind: 'dsh-research-kit-evidence', version: 3, project: '', entries: [], claims: [], links: [], ledger: [], workspaces: [] },
    knowledge: { kind: 'dsh-research-kit-knowledge', version: 1, nodes: [], claims: [] },
    assets: [{ id: 'asset:one', body: '待验证的研究问题', title: '问题' }],
    runs: [{ id: 'run:one', project: '大麦' }],
  }
}

test('App 迁移包校验完整性，并拒绝篡改和缺项', async () => {
  const serialized = await serializeResearchTransfer(samplePayload())
  const parsed = await parseResearchTransfer(serialized)
  assert.equal(parsed.assets[0].id, 'asset:one')
  assert.equal(parsed.runs[0].project, '大麦')
  await assert.rejects(parseResearchTransfer(serialized.replace('待验证的研究问题', '已验证的研究问题')), /校验失败/)
  const incomplete = samplePayload()
  delete incomplete.knowledge
  await assert.rejects(parseResearchTransfer(await serializeResearchTransfer(incomplete)), /知识库/)
})

test('App 迁移预览按稳定 ID 区分新增与已有', () => {
  const incoming = samplePayload()
  const current = samplePayload()
  current.assets = [{ id: 'asset:two', body: '本端资产' }]
  assert.deepEqual(previewResearchTransfer(incoming, current).assets, { total: 1, add: 1, existing: 0 })
  current.assets = incoming.assets
  assert.deepEqual(previewResearchTransfer(incoming, current).assets, { total: 1, add: 0, existing: 1 })
})

test('科研工具详情卡在准备与结果阶段使用主题变量且可在窄窗口折行', () => {
  const preparing = renderToStaticMarkup(createElement(ResearchToolView, {
    phase: 'preparing', toolName: 'mcp__dsh-research-kit__research_evidence_save',
    useToolCallArgumentsPartial: () => '',
  }))
  const result = renderToStaticMarkup(createElement(ResearchToolView, {
    phase: 'result', toolName: 'mcp__dsh-research-kit__research_evidence_save',
    block: { content: [{ type: 'text', text: '{}' }] },
  }))
  for (const html of [preparing, result]) {
    assert.match(html, /var\(--rk-surface\)/)
    assert.match(html, /overflow-wrap:anywhere/)
    assert.doesNotMatch(html, /#f6f8fa|background:#fff/)
  }
})
