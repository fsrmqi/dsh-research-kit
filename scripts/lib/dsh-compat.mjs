// compat 矩阵的执行层：把宿主源码（git tag 或已解包的目录）读成 seam 检查结果。
//
// CLI（scripts/check-dsh-app.mjs）与测试（test/dsh-compat-matrix.test.mjs）共用本文件，
// 因此「本地手跑」与「CI/发布门禁」检查的是同一套断言，不存在两套口径。
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASELINES, HOST_SEAMS, PLUGIN_CONTRACTS, PLUGIN_SLOT_SOURCES, declaredSlots } from './dsh-baselines.mjs'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** 本地已解包基线目录（`.tmp/dsh-tags/<baseline id>`），无网络时的退路。 */
export function stagedDirOf(baseline, env = process.env) {
  const dir = join(env.DSH_TAGS_DIR || join(ROOT, '.tmp', 'dsh-tags'), baseline.id)
  return existsSync(dir) ? dir : undefined
}

/** 优先 DSH_REPO，其次本仓库 stage 的浅克隆，最后开发机惯例路径。 */
export function resolveDshRepo(env = process.env) {
  const candidates = [env.DSH_REPO, join(ROOT, '.tmp', 'dsh-repo'), env.HOME && join(env.HOME, 'dev', 'deepseek-harness')]
  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, '.git'))) return candidate
  }
  return undefined
}

