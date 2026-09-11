#!/usr/bin/env node
// diagram IR 渲染器 —— archify viewer（vendored，MIT）+ 本仓库适配器 → 单文件交互 HTML + 文件脚手架
// 设计契约见 docs-internal/research-route-visualization.md §5.2/§5.5/§7.3。零依赖、确定性：同 IR 同字节输出。
// viewer 能力（视觉预设/章节故事/语义透镜/雷达总览/彗星流光路线动画）全部来自 vendored archify
// 运行时（vendor/archify/template.html，SHA 锁定于 vendor-manifest.json）；本脚本只按其
// data-* 契约生成 SVG 并填充哨兵槽位（见 src/lib/archify-adapter.js）。
// 用法:
//   node scripts/render-diagrams.mjs --html <diagram.json> [-o out.html]        # IR → 交互 HTML（或 stdin）
//   node scripts/render-diagrams.mjs --from-files <file...> [-o scaffold.json]  # 结果文件 → IR 脚手架

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildArchifySvg, archifyApplyTemplate, archifyGuidedViews } from '../src/lib/archify-adapter.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = resolve(HERE, '..', 'vendor', 'archify', 'template.html')
const DISCLAIMER = '本图仅由 diagram IR 声明的事实生成；动画只回放声明内容，不代表运行时已验证，结果需人工核验。导出物不含播放运行时。'

// ---------- 公共 ----------
function countCatalog() {
  const count = dir => {
    try { return readdirSync(resolve(HERE, '..', 'catalog', dir)).filter(f => f.endsWith('.json')).reduce((sum, f) => {
      const items = JSON.parse(readFileSync(resolve(HERE, '..', 'catalog', dir, f), 'utf8'))
      return sum + items.length
    }, 0) } catch { return 0 }
  }
  const families = new Set()
  try {
    for (const f of readdirSync(resolve(HERE, '..', 'catalog', 'workflows')).filter(f => f.endsWith('.json'))) {
      for (const item of JSON.parse(readFileSync(resolve(HERE, '..', 'catalog', 'workflows', f), 'utf8'))) families.add(item.category)
    }
  } catch { /* 目录不可用时计 0 */ }
  return { workflows: count('workflows'), skills: count('skills'), databases: count('resources'), families: families.size }
}

const KIND_SIZE = { workflow: [150, 48], params: [130, 44], skill: [140, 44], database: [140, 44], boundary: [170, 48], step: [120, 44], file: [170, 44], finding: [150, 48] }

// ---------- --from-files 脚手架 ----------
function scaffold(paths) {
  const nodes = []
  const col = 40
  paths.forEach((raw, i) => {
    const path = resolve(raw)
    if (!existsSync(path)) { process.stderr.write(`跳过不存在的文件: ${raw}\n`); return }
    const buf = readFileSync(path)
    const sha = createHash('sha256').update(buf).digest('hex')
    let hint = ''
    const text = buf.toString('utf8')
    if (/\.csv$/i.test(path) && text.includes('\n')) hint = `列: ${String(text.split('\n')[0]).split(',').slice(0, 6).join(' / ')}`
    else if (/\.json$/i.test(path)) { try { hint = `键: ${Object.keys(JSON.parse(text)).slice(0, 6).join(' / ')}` } catch { /* 非 JSON 内容，忽略 */ } }
    else if (text) hint = `前 40 字: ${text.slice(0, 40).replace(/\s+/g, ' ')}`
    nodes.push({
      id: `file-${i + 1}`, kind: 'file', label: basename(path),
      x: col + (i % 2) * 230, y: 60 + Math.floor(i / 2) * 78,
      note: hint, source: { path: raw, sha256: sha },
    })
  })
  const cols = Math.min(2, Math.max(nodes.length, 1))
  const width = 40 + cols * 230 + 90
  return {
    meta: { id: 'file-explain-scaffold', title: '结果文件解释图（脚手架）', locale: 'zh-CN', animation: 'trace', visual_preset: 'classic', canvas: { width: Math.max(width, 560), height: 60 + Math.ceil(nodes.length / 2) * 78 + 80 } },
    nodes, edges: [], routes: [],
  }
}

// ---------- --html 渲染 ----------
function renderHtml(ir) {
  const metrics = countCatalog()
  const preset = ['classic', 'signal-flow', 'blueprint', 'editorial'].includes(ir.meta?.visual_preset) ? ir.meta.visual_preset : 'classic'
  const animation = ir.meta?.animation === 'none' ? 'none' : 'trace'
  const nodes = ir.nodes || []
  const edges = ir.edges || []
  const template = readFileSync(TEMPLATE_PATH, 'utf8')
  const svg = buildArchifySvg({ nodes, edges, title: ir.meta?.title || '解释图', subtitle: DISCLAIMER, locale: ir.meta?.locale || 'zh-CN', preset, animation, metrics })
  const cards = []
  const sourced = nodes.filter(n => n.source)
  if (sourced.length) {
    cards.push({
      dot: 'cyan', title: '事实出处（sha256 防过期）',
      items: sourced.map(n => `${n.label} ← ${n.source.path}${n.source.anchor ? ' · ' + n.source.anchor : ''}${n.source.sha256 ? ' · ' + String(n.source.sha256).slice(0, 12) : ''}`),
    })
  }
  const noted = nodes.filter(n => n.note)
  if (noted.length) {
    cards.push({ dot: 'emerald', title: '说明卡片', items: noted.map(n => `${n.label} — ${n.note}`) })
  }
  cards.push({ dot: 'amber', title: '使用边界', items: ['动画只回放 IR 声明的事实，不冒充运行时影响或已验证结论', 'SRC 标记指向结果文件与哈希；文件变动后校验器会标记图过期', '结果需人工核验后采用'] })
  const html = archifyApplyTemplate({
    template,
    title: ir.meta?.title || '解释图',
    subtitle: DISCLAIMER,
    svg,
    cards,
    locale: ir.meta?.locale || 'zh-CN',
    visualPreset: preset,
    guidedViews: archifyGuidedViews(ir.routes, edges),
  })
  return html
}

// ---------- main ----------
function main() {
  const args = process.argv.slice(2)
  const mode = args[0]
  const outFile = (() => { const i = args.indexOf('-o'); return i >= 0 ? args[i + 1] : null })()
  if (mode === '--from-files') {
    const paths = args.slice(1).filter(a => a !== '-o' && a !== outFile)
    if (!paths.length) { process.stderr.write('用法: --from-files <file...> [-o out.json]\n'); process.exitCode = 2; return }
    const ir = scaffold(paths)
    const json = JSON.stringify(ir, null, 2) + '\n'
    if (outFile) writeFileSync(outFile, json); else process.stdout.write(json)
    process.stderr.write(`脚手架: ${ir.nodes.length} 个文件节点（确定性；语义留给你来补全，findings 必须挂 source）\n`)
    return
  }
  if (mode === '--html') {
    const file = args[1] && args[1] !== '-o' ? args[1] : null
    const ir = JSON.parse(file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8'))
    const html = renderHtml(ir)
    if (outFile) writeFileSync(outFile, html); else process.stdout.write(html)
    process.stderr.write(`交互 HTML 已生成（${ir.nodes?.length || 0} 节点 / ${ir.edges?.length || 0} 边 / ${(ir.routes || []).length} 章节，archify viewer）\n`)
    return
  }
  process.stderr.write('用法:\n  render-diagrams.mjs --html <diagram.json> [-o out.html]\n  render-diagrams.mjs --from-files <file...> [-o out.json]\n')
  process.exitCode = 2
}

main()
