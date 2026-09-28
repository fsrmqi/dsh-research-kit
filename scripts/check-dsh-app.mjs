#!/usr/bin/env node
// DSH 兼容性检查：把本插件依赖的宿主契约逐条钉在**真实宿主源码**上。
//
// 三种用法：
//   node scripts/check-dsh-app.mjs                  # 用基线 tag（DSH_REPO / .tmp/dsh-repo / ~/dev/deepseek-harness）
//   node scripts/check-dsh-app.mjs /path/to/dsh     # 工作树模式：拿该副本的版本去匹配基线，逐条核对
//   DSH_REPO=... node scripts/check-dsh-app.mjs --require-source
//
// 退出码：0 通过（或明确跳过）；1 有 seam 失败；2 用法/前置条件错误（--require-source 下找不到源码）。
//
// 为什么不是「一次性的字符串检查」：seam 清单在 scripts/lib/dsh-baselines.mjs，
// 与 npm test 里的矩阵共用同一套断言；这里只是它的命令行入口。
import { existsSync, readFileSync } from 'node:fs'
import { BASELINES } from './lib/dsh-baselines.mjs'
import {
  checkHostSeams,
  checkPlatformModules,
  checkPluginContracts,
  clientInjectAudit,
  dirSource,
  resolveDshRepo,
  sourceForBaseline,
  unprobedSlots,
} from './lib/dsh-compat.mjs'

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const INJECT = PACKAGE.dsh?.client?.inject || []

const args = process.argv.slice(2)
const flags = new Set(args.filter(arg => arg.startsWith('--')))
const pathArg = args.find(arg => !arg.startsWith('--'))

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 2
}

function report(label, ok) {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${label}\n`)
}

function reportSeams(outcome) {
  for (const seam of outcome.results) {
    if (seam.ok) report(seam.label, true)
    else if (seam.optional) process.stdout.write(`  ○ ${seam.label} —— 宿主未提供（可选，不算失败）\n`)
    else process.stdout.write(`  ✗ ${seam.label} —— 缺少：${seam.missing.join(' / ')}\n`)
  }
}

// 与宿主无关的自检先跑：这些失败说明仓库自己坏/接线断了，跟 DSH 版本无关。
const contractFailures = checkPluginContracts().filter(result => !result.ok)
const unprobed = unprobedSlots()
if (contractFailures.length) {
  process.stdout.write('插件自身接线契约：\n')
  for (const failure of contractFailures) {
    process.stdout.write(`  ✗ ${failure.label}（${failure.id}）—— 缺少：${failure.missing.join(' / ')}\n`)
  }
  process.exitCode = 1
}
if (unprobed.length) {
  process.stdout.write('槽位看守缺口（HOST_SEAMS 里没有声明，等于没人看守）：\n')
  for (const [slot, file] of unprobed) process.stdout.write(`  ✗ ${slot} —— 注册于 ${file}\n`)
  process.exitCode = 1
}

// 工作树模式：用副本自己的版本匹配基线，避免「拿 0.1.7-rc.1 的 seam 去量另一个版本」。
const repo = resolveDshRepo()
const worktree = pathArg ? (existsSync(pathArg) ? pathArg : undefined) : undefined
if (pathArg && !worktree) fail(`路径不存在：${pathArg}`)

const targets = []
if (worktree) {
  const source = dirSource({ dir: worktree, label: worktree })
  const raw = source.read('package.json')
  let version
  try {
    version = JSON.parse(raw || '{}').version
  } catch {
    version = undefined
  }
  const baseline = BASELINES.find(entry => entry.version === version) || BASELINES.find(entry => entry.tag === version)
  if (!baseline) {
    fail(`工作树版本（${version ?? '未知'}）不在受支持基线里：${BASELINES.map(entry => entry.version).join(' / ')}。\n`
      + '若确实要支持这个版本：先在 scripts/lib/dsh-baselines.mjs 增加基线并跑 `npm run baselines:fetch && npm test`。')
  } else {
    targets.push({ baseline, source })
  }
} else {
  for (const baseline of BASELINES) {
    const picked = sourceForBaseline(baseline)
    if (picked.source) targets.push({ baseline, source: picked.source })
    else process.stdout.write(`○ 跳过 ${baseline.version}：${picked.skip}\n`)
  }
}

if (!worktree && targets.length === 0) {
  const hint = '未找到任何可用 DSH 源码。\n'
    + `  本地：npm run baselines:fetch（浅拉取基线 tag，默认落到 .tmp/dsh-repo）\n`
    + `  或：DSH_REPO=/path/to/deepseek-harness npm run check:dsh-app\n`
    + `  或：node scripts/check-dsh-app.mjs /path/to/deepseek-harness（工作树模式，需版本匹配基线）\n`
    + `  已知副本：${repo ?? '无'}`
  if (flags.has('--require-source')) fail(hint)
  else process.stdout.write(`○ ${hint}\n`)
} else {
  let failed = 0
  for (const { baseline, source } of targets) {
    process.stdout.write(`DSH ${baseline.version}（${source.label}）：\n`)
    const outcome = checkHostSeams(source)
    reportSeams(outcome)
    const platform = checkPlatformModules(source)
    report(platform.ok ? '浏览器模块表能回答产物的每个 require' : `浏览器模块表无法回答：${platform.missing.join(' / ')}`, platform.ok)
    // 注入清单只是「我依赖哪些客户端插件行」的声明：查不到名字不会崩，但这句话就失真了。
    const audit = clientInjectAudit(source, INJECT)
    if (audit.checked && audit.unknown.length) {
      process.stdout.write(`  ⚠ dsh.client.inject 在宿主包清单里查无此名：${audit.unknown.join(' / ')}（不影响装载，见 docs/COMPATIBILITY.md）\n`)
    }
    // 版本自证：tag 指向的 package.json 必须就是基线声明的版本，否则说明基线表写错了。
    const actualVersion = JSON.parse(source.read('package.json') || '{}').version
    const versionOk = actualVersion === baseline.version
    report(`源码版本自证（package.json = ${actualVersion ?? '未读到'}）`, versionOk)
    const failures = outcome.failures.length + (platform.ok ? 0 : 1) + (versionOk ? 0 : 1)
    failed += failures
    process.stdout.write(failures ? `  → ${baseline.version} 有 ${failures} 处不兼容\n\n` : `  → ${baseline.version} 全部 ${outcome.results.length + 1} 条 seam 成立\n\n`)
  }
  if (failed) {
    process.stdout.write(`兼容性检查失败：${failed} 处。每条失败都点名了 seam 与宿主文件——先判断是宿主改名（改本仓库适配）还是基线表写错。\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`兼容性检查通过：${targets.length} 个基线 × 全部 seam。仍需真实 profile 验收（npm run test:browser / docs/MANUAL-QA.md）。\n`)
  }
}
