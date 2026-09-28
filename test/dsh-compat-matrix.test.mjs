// DSH 兼容性矩阵：把「插件依赖宿主哪些契约」变成可执行的断言。
//
// 分两层：
//   1. 永远可跑（不需要 DSH 源码）——基线数据自洽、插件自身接线、槽位看守完整性、已知缺口绊线；
//   2. 有源码才跑——每个基线 tag 上逐条核对 HOST_SEAMS，并验证浏览器产物 require 的模块
//      都由该代宿主的模块表回答。
//
// 源码从哪来（任一即可，缺失时第 2 层整体 skip 并打印原因）：
//   npm run baselines:fetch   → .tmp/dsh-repo（浅拉取基线 tag）
//   DSH_REPO=/path/to/deepseek-harness
//   .tmp/dsh-tags/<baseline id>/（已解包工作树）
import assert from 'node:assert/strict'
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
  clientInjectAudit,
  sourceForBaseline,
  unprobedSlots,
} from '../scripts/lib/dsh-compat.mjs'

const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

describe('compat 矩阵 —— 不依赖宿主（任何环境都跑）', () => {
  test('基线数据自洽，且每个版本都落在 peerDependencies 声明的范围内', () => {
    assert.deepEqual(baselineDataProblems(), [])
    assert.equal(PACKAGE.peerDependencies['@deepseek-ai/dsh'], PEER_RANGE)
    // peer 范围的边界书写与基线表必须一致：写 0.1.8-0 却把 0.1.8 的 tag 列进基线，
    // 等于「声明不支持、实际在验」，反向则是「声明支持、没人验过」。
    assert.match(PEER_RANGE, /^>=0\.1\.7-0 <0\.1\.8-0$/)
    for (const baseline of BASELINES) {
      assert.match(baseline.version, /^0\.1\.7-/, `${baseline.id} 必须在 peer 范围内`)
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
  })

  test('插件注册的每个槽位都在矩阵里被看守（新增槽位不许无人看守）', () => {
    assert.deepEqual(unprobedSlots(), [], '上面这些槽位没有对应的 HOST_SEAMS 条目：请补 seam 或从注册处移除')
    assert.ok(declaredSlots().size >= 7, '声明槽位数量骤降，检查 HOST_SEAMS 是否被误删')
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

describe('compat 矩阵 —— 真实宿主源码（需要基线 tag，缺失则跳过）', () => {
  for (const baseline of BASELINES) {
    const picked = sourceForBaseline(baseline)
    const reason = picked.skip ? `跳过 ${baseline.version}：${picked.skip}` : undefined
    if (reason) console.warn(`[compat] ${reason}`)

    describe(`DSH ${baseline.version}`, { skip: reason }, () => {
      test('源码版本自证：tag 指向的 package.json 就是基线声明的版本', () => {
        const actual = JSON.parse(picked.source.read('package.json') || '{}').version
        assert.equal(actual, baseline.version)
      })

      test('全部必需 seam 成立（失败会点名是哪个宿主文件少了什么）', () => {
        const outcome = checkHostSeams(picked.source)
        assert.deepEqual(
          outcome.failures.map(f => `${f.label} → ${f.missing.join(' / ')}`),
          [],
        )
        assert.ok(outcome.required.length >= 8, '必需 seam 数量骤降，检查 HOST_SEAMS')
      })

      test('可选 seam 的状态如实报告，且不参与失败判定', () => {
        const outcome = checkHostSeams(picked.source)
        for (const seam of outcome.unavailableOptional) {
          assert.ok(seam.optional, '只有声明 optional 的 seam 才允许缺失')
        }
        assert.ok(outcome.unavailableOptional.every(seam => seam.label.length > 0))
      })

      test('浏览器模块表能回答产物的每个 require（回答不了的 require 是必然启动崩溃）', () => {
        const platform = checkPlatformModules(picked.source)
        assert.deepEqual(platform.missing, [])
      })

      test('dsh.client.inject 的每个未命中项都已在 KNOWN_GAPS 里挂号（不许有未追踪的失真声明）', () => {
        const audit = clientInjectAudit(picked.source, PACKAGE.dsh.client.inject)
        if (!audit.checked) return // 该代宿主没带依赖清单，无从核对
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
      })
    })
  }
})
