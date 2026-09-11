import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildEvidenceExplainPack, evidenceExplainCard } from '../src/lib/evidence-vault-core.js'

// 证据库 → 解释图素材包（buildEvidenceExplainPack / evidenceExplainCard）与
// render-diagrams --evidence 的集成契约。设计见 docs-internal/research-route-visualization.md §7.3。

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const RENDERER = join(root, 'scripts', 'render-diagrams.mjs')

const ENTRIES = [
  { id: 'ev-1', title: 'Ms2 图位克隆', identifier: '10.1038/s41588-017-0006-9', identifierKind: 'doi', url: 'https://doi.org/10.1038/s41588-017-0006-9', sourceDatabase: 'Europe PMC', status: 'verified', note: '两团队独立克隆', tags: ['小麦'], savedAt: 1700000000000 },
  { id: 'ev-2', title: 'QMS-5B 主效 QTL', identifier: 'PMID:38888000', identifierKind: 'pmid', sourceDatabase: 'PubMed', status: 'unverified', savedAt: 1700000100000 },
]

test('素材包：只携带稳定标识符与公开链接字段，不带 id/时间戳/检索词', () => {
  const pack = buildEvidenceExplainPack(ENTRIES, '麦类核不育综述')
  assert.equal(pack.format, 'dsh-research-kit/evidence-explain-pack')
  assert.equal(pack.version, 1)
  assert.equal(pack.project, '麦类核不育综述')
  assert.equal(pack.entries.length, 2)
  for (const entry of pack.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['identifier', 'identifierKind', 'note', 'sourceDatabase', 'status', 'tags', 'title', 'url'])
    assert.ok(!('savedAt' in entry), '时间戳不进素材包（渲染确定性由内容决定）')
  }
})

test('证据卡片：全部已核验时标题升级，未核验如实标注', () => {
  const verifiedOnly = evidenceExplainCard([ENTRIES[0], { ...ENTRIES[1], status: 'verified' }])
  assert.equal(verifiedOnly.title, '已核验证据 · 证据库')
  assert.match(verifiedOnly.items[0], /DOI:10\.1038\/s41588-017-0006-9 · Europe PMC（已核验）/)
  const mixed = evidenceExplainCard(ENTRIES)
  assert.equal(mixed.title, '证据库来源（含核验状态）')
  assert.match(mixed.items[1], /（未核验）/)
})

test('证据卡片：按标识符+标题去重', () => {
  const card = evidenceExplainCard([ENTRIES[0], ENTRIES[0], { ...ENTRIES[0], id: 'ev-3' }])
  assert.equal(card.items.length, 1)
  assert.equal(evidenceExplainCard([]), null)
})

test('渲染器：--evidence 素材包并入「证据库来源」卡片且字节确定', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-evidence-'))
  try {
    const irPath = join(dir, 'ir.json')
    writeFileSync(irPath, JSON.stringify({
      meta: { id: 'ev-render', title: '证据解释图', locale: 'zh-CN', canvas: { width: 600, height: 200 } },
      nodes: [{ id: 'a', kind: 'workflow', label: '审阅论文', x: 40, y: 60 }],
      edges: [], routes: [],
    }))
    const packPath = join(dir, 'pack.json')
    writeFileSync(packPath, JSON.stringify(buildEvidenceExplainPack(ENTRIES, '麦类核不育综述')))
    const outA = join(dir, 'a.html'); const outB = join(dir, 'b.html')
    execFileSync('node', [RENDERER, '--html', irPath, '--evidence', packPath, '-o', outA], { cwd: root })
    execFileSync('node', [RENDERER, '--html', irPath, '--evidence', packPath, '-o', outB], { cwd: root })
    assert.equal(readFileSync(outA, 'utf8'), readFileSync(outB, 'utf8'), '渲染必须确定性')
    const html = readFileSync(outA, 'utf8')
    assert.match(html, /证据库来源（含核验状态）/, '混合状态时标题应如实')
    assert.match(html, /Ms2 图位克隆 — DOI:10\.1038\/s41588-017-0006-9 · Europe PMC（已核验）/)
    assert.match(html, /（未核验）/, '未核验条目不得冒充已核验')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('渲染器：IR 内嵌 evidence 字段同样并入卡片', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-evidence-'))
  try {
    const irPath = join(dir, 'ir.json')
    writeFileSync(irPath, JSON.stringify({
      meta: { id: 'ev-inline', title: '内嵌证据', locale: 'zh-CN', canvas: { width: 600, height: 200 } },
      nodes: [{ id: 'a', kind: 'workflow', label: '审阅论文', x: 40, y: 60 }],
      edges: [], routes: [],
      evidence: [{ title: '会话内核验的条目', identifier: 'PMID:12345678', identifierKind: 'pmid', status: 'verified' }],
    }))
    const out = join(dir, 'out.html')
    execFileSync('node', [RENDERER, '--html', irPath, '-o', out], { cwd: root })
    const html = readFileSync(out, 'utf8')
    assert.match(html, /已核验证据 · 证据库/)
    assert.match(html, /会话内核验的条目 — PMID:12345678（已核验）/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
