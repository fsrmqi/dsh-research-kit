#!/usr/bin/env node
// diagram IR 校验器 —— 规则码诊断 + supportedFixes（设计见 docs-internal/research-route-visualization.md §5.3）
// 用法:
//   node scripts/validate-diagrams.mjs <diagram.json> [more.json...]
//   cat diagram.json | node scripts/validate-diagrams.mjs
// 输出: 单个 JSON 对象 { ok, diagnostics: [{code, subject, message, evidence, supportedFixes}] }
// 退出码: 0 = 通过, 1 = 存在诊断。source.path 相对解析基准: 当前工作目录，其次 IR 文件所在目录。

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, isAbsolute, join } from 'node:path'

const KIND_SIZE = {
  workflow: [150, 44], params: [130, 40], skill: [140, 40], database: [140, 40],
  boundary: [170, 44], step: [120, 40], file: [170, 40], finding: [150, 44],
}
const CLEARANCE = 4 // 标签净空（px），矩形相交判定时计入

function fail(code, subject, message, evidence, supportedFixes) {
  return { code, subject, message, evidence, supportedFixes }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// 数字纪律：结构字段不得携带统计数字；有 source 的节点豁免（事实出自文件，见 §4.3 规则 3/6）。
const NUMBER_RE = /[0-9０-９]/
const MARKUP_RE = /<script|<iframe|javascript:|on(?:error|load|click)\s*=/i

function nodeSize(node) {
  const [dw, dh] = KIND_SIZE[node.kind] || [140, 40]
  return [Number(node.w) || dw, Number(node.h) || dh]
}

function rectsOverlap(a, b) {
  const ax2 = a.x + a.w, ay2 = a.y + a.h, bx2 = b.x + b.w, by2 = b.y + b.h
  const ix = Math.min(ax2, bx2) - Math.max(a.x, b.x)
  const iy = Math.min(ay2, by2) - Math.max(a.y, b.y)
  return ix > CLEARANCE && iy > CLEARANCE ? { ix: Math.round(ix * 10) / 10, iy: Math.round(iy * 10) / 10 } : null
}

function validateOne(ir, fileName, seenMetaIds) {
  const diagnostics = []
  const push = (...args) => diagnostics.push(...args)
  if (!ir || typeof ir !== 'object' || Array.isArray(ir)) {
    return [fail('DIAG_IR_INVALID', fileName, 'IR 不是对象', { received: Array.isArray(ir) ? 'array' : String(ir) }, ['wrap-in-object'])]
  }
  const meta = ir.meta || {}
  const nodes = Array.isArray(ir.nodes) ? ir.nodes : []
  const edges = Array.isArray(ir.edges) ? ir.edges : []
  const routes = Array.isArray(ir.routes) ? ir.routes : []
  const nodeIds = new Set(nodes.map(n => n?.id).filter(Boolean))
  const edgeIds = new Set(edges.map(e => e?.id).filter(Boolean))

  // DIAG_ID_DUP —— 节点/边/路线 id 全图唯一，且共享一个命名空间
  const seen = new Map()
  for (const [kind, list] of [['node', nodes], ['edge', edges], ['route', routes]]) {
    for (const item of list) {
      if (!item?.id) continue
      if (seen.has(item.id)) {
        push(fail('DIAG_ID_DUP', `${kind}:${item.id}`, `id 与 ${seen.get(item.id)} 冲突`, { id: item.id, file: fileName }, ['rename-duplicate']))
      } else seen.set(item.id, kind)
    }
  }
  // DIAG_META_ID_DUP —— meta.id 跨图唯一
  if (meta.id) {
    if (seenMetaIds.has(meta.id)) {
      push(fail('DIAG_META_ID_DUP', `meta:${meta.id}`, 'meta.id 与其他图冲突', { id: meta.id, firstSeen: seenMetaIds.get(meta.id), alsoIn: fileName }, ['rename-diagram']))
    } else seenMetaIds.set(meta.id, fileName)
  }
  // DIAG_EDGE_DANGLING —— 边必须指向已声明的节点
  edges.forEach((edge, i) => {
    for (const end of ['from', 'to']) {
      if (!edge?.[end] || !nodeIds.has(edge[end])) {
        push(fail('DIAG_EDGE_DANGLING', `edges[${i}].${end}`, `边端点「${edge?.[end]}」不是已声明的节点`, { edgeId: edge?.id, missing: edge?.[end] }, ['remove-edge', 'add-node']))
      }
    }
  })
  // DIAG_ROUTE_DANGLING —— 路线只能引用已声明的边
  routes.forEach((route, i) => {
    for (const edgeId of route?.edgeIds || []) {
      if (!edgeIds.has(edgeId)) {
        push(fail('DIAG_ROUTE_DANGLING', `routes[${i}]`, `路线「${route?.label || route?.id}」引用了不存在的边「${edgeId}」`, { routeId: route?.id, missingEdge: edgeId }, ['remove-route-ref']))
      }
    }
  })
  // DIAG_LITERAL_NUMBER —— 结构字段禁止统计数字；有 source 的节点豁免
  const textTargets = [
    ['meta.title', meta.title],
    ...edges.map((e, i) => [`edges[${i}].label`, e?.label]),
    ...routes.map((r, i) => [`routes[${i}].label`, r?.label]),
    ...nodes.map((n, i) => (!n?.source ? [`nodes[${i}].label`, n?.label] : null)),
  ].filter(Boolean).filter(([, text]) => typeof text === 'string')
  for (const [subject, text] of textTargets) {
    if (NUMBER_RE.test(text)) {
      push(fail('DIAG_LITERAL_NUMBER', subject, '结构字段携带数字；统计数字必须经 computed 声明、渲染时计算', { excerpt: text.slice(0, 40) }, ['move-to-computed', 'add-source']))
    }
  }
  // DIAG_SCRIPT_IN_STATIC —— 任何文本字段不得携带可执行标记（注入防线）
  const allText = [
    ['meta.title', meta.title],
    ...nodes.flatMap((n, i) => [[`nodes[${i}].label`, n?.label], [`nodes[${i}].note`, n?.note]]),
    ...edges.map((e, i) => [`edges[${i}].label`, e?.label]),
    ...routes.map((r, i) => [`routes[${i}].label`, r?.label]),
  ].filter(([, text]) => typeof text === 'string')
  for (const [subject, text] of allText) {
    if (MARKUP_RE.test(text)) {
      push(fail('DIAG_SCRIPT_IN_STATIC', subject, '文本字段携带可执行标记；图是数据，不是代码容器', { excerpt: text.slice(0, 40) }, ['strip-dynamic']))
    }
  }
  // DIAG_NODE_OVERLAP / DIAG_CANVAS_OVERFLOW —— 几何（含标签净空）
  const canvas = meta.canvas || {}
  nodes.forEach((node, i) => {
    const [w, h] = nodeSize(node)
    const x = Number(node?.x) || 0, y = Number(node?.y) || 0
    if (x < 0 || y < 0 || x + w > (Number(canvas.width) || Infinity) || y + h > (Number(canvas.height) || Infinity)) {
      push(fail('DIAG_CANVAS_OVERFLOW', `nodes[${i}]`, `节点「${node?.label || node?.id}」越出画布`, { x, y, w, h, canvas }, ['nudge-node', 'grow-canvas']))
    }
  })
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const [wi, hi] = nodeSize(nodes[i]), [wj, hj] = nodeSize(nodes[j])
      const a = { x: Number(nodes[i]?.x) || 0, y: Number(nodes[i]?.y) || 0, w: wi, h: hi }
      const b = { x: Number(nodes[j]?.x) || 0, y: Number(nodes[j]?.y) || 0, w: wj, h: hj }
      const hit = rectsOverlap(a, b)
      if (hit) {
        push(fail('DIAG_NODE_OVERLAP', `nodes[${i}]×nodes[${j}]`, `节点「${nodes[i]?.label || nodes[i]?.id}」与「${nodes[j]?.label || nodes[j]?.id}」相交（净空 ${CLEARANCE}px）`, { overlap: hit, a: nodes[i]?.id, b: nodes[j]?.id }, ['nudge-node']))
      }
    }
  }
  // DIAG_SOURCE_DANGLING / DIAG_SOURCE_HASH_MISMATCH —— 事实出处可回溯且防过期
  const baseDirs = [process.cwd(), dirname(resolve(fileName === '<stdin>' ? '.' : fileName))]
  nodes.forEach((node, i) => {
    const src = node?.source
    if (!src?.path) return
    let abs = isAbsolute(src.path) ? src.path : baseDirs.map(dir => resolve(dir, src.path)).find(p => existsSync(p))
    if (!abs || !existsSync(abs)) {
      push(fail('DIAG_SOURCE_DANGLING', `nodes[${i}].source`, `出处文件「${src.path}」不存在`, { path: src.path, tried: baseDirs }, ['fix-path', 'remove-source']))
      return
    }
    if (src.sha256) {
      const actual = sha256File(abs)
      if (actual !== src.sha256) {
        push(fail('DIAG_SOURCE_HASH_MISMATCH', `nodes[${i}].source`, `「${src.path}」在出图后已变动（sha256 不一致），图基于旧版本文件`, { path: src.path, expected: src.sha256.slice(0, 12), actual: actual.slice(0, 12) }, ['refresh-hash', 'regenerate-diagram']))
      }
    }
  })
  return diagnostics
}

function repoDiagramFiles() {
  const found = []
  const walk = dir => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'ui') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.diagram.json')) found.push(full)
    }
  }
  walk(process.cwd())
  return found
}

function main() {
  const args = process.argv.slice(2)
  let files = args.filter(a => !a.startsWith('--'))
  if (args.includes('--repo')) files = repoDiagramFiles()
  const inputs = []
  if (files.length) {
    for (const file of files) inputs.push([file, readFileSync(file, 'utf8')])
  } else if (!args.includes('--repo')) {
    inputs.push(['<stdin>', readFileSync(0, 'utf8')])
  }
  const seenMetaIds = new Map()
  const diagnostics = []
  for (const [name, text] of inputs) {
    let ir
    try { ir = JSON.parse(text) } catch (error) {
      diagnostics.push(fail('DIAG_IR_INVALID', name, 'IR 不是合法 JSON', { error: String(error?.message || error).slice(0, 120) }, ['fix-json']))
      continue
    }
    diagnostics.push(...validateOne(ir, name, seenMetaIds))
  }
  const result = { ok: diagnostics.length === 0, diagnostics, checked: inputs.map(([name]) => name) }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  process.exitCode = result.ok ? 0 : 1
}

main()
