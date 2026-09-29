// DSH 兼容性矩阵：把「插件依赖宿主哪些契约」变成可执行的断言。
//
// 分两层：
//   1. 永远可跑（不需要 DSH 源码）——基线数据自洽、插件自身接线、槽位看守完整性、已知缺口绊线；
//   2. 需要基线源码——每个基线 tag 上逐条核对 HOST_SEAMS，并验证浏览器产物 require 的模块
//      都由该代宿主的模块表回答；**没有源码时改核对降级路径本身**（见下）。
//
// 源码从哪来（任一即可）：
//   npm run baselines:fetch   → .tmp/dsh-repo（浅拉取基线 tag）
//   DSH_REPO=/path/to/deepseek-harness
//   .tmp/dsh-tags/<baseline id>/（已解包工作树）
//
// 第 2 层为什么不再用 { skip }：TAP 的 `# tests` 不计被 skip 的 suite，于是同一个仓库会
// 「干净 clone 实测 459 / 有源码 469」，文档数字在对与错之间反复横跳——`check:test-count`
// 在干净 clone 上必红，而 `prepublishOnly` 串了它，干净 clone 上连 npm publish 都会被挡。
// 现在每个基线恒定 5 个用例：有源码就核对宿主；没源码就核对降级路径（跳过原因可读可操作、
// 检查函数对缺失源码 fail-closed、CLI 拒绝把「没源码」当通过）。用例数不再随环境变化。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { BASELINES, HOST_SEAMS, KNOWN_GAPS, PEER_RANGE, declaredSlots } from '../scripts/lib/dsh-baselines.mjs'
import {
  ROOT,
  baselineDataProblems,
  checkHostSeams,
  checkPlatformModules,
  checkPluginContracts,
  clientBundleRequires,
  clientInjectAudit,
  dirSource,
  gitSource,
  slotGuardReport,
  sourceProvenance,
  sourceForBaseline,
  unprobedSlots,
} from '../scripts/lib/dsh-compat.mjs'

const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// 冻结清单（独立于 HOST_SEAMS 的一份拷贝，故意重复以形成绊线）：
// HOST_SEAMS 是「我依赖宿主什么」的唯一事实源，删掉/改写其中任一条都必须是有意为之。
// 过去这里只有 `required.length >= 8`（实际有 10 条必需 seam），于是删掉
// desktop-app-origin 与 desktop-request-forward 两条（它们没有 slot 字段、也不被
// unprobedSlots 看守）之后，矩阵仍然 15/15 全绿。
const REQUIRED_SEAM_IDS = [
  'agent-events',
  'chat-assistant-actions',
  'conversation-input-slots',
  'conversation-view',
  'desktop-app-origin',
  'desktop-plugin-api-forward',
  'desktop-request-forward',
  'input-contract',
  'plugin-detail-slots',
  'tool-call-toolview',
]
const OPTIONAL_SEAM_IDS = ['view-navigation']
const DECLARED_SLOT_NAMES = [
  'conversation.chat.assistant-actions',
  'conversation.input.left',
  'conversation.input.overlay',
  'conversation.input.right',
  'conversation.view',
  'plugins.detail.actions',
  'plugins.detail.badge',
  'plugins.detail.section',
  'plugins.row.config',
  'tool.call.toolview',
]
// 产物侧（与宿主无关）：插件生成的工厂固定只 require 这两个平台模块。
// 提取方式一旦与产物写法脱节，集合就会是空的——而那正是这条检查空转的样子。
const BUNDLE_REQUIRES = ['react', 'react-dom']

