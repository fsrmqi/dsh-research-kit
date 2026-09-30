#!/usr/bin/env node
// 语法门：把整棵源码树交给一个进程解析。
//
// 此前这里是 package.json 里一条手工维护的 `node --check a && node --check b …` 清单：
// 59 个文件、每加一个文件都得手动补，而仓库里实际有 207 个 .js/.mjs —— 这道门看起来
// 还在守语法，实际只覆盖 28%，漏掉的恰好是最不容易被测试间接解析的那些（`dsh/` 下的
// 路由模块、`mcp/tools/` 与 `mcp/execution/` 大批文件）。
//
// 换成遍历后不加不减地覆盖全部文件，也不再指望谁记得改清单；同时更快：`node --check`
// 每个文件要起一个进程（207 个文件 6s+），这里单进程解析约 30ms。
// 依赖 vm.SourceTextModule（需要 --experimental-vm-modules）。API 不在时**必须失败**，
// 否则「没检查」会被当成「通过」——这正是本门禁要防的那类假绿。
//
// 只编译、不链接、不执行：构造 SourceTextModule 不会读取依赖，也不会跑用户代码。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIRECTORIES = ['catalog', 'dsh', 'mcp', 'scripts', 'src', 'test', 'ui']
const ROOT_FILES = ['index.js']
const SKIP = /(^|\/)(node_modules|\.tmp|\.git|\.gitnexus|\.mimosa|\.claude)(\/|$)/
// 目录删空、glob 写错、SKIP 收得过宽都会让这道门静默空转，所以给它一个下限。
const MIN_FILES = 150

if (typeof vm.SourceTextModule !== 'function') {
  console.error('语法门失败：vm.SourceTextModule 不可用（需要 --experimental-vm-modules）。\n'
    + '用 `node --experimental-vm-modules --no-warnings scripts/check-syntax.mjs` 运行；'
    + 'API 缺失时放行等于把「没检查」当成「通过」。')
  process.exit(2)
}

const files = [...ROOT_FILES]
const walk = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (SKIP.test(target)) continue
    if (entry.isDirectory()) walk(target)
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) files.push(target)
  }
}
for (const directory of DIRECTORIES) {
  const target = path.join(ROOT, directory)
  if (statSync(target, { throwIfNoEntry: false })?.isDirectory()) walk(target)
}
files.sort()

const problems = []
for (const file of files) {
  const relative = path.relative(ROOT, file)
  try {
    // identifier 只用于报错定位；构造即编译，不链接也不执行。
    new vm.SourceTextModule(readFileSync(file, 'utf8'), { identifier: relative })
  } catch (error) {
    problems.push(`${relative}：${error.message}`)
  }
}

if (files.length < MIN_FILES) {
  console.error(`语法门失败：只找到 ${files.length} 个待检查文件（下限 ${MIN_FILES}）——遍历逻辑坏了，`
    + '别把空转当成通过。')
  process.exit(1)
}
if (problems.length) {
  console.error(`语法检查失败（${problems.length}/${files.length} 个文件）：\n`
    + problems.map(line => `  ${line}`).join('\n'))
  process.exit(1)
}
process.stdout.write(`语法检查通过：${files.length} 个文件（单进程 vm 解析）\n`)
