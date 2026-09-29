#!/usr/bin/env node
// DSH 兼容性检查：把本插件依赖的宿主契约逐条钉在**真实宿主源码**上。
//
// 三种用法：
//   node scripts/check-dsh-app.mjs                  # 用基线 tag（DSH_REPO / .tmp/dsh-repo / ~/dev/deepseek-harness）
//   node scripts/check-dsh-app.mjs /path/to/dsh     # 工作树模式：拿该副本的版本去匹配基线，逐条核对
//   DSH_REPO=... node scripts/check-dsh-app.mjs --require-source
//   node scripts/check-dsh-app.mjs /path/to/fork --allow-dirty        # 明知工作树有改动仍要核对
//   DSH_TAGS_DIR=... node scripts/check-dsh-app.mjs --require-source --allow-unverified-source
//
// 退出码：0 通过（或明确跳过）；1 有 seam 失败；2 用法/前置条件错误（--require-source 下源码不足）。
//
// 「源码自证」是硬要求的一部分：git 源的内容由 `git show <tag>:<file>` 取出，天然绑在 tag 的
// 提交上；工作树/已解包目录里的 package.json 是人写的，改一个 version 就能冒充基线。
// 因此 --require-source 只接受 verified 的源，除非显式传 --allow-unverified-source。
//
// 为什么不是「一次性的字符串检查」：seam 清单在 scripts/lib/dsh-baselines.mjs，
// 与 npm test 里的矩阵共用同一套断言；这里只是它的命令行入口。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASELINES } from './lib/dsh-baselines.mjs'
import {
  checkHostSeams,
  checkPlatformModules,
  checkPluginContracts,
  clientInjectAudit,
  dirSource,
  resolveDshRepo,
  slotGuardReport,
  sourceForBaseline,
  sourceProvenance,
} from './lib/dsh-compat.mjs'

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const INJECT = PACKAGE.dsh?.client?.inject || []

const KNOWN_FLAGS = new Set(['--require-source', '--allow-dirty', '--allow-unverified-source'])

// 失败即终止：以前只设 exitCode 然后继续跑，会出现「退出码 2、最后一行却打印兼容性检查通过」
// 这种自相矛盾；更糟的是拼错 --require-source 时整条硬门禁静默退化成"跳过"，CI 只看退出码。
function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

const args = process.argv.slice(2)
const flags = new Set()
for (const arg of args) {
  if (!arg.startsWith('--')) continue
  if (!KNOWN_FLAGS.has(arg)) fail(`未知参数：${arg}（已知参数：${[...KNOWN_FLAGS].join(' / ')}）`)
  flags.add(arg)
}
const pathArg = args.find(arg => !arg.startsWith('--'))

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
// 用 preflightFailed 记账而不是直接设 exitCode：以前设了 exitCode 仍往下走，
// 末行照样打印「兼容性检查通过」，输出与退出码自相矛盾。
let preflightFailed = false
const contractFailures = checkPluginContracts().filter(result => !result.ok)
const slotReport = slotGuardReport()
if (contractFailures.length) {
  process.stdout.write('插件自身接线契约：\n')
  for (const failure of contractFailures) {
    process.stdout.write(`  ✗ ${failure.label}（${failure.id}）—— 缺少：${failure.missing.join(' / ')}\n`)
  }
  preflightFailed = true
}
if (slotReport.unreadable.length) {
  process.stdout.write('槽位源文件读不到（过去这种文件被静默跳过，收集为空也照样通过）：\n')
  for (const file of slotReport.unreadable) process.stdout.write(`  ✗ ${file}\n`)
  preflightFailed = true
}
if (slotReport.found === 0) {
  process.stdout.write('  ✗ 一个槽位都没收集到：槽位看守空转（检查 dsh/ 与 src/ 的槽位注册代码是否还在）\n')
  preflightFailed = true
}
if (slotReport.unprobed.length) {
  process.stdout.write('槽位看守缺口（HOST_SEAMS 里没有声明，等于没人看守）：\n')
  for (const [slot, file] of slotReport.unprobed) process.stdout.write(`  ✗ ${slot} —— 注册于 ${file}\n`)
  preflightFailed = true
}

// 工作树模式：用副本自己的版本匹配基线，避免「拿 0.1.7-rc.1 的 seam 去量另一个版本」。
const repo = resolveDshRepo()
const worktree = pathArg ? (existsSync(pathArg) ? pathArg : undefined) : undefined
if (pathArg && !worktree) fail(`路径不存在：${pathArg}`)

