import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// diagram IR 工具链（scripts/validate-diagrams.mjs + scripts/render-diagrams.mjs）的契约测试。
// 覆盖：10 条规则码逐条触发、脚手架确定性、渲染字节确定性、文本注入防线、哈希防过期。
// 设计文档：docs-internal/research-route-visualization.md §5。

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const VALIDATOR = join(root, 'scripts', 'validate-diagrams.mjs')
const RENDERER = join(root, 'scripts', 'render-diagrams.mjs')

function run(script, args, options = {}) {
  try {
    const stdout = execFileSync('node', [script, ...args], { encoding: 'utf8', cwd: root, ...options })
    return { stdout, code: 0 }
  } catch (error) {
    return { stdout: String(error.stdout || ''), code: error.status ?? 1 }
  }
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-diagram-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function goodIr(sourcePath, sha) {
  return {
    meta: { id: 'contract-good', title: '契约解释图', locale: 'zh-CN', animation: 'none', canvas: { width: 760, height: 300 } },
    nodes: [
      { id: 'f1', kind: 'file', label: '结果数据', x: 40, y: 60, source: { path: sourcePath, ...(sha ? { sha256: sha } : {}) } },
      { id: 's1', kind: 'finding', label: '关键发现', x: 330, y: 60 },
      { id: 'b1', kind: 'boundary', label: '待人工核验', x: 570, y: 60 },
    ],
    edges: [
      { id: 'e1', from: 'f1', to: 's1' },
      { id: 'e2', from: 's1', to: 'b1' },
    ],
    routes: [{ id: 'r1', label: '分析路线', edgeIds: ['e1', 'e2'] }],
  }
}

test('校验器：好图通过且退出码为 0', () => {
  const { dir, cleanup } = sandbox()
  const dataPath = join(dir, 'de.csv')
  writeFileSync(dataPath, 'gene,pvalue\nBRCA1,0.001\n')
  const irPath = join(dir, 'good.json')
  writeFileSync(irPath, JSON.stringify(goodIr(dataPath, createHash('sha256').update(readFileSync(dataPath)).digest('hex'))))
  const result = run(VALIDATOR, [irPath])
  const parsed = JSON.parse(result.stdout)
  assert.equal(result.code, 0, '通过时应退出 0')
  assert.equal(parsed.ok, true, `应零诊断，实际: ${JSON.stringify(parsed.diagnostics)}`)
  cleanup()
})

test('校验器：结构类规则码逐条触发', () => {
  const { dir, cleanup } = sandbox()
  const irPath = join(dir, 'bad.json')
  writeFileSync(irPath, JSON.stringify({
    meta: { id: 'contract-bad', title: '含数字 3 的标题', canvas: { width: 400, height: 200 } },
    nodes: [
      { id: 'a', kind: 'step', label: '步骤<script>alert(1)</script>', x: 10, y: 10 },
      { id: 'a', kind: 'step', label: '重复 id', x: 30, y: 12 },
      { id: 'c', kind: 'step', label: '越界节点', x: 900, y: 500 },
      { id: 'd', kind: 'finding', label: '悬空出处', x: 200, y: 100, source: { path: '不存在.csv' } },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'ghost' }],
    routes: [{ id: 'r1', label: '路线 2', edgeIds: ['e1', 'missing-edge'] }],
  }))
  const result = run(VALIDATOR, [irPath])
  const parsed = JSON.parse(result.stdout)
  assert.equal(result.code, 1, '有诊断时应退出 1')
  assert.equal(parsed.ok, false)
  const codes = new Set(parsed.diagnostics.map(d => d.code))
  for (const code of ['DIAG_ID_DUP', 'DIAG_EDGE_DANGLING', 'DIAG_ROUTE_DANGLING', 'DIAG_LITERAL_NUMBER', 'DIAG_NODE_OVERLAP', 'DIAG_CANVAS_OVERFLOW', 'DIAG_SCRIPT_IN_STATIC', 'DIAG_SOURCE_DANGLING']) {
    assert.ok(codes.has(code), `缺少规则码 ${code}，实际: ${[...codes].join(', ')}`)
  }
  for (const d of parsed.diagnostics) {
    assert.ok(d.subject, `${d.code} 缺 subject`)
    assert.ok(Array.isArray(d.supportedFixes) && d.supportedFixes.length, `${d.code} 缺 supportedFixes`)
  }
  cleanup()
})

