#!/usr/bin/env node
// 校验 docs/assets/ 的图与文档引用双向一致，失败时非零退出（挂接 npm run check）。
//
// 为什么要它：配图纪律里写着「新增图要登记、改图要核对」，但没有任何机器看守。
// 于是有两种漂移都不会被发现——① 只加图不引用（死资产，随仓库分发却没人看见）；
// ② 删了图忘改引用（文档里留下断链，GitHub 上渲染成破图标）。
// 这两类都不会让任何现有门禁失败，只有真正打开页面的人才会碰到。
//
// 真值来源：docs/assets/ 的实际文件清单；引用来源：各读者文档里的图片语法。
// 刻意不扫描 docs-internal/ 与 CHANGELOG——内部笔记与历史条目里的路径不承担展示职责。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetsDir = resolve(root, 'docs/assets')
const errors = []

// 读者文档：门面、贡献入口、以及 docs/ 下的中文深入文档
const markdownFiles = [
  'README.md',
  'README.en.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'ROADMAP.md',
  ...readdirSync(resolve(root, 'docs'))
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => `docs/${f}`),
]

const assets = readdirSync(assetsDir).filter(f => statSync(resolve(assetsDir, f)).isFile())
const referenced = new Map() // 资产文件名 -> 引用它的文件列表

// 两种图片语法都收：markdown ![](…) 与原生 <img src="…">
const patterns = [
  /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g,
  /<img[^>]*\ssrc=["']([^"']+)["']/g,
]

for (const file of markdownFiles) {
  const abs = resolve(root, file)
  if (!existsSync(abs)) { errors.push(`读者文档清单里的 ${file} 不存在`); continue }
  const lines = readFileSync(abs, 'utf8').split('\n')
  const dir = dirname(abs)

  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let m
      while ((m = pattern.exec(line)) !== null) {
        const target = m[1].split('#')[0].split('?')[0]
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue // 外链与 data: 不归本脚本管
        const resolved = resolve(dir, target)
        if (!existsSync(resolved)) {
          errors.push(`${file}:${index + 1} 的图片引用指向不存在的文件：${target}`)
          continue
        }
        if (resolved.startsWith(assetsDir + '/')) {
          const name = relative(assetsDir, resolved)
          if (!referenced.has(name)) referenced.set(name, new Set())
          referenced.get(name).add(file)
        }
      }
    }
  })
}

const orphans = assets.filter(name => !referenced.has(name))
for (const name of orphans) errors.push(`docs/assets/${name} 未被任何读者文档引用（死资产：要么在图索引里登记并引用，要么删掉）`)

if (process.argv.includes('--verbose')) {
  console.log('图片资产与引用：')
  for (const name of assets) {
    const refs = referenced.get(name)
    console.log(`  ${refs ? '✓' : '✗'} docs/assets/${name} ← ${refs ? [...refs].join('、') : '无人引用'}`)
  }
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`)
  console.error(`文档资产校验失败（${errors.length} 处）：docs/assets/ 的图与文档引用不一致。`)
  process.exit(1)
}

const refCount = [...referenced.values()].reduce((sum, set) => sum + set.size, 0)
console.log(`文档资产校验通过：docs/assets/ ${assets.length} 张图全部被引用，共 ${refCount} 处文档引用且全部指向真实文件。`)
