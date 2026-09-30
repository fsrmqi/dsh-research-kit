// scripts/*.sh 的守卫：这些脚本只在开发者本机跑（CI 不执行它们），失败模式又依赖具体的
// bash 版本，所以必须由测试钉住——否则「本机开发回路全挂、CI 一路全绿」可以持续很久。
//
// 实测事故：scripts/fetch-baselines.sh 里 `$DSH_REPO：`（全角冒号紧跟变量名）在 macOS 自带的
// bash 3.2 下被解析成变量名「DSH_REPO：」，`set -u` 当场报 unbound variable —— 脚本在拉取任何
// tag 之前就退出 1（tag 一个都没拉到），而 CI 的 bash 5 / sh 一直全绿。register.sh、watch.sh、
// web.sh 里有同类写法（全角括号紧跟变量名），dev:watch 因此每次都在启动后立刻退出。
//
// 因此这里守三件事：变量名必须写成 ${VAR}、脚本必须能过 `bash -n` 且启用 `set -euo pipefail`、
// 并且真的跑一遍 fetch-baselines.sh（对着本地 git 远端），把「引号写法」这类只在运行期暴露的
// 问题变成可复现的断言。
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASELINES } from '../scripts/lib/dsh-baselines.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT_DIR = join(ROOT, 'scripts')
const SCRIPTS = readdirSync(SCRIPT_DIR).filter(name => name.endsWith('.sh')).sort()

// bash 3.2 的变量名字节判定：紧跟变量名的多字节字符会被并进标识符。
// 只匹配「变量名 + 非 ASCII」这一种写法，`${VAR}：` 不受影响。
const VAR_BEFORE_MULTIBYTE = /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/

function readScript(name) {
  return readFileSync(join(SCRIPT_DIR, name), 'utf8')
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

test('shell 脚本的变量名一律写成 ${VAR}（bash 3.2 会把紧跟的多字节字符并进变量名）', () => {
  assert.ok(SCRIPTS.length >= 4, `scripts/ 下应至少有 4 个 shell 脚本，实际 ${SCRIPTS.length}：${SCRIPTS.join(' / ')}`)
  const offenders = []
  for (const name of SCRIPTS) {
    readScript(name).split('\n').forEach((line, index) => {
      const match = VAR_BEFORE_MULTIBYTE.exec(line)
      if (match) offenders.push(`scripts/${name}:${index + 1} → ${match[0]}`)
    })
  }
  assert.deepEqual(
    offenders,
    [],
    '把 $VAR 改写成 ${VAR}：macOS 自带 bash 3.2 下 `$VAR：` 会被当成变量名「VAR：」，'
      + '`set -u` 直接报 unbound variable（脚本死在中途，且 CI 的 bash 5 看不出来）',
  )
})

test('shell 脚本通过 bash -n，且都启用 set -euo pipefail', () => {
  for (const name of SCRIPTS) {
    const file = join(SCRIPT_DIR, name)
    // bash -n 只做语法检查；它查不出上面那类引号问题（那是运行期的），两条断言缺一不可。
    execFileSync('bash', ['-n', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    assert.match(readScript(name), /^set -euo pipefail$/m, `${name} 必须启用 set -euo pipefail（失败要早、未定义变量要报错）`)
  }
})

test('开发回路脚本不按进程名杀进程（只管理自己启动的那一个 pid）', () => {
  for (const name of SCRIPTS) {
    assert.doesNotMatch(
      readScript(name),
      /\b(pkill|killall)\b/,
      `${name} 不得按模式杀进程：开发者机器上常有别的 DSH 会话在跑（见 scripts/web.sh 的说明）`,
    )
  }
})

test('fetch-baselines.sh 能对本地远端把全部基线 tag 拉齐（回归：曾在中途 unbound variable 退出）', () => {
  const remote = mkdtempSync(join(tmpdir(), 'rk-baselines-remote-'))
  const staged = mkdtempSync(join(tmpdir(), 'rk-baselines-repo-'))
  try {
    git(['init', '-q'], remote)
    git(['config', 'user.email', 'test@example.com'], remote)
    git(['config', 'user.name', 'test'], remote)
    for (const baseline of BASELINES) {
      git(['commit', '--allow-empty', '-q', '-m', `fixture ${baseline.tag}`], remote)
      git(['tag', baseline.tag], remote)
    }
    // 本地 file:// 远端才能配合 --depth 做浅拉取（直接给路径时 git 会忽略 depth）。
    const output = execFileSync('bash', [join(SCRIPT_DIR, 'fetch-baselines.sh')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DSH_REPO: staged, DSH_REMOTE: `file://${remote}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    assert.match(output, /拉取基线 tag 到/, '脚本必须走到拉取分支并打印落点（这句曾因 $DSH_REPO： 直接炸掉）')
    const tags = git(['tag'], staged).trim().split('\n').map(tag => tag.trim()).filter(Boolean).sort()
    assert.deepEqual(tags, BASELINES.map(baseline => baseline.tag).sort(), 'BASELINES 里的每个 tag 都必须被拉到')
  } finally {
    rmSync(remote, { recursive: true, force: true })
    rmSync(staged, { recursive: true, force: true })
  }
})