test('校验器：哈希防过期——文件变动后报 DIAG_SOURCE_HASH_MISMATCH', () => {
  const { dir, cleanup } = sandbox()
  const dataPath = join(dir, 'result.json')
  writeFileSync(dataPath, '{"n":1}')
  const staleSha = createHash('sha256').update('{"n":0}').digest('hex')
  const irPath = join(dir, 'stale.json')
  writeFileSync(irPath, JSON.stringify(goodIr(dataPath, staleSha)))
  const parsed = JSON.parse(run(VALIDATOR, [irPath]).stdout)
  assert.equal(parsed.ok, false)
  assert.ok(parsed.diagnostics.some(d => d.code === 'DIAG_SOURCE_HASH_MISMATCH'), '文件变动必须被识别为图过期')
  cleanup()
})

test('校验器：有 source 的节点豁免数字纪律（事实出自文件）', () => {
  const { dir, cleanup } = sandbox()
  const dataPath = join(dir, 'de.csv')
  writeFileSync(dataPath, 'gene,count\nBRCA1,217\n')
  const ir = goodIr(dataPath)
  ir.nodes[1] = { id: 's1', kind: 'finding', label: '217 个差异基因', x: 330, y: 60, source: { path: dataPath, anchor: 'count 列' } }
  const irPath = join(dir, 'sourced.json')
  writeFileSync(irPath, JSON.stringify(ir))
  const parsed = JSON.parse(run(VALIDATOR, [irPath]).stdout)
  assert.equal(parsed.ok, true, `带出处的数字发现应豁免，实际: ${JSON.stringify(parsed.diagnostics)}`)
  cleanup()
})

test('脚手架：确定性输出、记录 sha256、CSV 列提示', () => {
  const { dir, cleanup } = sandbox()
  const dataPath = join(dir, 'de.csv')
  writeFileSync(dataPath, 'gene,pvalue\nBRCA1,0.001\n')
  const outA = join(dir, 'a.json'); const outB = join(dir, 'b.json')
  run(RENDERER, ['--from-files', dataPath, '-o', outA])
  run(RENDERER, ['--from-files', dataPath, '-o', outB])
  assert.equal(readFileSync(outA, 'utf8'), readFileSync(outB, 'utf8'), '脚手架必须确定性：同文件同字节')
  const ir = JSON.parse(readFileSync(outA, 'utf8'))
  assert.equal(ir.nodes.length, 1)
  assert.equal(ir.nodes[0].kind, 'file')
  assert.equal(ir.nodes[0].source.sha256, createHash('sha256').update(readFileSync(dataPath)).digest('hex'))
  assert.match(ir.nodes[0].note, /gene \/ pvalue/, 'CSV 列名应作为提示写入 note')
  cleanup()
})

test('渲染器：--html 字节确定、动画锚点与免责声明就位、路径可被 --html 消费', () => {
  const { dir, cleanup } = sandbox()
  const dataPath = join(dir, 'de.csv')
  writeFileSync(dataPath, 'gene,pvalue\nBRCA1,0.001\n')
  const irPath = join(dir, 'ir.json')
  writeFileSync(irPath, JSON.stringify(goodIr(dataPath)))
  mkdirSync(join(dir, 'out'))
  const htmlA = join(dir, 'out', 'a.html'); const htmlB = join(dir, 'out', 'b.html')
  run(RENDERER, ['--html', irPath, '-o', htmlA])
  run(RENDERER, ['--html', irPath, '-o', htmlB])
  assert.equal(readFileSync(htmlA, 'utf8'), readFileSync(htmlB, 'utf8'), '渲染必须确定性：同 IR 同字节')
  const html = readFileSync(htmlA, 'utf8')
  assert.match(html, /@keyframes dg-draw/, '缺少 dashoffset 绘制动画')
  assert.match(html, /pathLength/, '缺少 pathLength 归一化')
  assert.match(html, /prefers-reduced-motion/, '缺少动效降级分支')
  assert.match(html, /不代表运行时已验证/, '缺少免责声明')
  assert.match(html, /__METRICS__/, '缺少目录实测计数注入')
  assert.ok(!/<script/.test(JSON.stringify(goodIr(dataPath))), 'IR 本身不得含可执行标记')
  cleanup()
})

test('渲染器：文本注入被转义，导出按钮与哈希解析就位', () => {
  const { dir, cleanup } = sandbox()
  const irPath = join(dir, 'xss.json')
  const ir = goodIr(join(dir, 'whatever.csv'))
  ir.nodes[1].label = '发现<img src=x onerror=1>'
  writeFileSync(irPath, JSON.stringify(ir))
  const htmlPath = join(dir, 'xss.html')
  run(RENDERER, ['--html', irPath, '-o', htmlPath])
  const html = readFileSync(htmlPath, 'utf8')
  assert.ok(!html.includes('<img src=x onerror=1>'), 'label 中的标记必须被转义')
  assert.match(html, /#route=/, '缺少哈希状态恢复')
  assert.match(html, /drawToCanvas/, '缺少 PNG/分享卡导出')
  cleanup()
})