describe('compat 矩阵 —— 不依赖宿主（任何环境都跑）', () => {
  test('基线数据自洽，且每个版本都落在 peerDependencies 声明的范围内', () => {
    assert.deepEqual(baselineDataProblems(), [])
    assert.equal(PACKAGE.peerDependencies['@deepseek-ai/dsh'], PEER_RANGE)
    // peer 范围的边界书写与基线表必须一致：写 0.2.1-0 却把 0.2.1 的 tag 列进基线，
    // 等于「声明不支持、实际在验」，反向则是「声明支持、没人验过」。
    assert.match(PEER_RANGE, /^>=0\.1\.7-0 <0\.1\.8-0 \|\| >=0\.2\.0-0 <0\.2\.1-0$/)
    for (const baseline of BASELINES) {
      assert.match(baseline.version, /^0\.(1\.7|2\.0)-/, `${baseline.id} 必须在 peer 范围内`)
    }
  })

  test('每条 host seam 都指向真实文件且带非空断言（空检查不能算通过）', () => {
    const seen = new Set()
    for (const seam of HOST_SEAMS) {
      assert.ok(seam.id && !seen.has(seam.id), `seam id 缺失或重复：${seam.id}`)
      seen.add(seam.id)
      assert.ok(seam.file && seam.file.includes('/'), `${seam.id} 缺少宿主文件路径`)
      assert.ok(Array.isArray(seam.tokens) && seam.tokens.length > 0, `${seam.id} 没有任何断言 token`)
      for (const token of seam.tokens) assert.ok(token.length > 1, `${seam.id} 的 token 过短，会误命中：${token}`)
    }
    assert.deepEqual(
      HOST_SEAMS.filter(seam => !seam.optional).map(seam => seam.id).sort(),
      REQUIRED_SEAM_IDS,
      '必需 seam 清单变了：删/改 seam 必须同步这条冻结清单与 docs/COMPATIBILITY.md 的表格',
    )
    assert.deepEqual(
      HOST_SEAMS.filter(seam => seam.optional).map(seam => seam.id).sort(),
      OPTIONAL_SEAM_IDS,
      '可选 seam 清单变了：必须同步这条冻结清单与 docs/COMPATIBILITY.md',
    )
  })

  test('插件注册的每个槽位都在矩阵里被看守（新增槽位不许无人看守）', () => {
    assert.deepEqual(unprobedSlots(), [], '上面这些槽位没有对应的 HOST_SEAMS 条目：请补 seam 或从注册处移除')
    const report = slotGuardReport()
    // 空集不等于安全：源文件被改名/删掉时收集结果会变空，而「零个槽位无人看守」看起来是绿的。
    assert.deepEqual(report.unreadable, [], '这些槽位源文件读不到：过去这里 catch 后继续，收集为空也能通过')
    assert.ok(report.found >= DECLARED_SLOT_NAMES.length, `只收集到 ${report.found} 个槽位（应 ≥ ${DECLARED_SLOT_NAMES.length}）：槽位看守可能空转`)
    assert.deepEqual([...declaredSlots()].sort(), DECLARED_SLOT_NAMES, '声明槽位集合变了：必须同步这条冻结清单与 docs/COMPATIBILITY.md')
  })

  test('插件自身接线契约成立（路由字符串、跨层 key）', () => {
    const failures = checkPluginContracts().filter(result => !result.ok)
    assert.deepEqual(failures.map(f => `${f.id}: ${f.missing.join(' / ')}`), [])
  })

  test('已知缺口绊线仍在：修好之后必须回来删掉缺口记录与文档', () => {
    for (const gap of KNOWN_GAPS) {
      const source = readFileSync(join(ROOT, gap.tripwire.file), 'utf8')
      assert.ok(
        source.includes(gap.tripwire.token),
        `缺口「${gap.label}」的对不上代码已不存在——若已修复，请同时更新 scripts/lib/dsh-baselines.mjs 的 KNOWN_GAPS、`
          + `docs/COMPATIBILITY.md 与 ${gap.trackedIn}；否则请说明为何这段接线消失了。`,
      )
    }
  })
})