/** 在某个副本上跑 git，读不到就返回 undefined（不抛）。 */
function gitOutput(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return undefined
  }
}

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
    // 版本自证不能只看 package.json：那是人写的，改一个 version 就能让任意副本冒充基线。
    // 是 git 仓库就必须干净，且 HEAD 就是该基线 tag 的提交（tag 不在本地时如实说明绑不上）。
    if (existsSync(join(worktree, '.git'))) {
      const dirty = gitOutput(worktree, ['status', '--porcelain'])
      if (dirty === undefined) {
        fail(`无法在 ${worktree} 上运行 git：工作树模式的版本自证依赖 git，请用 git 仓库或改走基线 tag 模式。`)
      }
      if (dirty && !flags.has('--allow-dirty')) {
        fail(`${worktree} 有未提交改动，核对结果不代表 ${baseline.tag} 这个发布：\n`
          + dirty.split('\n').slice(0, 5).map(line => `  ${line}`).join('\n')
          + '\n先提交/暂存，或用 --allow-dirty 显式接受「核对的是当前工作树而非发布」。')
      }
      const tagRef = gitOutput(worktree, ['rev-parse', '-q', '--verify', `refs/tags/${baseline.tag}`])
      const head = gitOutput(worktree, ['rev-parse', 'HEAD'])
      if (tagRef) {
        const tagCommit = gitOutput(worktree, ['rev-parse', `${baseline.tag}^{commit}`])
        if (head && tagCommit && head !== tagCommit) {
          fail(`${worktree} 的 HEAD（${head.slice(0, 12)}）不是基线 ${baseline.tag} 的提交（${tagCommit.slice(0, 12)}）：\n`
            + `这份副本不是 ${baseline.tag}。要核对别的版本请先在 scripts/lib/dsh-baselines.mjs 增加基线。`)
        }
      } else {
        process.stdout.write(`  ⚠ ${worktree} 里没有 tag ${baseline.tag}：无法把 HEAD 绑到基线，仅按 package.json 的 version 判定\n`)
      }
    } else {
      process.stdout.write(`  ⚠ ${worktree} 不是 git 仓库：已解包副本无法绑 git（package.json 的 version 是人写的，不能当证据）\n`)
    }
    targets.push({ baseline, source })
  }
} else {
  const skipped = []
  for (const baseline of BASELINES) {
    const picked = sourceForBaseline(baseline)
    if (picked.source) targets.push({ baseline, source: picked.source })
    else {
      skipped.push({ baseline, reason: picked.skip })
      process.stdout.write(`○ 跳过 ${baseline.version}：${picked.skip}\n`)
    }
  }
  // --require-source 的语义是「每个声明的基线都真的核对过」，不是「至少核对了一个」。
  // 只拉到一个 tag 就报"1 个基线 × 全部 seam 成立"，等于把硬门禁悄悄变窄。
  if (skipped.length && flags.has('--require-source')) {
    fail(`--require-source：有 ${skipped.length} 个基线没有源码，不得只核对部分基线\n`
      + skipped.map(item => `  ✗ ${item.baseline.version}：${item.reason}`).join('\n'))
  }
}

if (!worktree && targets.length === 0) {
  const hint = '未找到任何可用 DSH 源码。\n'
    + `  本地：npm run baselines:fetch（浅拉取基线 tag，默认落到 .tmp/dsh-repo）\n`
    + `  或：DSH_REPO=/path/to/deepseek-harness npm run check:dsh-app\n`
    + `  或：node scripts/check-dsh-app.mjs /path/to/deepseek-harness（工作树模式，需版本匹配基线）\n`
    + `  已知副本：${repo ?? '无'}`
  if (flags.has('--require-source')) fail(hint)
  else {
    process.stdout.write(`○ ${hint}\n`)
    if (preflightFailed) {
      process.stdout.write('兼容性检查失败：仓库自身的接线/槽位自检没过（见上面的 ✗）。\n')
      process.exitCode = 1
    }
  }
} else {
  let failed = 0
  const unverified = []
  for (const { baseline, source } of targets) {
    process.stdout.write(`DSH ${baseline.version}（${source.label}）：\n`)
    const provenance = sourceProvenance(source, baseline)
    if (provenance.verified) report(`源码来源自证（${provenance.label}）`, true)
    else {
      process.stdout.write(`  ○ 源码来源未自证：${provenance.note}\n`)
      unverified.push(baseline.tag)
    }
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
  // --require-source 是 CI 的硬门禁：它的语义必须是「每个基线都用可自证的源码核对过」。
  // 已解包副本（package.json 里手写的 version）不足以支撑这个断言，除非显式放行。
  const strictSource = flags.has('--require-source') && !flags.has('--allow-unverified-source')
  const blocked = strictSource ? unverified : []
  if (blocked.length && !failed && !preflightFailed) {
    // 前置条件不满足，与「--require-source 下找不到源码」同类：退出 2（用法/前置条件错误），
    // 而不是混进「seam 失败」的 1——CI 里这两种需要的人为处理完全不同。
    fail(`${blocked.join(' / ')} 的源码未自证（已解包副本未绑 git）：--require-source 要求每个基线都用`
      + '可自证的源码核对。\n  CI 用 `npm run baselines:fetch` 拉到的 git 源（内容由 tag 的提交决定）；\n'
      + '  本地跑严格模式请先 fetch，或传 --allow-unverified-source 显式接受「我确认这份副本就是该 tag」。')
  }
  if (failed || preflightFailed || blocked.length) {
    if (blocked.length) {
      process.stdout.write(`兼容性检查失败：${blocked.join(' / ')} 的源码未自证（已解包副本未绑 git）。\n`
        + '  CI 用 `npm run baselines:fetch` 拉到的 git 源（内容由 tag 的提交决定）；本地要跑严格模式需先 fetch，\n'
        + '  或传 --allow-unverified-source 显式接受「我确认这份副本就是该 tag」。\n')
    }
    if (preflightFailed) process.stdout.write('兼容性检查失败：仓库自身的接线/槽位自检没过（见上面的 ✗）。\n')
    if (failed) process.stdout.write(`兼容性检查失败：${failed} 处。每条失败都点名了 seam 与宿主文件——先判断是宿主改名（改本仓库适配）还是基线表写错。\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`兼容性检查通过：${targets.length} 个基线 × 全部 seam。仍需真实 profile 验收（npm run test:browser / docs/MANUAL-QA.md）。\n`)
  }
}