function hasTag(repo, tag) {
  try {
    execFileSync('git', ['-C', repo, 'rev-parse', '-q', '--verify', `refs/tags/${tag}`], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * git tag 读取器：`git show <tag>:<file>`。文件不在该 tag 上时返回 undefined。
 *
 * `verified: true` 是**结构性**的：内容由 git 从该 tag 的提交里取，读的人不需要相信
 * 任何手写字段。dir 源没有这个性质（见 dirSource）。
 */
export function gitSource({ repo, tag }) {
  return {
    kind: 'git',
    verified: true,
    repo,
    tag,
    label: `${repo}@${tag}`,
    read(file) {
      try {
        return execFileSync('git', ['-C', repo, 'show', `${tag}:${file}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      } catch {
        return undefined
      }
    },
  }
}

/**
 * 工作树/已解包目录读取器：直接读文件。
 *
 * `verified: false` 表示这份源码**无法自证**就是基线的那个发布：目录里的 `package.json`
 * 是人写的，改一个 version 就能让任意副本冒充基线。调用方必须区分对待
 * （CI 的硬门禁只接受 verified 的源，见 scripts/check-dsh-app.mjs 的 --require-source）。
 */
export function dirSource({ dir, label }) {
  return {
    kind: 'dir',
    verified: false,
    dir,
    label: label || dir,
    read(file) {
      try {
        return readFileSync(join(dir, file), 'utf8')
      } catch {
        return undefined
      }
    },
  }
}

/**
 * 为一个基线挑当前可用的源码来源。
 * 返回 { source } 或 { skip: '原因' }——跳过原因要能直接告诉人怎么补。
 */
export function sourceForBaseline(baseline, env = process.env) {
  const repo = resolveDshRepo(env)
  if (repo && hasTag(repo, baseline.tag)) return { source: gitSource({ repo, tag: baseline.tag }) }
  const staged = stagedDirOf(baseline, env)
  if (staged) return { source: dirSource({ dir: staged, label: `${staged}（已解包工作树）` }) }
  if (repo) return { skip: `${repo} 缺少 tag ${baseline.tag}；运行 npm run baselines:fetch` }
  return { skip: `未找到 DSH 源码：设置 DSH_REPO，或运行 npm run baselines:fetch，或把 tag 解包到 .tmp/dsh-tags/` }
}

/**
 * 源码来源的自证情况：报告「这份源码凭什么算是那个基线」。
 * git 源绑定在 tag 的提交上；目录源只能是「未自证」，必须如实说出来而不是默认通过。
 */
export function sourceProvenance(source, baseline) {
  if (source.verified) {
    return { verified: true, label: `git ${baseline.tag}（${source.label}）`, note: '' }
  }
  return {
    verified: false,
    label: '已解包副本（未绑 git）',
    note: `${source.label}：只核对了 package.json 里的 version，而它是人写的——无法证明这份源码就是 ${baseline.tag}`,
  }
}

/** 单条 seam 的检查结果。 */
export function checkSeam(source, seam) {
  const content = source.read(seam.file)
  if (content === undefined) {
    return { id: seam.id, label: seam.label, ok: false, optional: Boolean(seam.optional), missing: [`文件缺失 ${seam.file}`] }
  }
  const missing = seam.tokens.filter(token => !content.includes(token))
  return { id: seam.id, label: seam.label, ok: missing.length === 0, optional: Boolean(seam.optional), missing }
}

/** 跑一个来源上的全部 host seam；optional seam 的缺失单独归类为 available=false。 */
export function checkHostSeams(source, seams = HOST_SEAMS) {
  const results = seams.map(seam => checkSeam(source, seam))
  return {
    source: source.label,
    results,
    required: results.filter(result => !result.optional),
    failures: results.filter(result => !result.ok && !result.optional),
    unavailableOptional: results.filter(result => !result.ok && result.optional),
  }
}

/**
 * 从构建产物里取出浏览器 bundle 真正 require 的模块名。
 *
 * 单引号与双引号都要认：`scripts/build-client.mjs` 生成的工厂写的是 `require('react')`，
 * 而这里过去只匹配双引号 → 提取集合恒为空 → `checkPlatformModules` 恒判通过，
 * 「回答不了的 require 是必然启动崩溃」这条检查**空转**（对空模块表的宿主也全绿）。
 */
export function clientBundleRequires(bundlePath = join(ROOT, 'ui', 'client.js')) {
  const source = readFileSync(bundlePath, 'utf8')
  const specs = [...source.matchAll(/require\(\s*(['"])([^'"]+)\1\s*\)/g)].map(match => match[2])
  return [...new Set(specs)].sort()
}

/**
 * 从宿主 platform.ts 里取模块表。
 * 返回 `{ file, modules }`，或 `{ file, missing }`——「文件读不到」与「文件在但没有 PLATFORM_MODULES」
 * 是两回事，混成一条文案会让排查方向完全错掉（前者是源码来源/路径问题，后者才是宿主改了表）。
 */
export function platformModulesOf(source) {
  const file = 'packages/client/web/src/platform.ts'
  const content = source.read(file)
  if (content === undefined) return { file, missing: `文件缺失 ${file}`, modules: [] }
  const block = /PLATFORM_MODULES\s*=\s*\[([\s\S]*?)\]/.exec(content)
  if (!block) return { file, missing: `${file} 里没有 PLATFORM_MODULES 数组（宿主换了模块表写法？）`, modules: [] }
  // 单双引号都认：宿主换引号风格不该让这条检查变成「读不到模块表」。
  return { file, modules: [...new Set([...block[1].matchAll(/(['"])([^'"]+)\1/g)].map(match => match[2]))] }
}

/**
 * 动态 seam：浏览器产物 require 的每个模块都必须由该代宿主的模块表回答——
 * 回答不了的 require 是**必然的启动崩溃**，不是「某个功能不可用」。
 */
export function checkPlatformModules(source, bundlePath) {
  const { missing: tableProblem, modules: table } = platformModulesOf(source)
  if (tableProblem) return { id: 'platform-modules', ok: false, missing: [tableProblem], requires: [] }
  // 产物读不到（被删/路径变了）也必须 fail-closed，而不是让 readFileSync 抛 ENOENT 把 CLI 打崩：
  // 「读不到」与「提取为空」都是这条检查失去意义的样子。
  let requires
  try {
    requires = clientBundleRequires(bundlePath)
  } catch (error) {
    return { id: 'platform-modules', ok: false, missing: [`读不到构建产物 ${bundlePath}：${error.message}`], requires: [] }
  }
  // 空集必须失败，不能算通过：提取方式与产物写法一旦脱节（历史上正是如此），
  // 这条检查就变成恒真——「没人看守」比「看守失败」危险得多。
  if (requires.length === 0) {
    return {
      id: 'platform-modules',
      ok: false,
      missing: ['没能从产物里提取到任何 require（提取方式与产物写法脱节，这条检查会空转）'],
      requires,
    }
  }
  const missing = requires.filter(spec => !table.includes(spec))
  return { id: 'platform-modules', ok: missing.length === 0, missing, requires }
}

/** 读取本仓库源码并断言插件自身接线契约（与宿主无关）。 */
export function checkPluginContracts(root = ROOT, contracts = PLUGIN_CONTRACTS) {
  return contracts.map(contract => {
    let content
    try {
      content = readFileSync(join(root, contract.file), 'utf8')
    } catch {
      return { id: contract.id, label: contract.label, ok: false, missing: [`文件缺失 ${contract.file}`] }
    }
    const missing = contract.tokens.filter(token => !content.includes(token))
    return { id: contract.id, label: contract.label, ok: missing.length === 0, missing }
  })
}

/**
 * 从插件源码里收集实际注册的槽位名，与 HOST_SEAMS 声明比对。
 * 目的：新增一个槽位却没人把它加进矩阵时**立刻失败**，而不是等某个版本上白屏才发现。
 */
const SLOT_SCAN_ROOTS = ['dsh', 'src', 'index.js']
// 目录兜底扫描用的通用句式：新文件里注册槽位也必须被看见，
// 而 PLUGIN_SLOT_SOURCES 是硬编码文件表（新文件不在表里就完全没人看守）。
const SLOT_SCAN_PATTERNS = [
  /slots\.inject\(\s*['"]([^'"]+)['"]/g,
  /slot:\s*['"]([^'"]+)['"]/g,
]

function jsFilesUnder(root, entry) {
  let entries
  try {
    entries = readdirSync(join(root, entry), { withFileTypes: true })
  } catch {
    // 不是目录：按单文件处理（index.js）。文件**不存在**时也会走到这里——读它的时候会如实体现在
    // unreadable 里，所以这里不需要再判断一次存在性（旧版的内层 try/catch 是永远不会命中的死代码）。
    return [entry]
  }
  const files = []
  for (const item of entries) {
    const rel = `${entry}/${item.name}`
    if (item.isDirectory()) files.push(...jsFilesUnder(root, rel))
    else if (item.name.endsWith('.js')) files.push(rel)
  }
  return files
}

/**
 * 收集插件源码里注册的槽位名。
 *
 * 返回 `{ found, unreadable, scanned }`：
 * - `unreadable`：本该存在却读不到的文件——过去这里 `catch { continue }`，于是
 *   `slot-registry.js` 被改名/删掉时收集结果为空、`unprobedSlots()` 返回 `[]`，测试照样绿；
 * - 除了 PLUGIN_SLOT_SOURCES 的显式句式，还会扫描 dsh/ 与 src/ 下**所有** .js，
 *   避免「新增一个文件注册槽位，而它不在硬编码文件表里」这种漏检。
 */
export function collectPluginSlots(root = ROOT, sources = PLUGIN_SLOT_SOURCES) {
  const found = new Map()
  const unreadable = []
  const scanned = new Set()
  // 一个文件可能有多条显式句式（standalone-glue.js 就有两条），先按文件归并；原先的
  // patternsFor() 是对 sources 的线性扫描，逐行调用一次是纯浪费。
  const explicitPatterns = new Map()
  for (const entry of sources) {
    if (!explicitPatterns.has(entry.file)) explicitPatterns.set(entry.file, [])
    explicitPatterns.get(entry.file).push(entry.pattern)
  }
  for (const entry of sources) {
    let content
    try {
      content = readFileSync(join(root, entry.file), 'utf8')
    } catch {
      unreadable.push(entry.file)
      continue
    }
    scanned.add(entry.file)
    for (const pattern of explicitPatterns.get(entry.file)) {
      for (const match of content.matchAll(pattern)) {
        if (!found.has(match[1])) found.set(match[1], entry.file)
      }
    }
  }
  for (const file of SLOT_SCAN_ROOTS.flatMap(entry => jsFilesUnder(root, entry))) {
    if (scanned.has(file)) continue
    let content
    try {
      content = readFileSync(join(root, file), 'utf8')
    } catch {
      unreadable.push(file)
      continue
    }
    scanned.add(file)
    for (const pattern of SLOT_SCAN_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        if (!found.has(match[1])) found.set(match[1], file)
      }
    }
  }
  return { found, unreadable, scanned: [...scanned].sort() }
}

/**
 * 槽位看守体检：未被看守的槽位、读不到的文件、以及「一个槽位都没收集到」的空转。
 * 三者都必须能让门禁失败——空集不等于安全。
 */
export function slotGuardReport(root = ROOT) {
  const { found, unreadable, scanned } = collectPluginSlots(root)
  const declared = declaredSlots()
  return {
    unprobed: [...found].filter(([slot]) => !declared.has(slot)),
    unreadable,
    scanned,
    found: found.size,
  }
}

/** 未被矩阵看守的注册槽位（保留旧签名：CLI 与测试都在用）。 */
export function unprobedSlots(root = ROOT) {
  return slotGuardReport(root).unprobed
}

/** 基线数据自洽性：tag 与 version 必须对得上，且落在 peer 范围内。 */
export function baselineDataProblems(baselines = BASELINES) {
  const problems = []
  const seen = new Set()
  for (const baseline of baselines) {
    if (seen.has(baseline.id)) problems.push(`基线 id 重复：${baseline.id}`)
    seen.add(baseline.id)
    if (baseline.tag !== baseline.id) problems.push(`${baseline.id}：tag（${baseline.tag}）与 id 不一致，stage 目录与 git ref 会分叉`)
    if (!baseline.tag.includes(baseline.version)) problems.push(`${baseline.id}：version（${baseline.version}）与 tag（${baseline.tag}）不匹配`)
  }
  return problems
}

/**
 * 宿主发布的依赖清单里的包名集合。
 *
 * `dsh.client.inject` 写的是**其它客户端插件行**的包名，宿主按其 npm 依赖闭合解析；
 * 因此核对口径就是宿主仓库自带的 `docs/dependency-catalog.json`（dsh 自身安装出来的
 * 依赖清单）。名字对不上的注入项不会让插件崩，但会让「我依赖谁」这句话失真。
 */
export function hostDependencyNames(source) {
  const content = source.read('docs/dependency-catalog.json')
  if (content === undefined) return undefined
  try {
    const catalog = JSON.parse(content)
    return new Set((catalog.dependencies || []).map(entry => entry.name).filter(Boolean))
  } catch {
    return undefined
  }
}

/** 审计 package.json 的 dsh.client.inject：哪些注入模块在宿主包清单里查无此名。 */
export function clientInjectAudit(source, inject = []) {
  const names = hostDependencyNames(source)
  if (names === undefined) return { known: [], unknown: [], checked: false }
  const known = inject.filter(spec => names.has(spec))
  return { known, unknown: inject.filter(spec => !names.has(spec)), checked: true }
}