describe('compat 矩阵 —— 真实宿主源码（无源码时核对降级路径）', () => {
  // 探针：一个必然读不到任何宿主文件的副本。用它把「读不到源码会不会被当成通过」测出来。
  const ghost = () => dirSource({ dir: join(ROOT, '.tmp/definitely-missing-source'), label: '缺失源码探针' })
  const CLI = join(ROOT, 'scripts/check-dsh-app.mjs')

  BASELINES.forEach(baseline => {
    const picked = sourceForBaseline(baseline)
    if (!picked.source) console.warn(`[compat] 跳过 ${baseline.version}：${picked.skip}`)

    describe(`DSH ${baseline.version}${picked.source ? '' : '（无源码）'}`, () => {
      test('源码版本自证：tag 指向的 package.json 就是基线声明的版本', t => {
        // 「来源自证」的口径必须区分（两种模式下都跑）：git 源的内容由 `git show <tag>:<file>`
        // 取出，天然绑在 tag 的提交上；目录/工作树副本里的 package.json 是人写的，改一个
        // version 就能冒充基线，所以它必须报告「未自证」——CI 的 --require-source 只接受
        // verified 的源（本机用已解包副本跑严格模式会退 2，除非传 --allow-unverified-source）。
        assert.equal(
          sourceProvenance(gitSource({ repo: ROOT, tag: baseline.tag }), baseline).verified,
          true,
          'git 源必须自证',
        )
        assert.equal(sourceProvenance(ghost(), baseline).verified, false, '目录源不得自称已验证')
        if (!picked.source) {
          assert.ok(picked.skip, '没有源码时必须给出跳过原因，不能静默通过')
          assert.match(picked.skip, /baselines:fetch|DSH_REPO/, '跳过原因必须给出补救办法')
          t.diagnostic(`未核对宿主（无源码）：${picked.skip}`)
          return
        }
        const actual = JSON.parse(picked.source.read('package.json') || '{}').version
        assert.equal(actual, baseline.version)
        const provenance = sourceProvenance(picked.source, baseline)
        if (picked.source.kind === 'git') assert.equal(provenance.verified, true, 'git 源必须自证')
        else assert.equal(provenance.verified, false, '目录源必须如实报告未绑 git，不能默认通过')
        t.diagnostic(`来源：${provenance.label}${provenance.verified ? '' : ` —— ${provenance.note}`}`)
      })

      test('全部必需 seam 成立（失败会点名是哪个宿主文件少了什么）', t => {
        if (!picked.source) {
          // fail-closed：读不到源码必须报失败，绝不能零检查就算通过。
          const outcome = checkHostSeams(ghost())
          assert.ok(outcome.failures.length > 0, '源码缺失时 seam 检查必须失败，而不是零检查通过')
          t.diagnostic(`已验证 fail-closed：缺失源码报出 ${outcome.failures.length} 处失败`)
          return
        }
        const outcome = checkHostSeams(picked.source)
        assert.deepEqual(
          outcome.failures.map(f => `${f.label} → ${f.missing.join(' / ')}`),
          [],
        )
        assert.equal(outcome.required.length, REQUIRED_SEAM_IDS.length, '必需 seam 数量与冻结清单不一致')
      })

      test('可选 seam 的状态如实报告，且不参与失败判定', t => {
        // 这条断言过去是恒真的：unavailableOptional 的定义就是 !ok && optional，断言它
        // 「都是 optional」不可能失败。改成对探针做行为断言——探针里必需与可选 seam 都缺，
        // 两类必须分开统计，否则「可选」会变成整体放行的借口。
        const probe = checkHostSeams(ghost())
        assert.ok(probe.failures.length > 0, '探针应产生必需失败，否则这条断言没有区分力')
        assert.ok(probe.unavailableOptional.every(seam => seam.optional), '可选缺失清单里混进了必需 seam')
        assert.ok(probe.failures.every(seam => !seam.optional), '必需失败清单里混进了可选 seam')
        if (picked.source) {
          const real = checkHostSeams(picked.source)
          if (real.unavailableOptional.length) {
            assert.equal(real.failures.length, 0, '可选 seam 缺失不得计入失败判定')
          }
          t.diagnostic(`真实基线：可选缺失 ${real.unavailableOptional.length} 条 / 失败 ${real.failures.length} 条`)
        } else {
          t.diagnostic('无源码：仅验证了必需失败与可选缺失的统计分离')
        }
      })

      test('浏览器模块表能回答产物的每个 require（回答不了的 require 是必然启动崩溃）', t => {
        // 先钉住产物侧的提取结果（与有无宿主源码无关）：提取为空 = 这条检查空转。
        // 产物模板用单引号 require('react')，而提取正则过去只认双引号，集合恒为空，
        // 于是「回答不了的 require 是必然启动崩溃」对任何宿主都判通过。
        const requires = clientBundleRequires()
        assert.ok(requires.length > 0, '产物里没提取到任何 require：platform 模块表检查会空转')
        assert.deepEqual(requires, BUNDLE_REQUIRES, '产物 require 集合变了：请同步 platform 断言与 docs/COMPATIBILITY.md')
        if (!picked.source) {
          const platform = checkPlatformModules(ghost())
          assert.equal(platform.ok, false, '源码缺失时模块表检查必须失败，而不是零检查通过')
          t.diagnostic(`已验证 fail-closed：缺失源码报出 ${platform.missing.join(' / ')}`)
          return
        }
        const platform = checkPlatformModules(picked.source)
        assert.deepEqual(platform.missing, [])
      })

      test('dsh.client.inject 的每个未命中项都已在 KNOWN_GAPS 里挂号（不许有未追踪的失真声明）', t => {
        if (!picked.source) {
          // 无源码时守住 CLI 的硬门禁语义（这正是「看起来在守、其实没守」的高发处）：
          // 未知/拼错参数、路径不存在、--require-source 配不存在的路径，都必须退出 2。
          const missingPath = join(ROOT, '.tmp/definitely-missing-worktree')
          const cases = [
            { args: ['--require-sourc'], hint: '未知参数' },
            { args: [missingPath], hint: '路径不存在' },
            { args: ['--require-source', missingPath], hint: '路径不存在' },
          ]
          for (const item of cases) {
            const run = spawnSync(process.execPath, [CLI, ...item.args], { cwd: ROOT, encoding: 'utf8' })
            assert.equal(run.status, 2, `check-dsh-app ${item.args.join(' ')} 应退出 2，实际 ${run.status}：${run.stdout}${run.stderr}`)
            assert.match(run.stderr, new RegExp(item.hint), `失败原因应点名「${item.hint}」：${run.stderr}`)
          }
          t.diagnostic('已验证 CLI 的三种误用都退出 2')
          return
        }
        const audit = clientInjectAudit(picked.source, PACKAGE.dsh.client.inject)
        // 以前这里是 if (!audit.checked) return —— 宿主依赖清单读不到就等于这条断言没跑，
        // 而且没有任何信号。改成显式失败：读不到清单说明清单被改名/删了，必须有人处理。
        assert.equal(audit.checked, true, '宿主依赖清单读不到，等于这条断言没跑：请确认 docs/dependency-catalog.json 仍存在且可解析')
        assert.ok(audit.known.length >= 1, '注入清单与宿主包清单完全不相交，八成是清单口径写错了')
        const tracked = KNOWN_GAPS.find(gap => gap.id === 'phantom-client-inject')
        assert.ok(tracked, '未命中的注入项必须在 KNOWN_GAPS 中有记录，否则没人知道它一直对不上')
        const pkgSource = readFileSync(join(ROOT, 'package.json'), 'utf8')
        for (const spec of audit.unknown) {
          assert.ok(
            pkgSource.includes(spec) && tracked.tripwire.token.includes(spec),
            `注入项 ${spec} 在宿主里查不到，却没被 KNOWN_GAPS 的绊线覆盖`,
          )
        }
        t.diagnostic(`真实基线：命中 ${audit.known.length} 项 / 未命中 ${audit.unknown.length} 项`)
      })
    })
  })
})
