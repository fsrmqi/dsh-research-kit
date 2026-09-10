#!/usr/bin/env node
// 校验 vendored 工件与 vendor/vendor-manifest.json 的一致性：
// 文件存在、SHA-256 匹配、sizeBytes 一致。清单过期时以非零退出码阻断构建/发布。
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'vendor/vendor-manifest.json'), 'utf8'))
let failed = false
for (const artifact of manifest.artifacts || []) {
  const label = `${artifact.path}（来源 ${artifact.sourceRepo}@${artifact.sourceCommit.slice(0, 7)}）`
  let digest = ''
  try {
    const content = readFileSync(resolve(root, artifact.path))
    digest = createHash('sha256').update(content).digest('hex')
    if (Number.isFinite(artifact.sizeBytes) && content.length !== artifact.sizeBytes) {
      console.error(`✗ ${label}：体积 ${content.length} ≠ 清单 ${artifact.sizeBytes}`)
      failed = true
    }
  } catch (error) {
    console.error(`✗ ${label}：文件缺失（${error.message}）`)
    failed = true
    continue
  }
  if (digest !== artifact.sha256) {
    console.error(`✗ ${label}：SHA-256 不匹配。请更新 vendor-manifest.json 或回滚改动。`)
    failed = true
  } else {
    console.log(`✓ ${label}`)
  }
}
process.exit(failed ? 1 : 0)
