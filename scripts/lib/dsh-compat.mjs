// compat 矩阵的执行层：把宿主源码（git tag 或已解包的目录）读成 seam 检查结果。
//
// CLI（scripts/check-dsh-app.mjs）与测试（test/dsh-compat-matrix.test.mjs）共用本文件，
// 因此「本地手跑」与「CI/发布门禁」检查的是同一套断言，不存在两套口径。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

/** git tag 读取器：`git show <tag>:<file>`。文件不在该 tag 上时返回 undefined。 */
export function gitSource({ repo, tag }) {
  return {
    kind: 'git',
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

/** 工作树目录读取器：直接读文件。 */
export function dirSource({ dir, label }) {
  return {
    kind: 'dir',
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

/** 从构建产物里取出浏览器 bundle 真正 require 的模块名。 */
export function clientBundleRequires(bundlePath = join(ROOT, 'ui', 'client.js')) {
  const source = readFileSync(bundlePath, 'utf8')
  return [...new Set([...source.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1]))].sort()
}

/** 从宿主 platform.ts 的 PLATFORM_MODULES 数组里取出它能回答的模块名。 */
export function platformModulesOf(source) {
  const content = source.read('packages/client/web/src/platform.ts')
  if (content === undefined) return undefined
  const block = /PLATFORM_MODULES\s*=\s*\[([\s\S]*?)\]/.exec(content)
  if (!block) return undefined
  return [...new Set([...block[1].matchAll(/'([^']+)'/g)].map(match => match[1]))]
}

/**
 * 动态 seam：浏览器产物 require 的每个模块都必须由该代宿主的模块表回答——
 * 回答不了的 require 是**必然的启动崩溃**，不是「某个功能不可用」。
 */
export function checkPlatformModules(source, bundlePath) {
  const table = platformModulesOf(source)
  if (table === undefined) return { id: 'platform-modules', ok: false, missing: ['宿主 platform.ts 缺少 PLATFORM_MODULES'] }
  const missing = clientBundleRequires(bundlePath).filter(spec => !table.includes(spec))
  return { id: 'platform-modules', ok: missing.length === 0, missing }
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
export function collectPluginSlots(root = ROOT, sources = PLUGIN_SLOT_SOURCES) {
  const found = new Map()
  for (const entry of sources) {
    let content
    try {
      content = readFileSync(join(root, entry.file), 'utf8')
    } catch {
      continue
    }
    for (const match of content.matchAll(entry.pattern)) {
      if (!found.has(match[1])) found.set(match[1], `${entry.file}`)
    }
  }
  return found
}

/** 未被矩阵看守的注册槽位。 */
export function unprobedSlots(root = ROOT) {
  const declared = declaredSlots()
  return [...collectPluginSlots(root)].filter(([slot]) => !declared.has(slot))
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
