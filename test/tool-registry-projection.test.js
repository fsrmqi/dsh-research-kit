import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TOOL_REGISTRY } from '../mcp/tool-registry-data.js'
import { CLIENT_TOOL_FIELDS, SERVER_ONLY_FIELDS, clientToolRegistrySource, projectToolRegistry } from '../mcp/tool-registry-projection.js'

// 客户端产物只带浏览器渲染用得到的字段（省约 7.6 KB），服务端与文档才用的
// example / helpRoute / tier / artifactKind / category 一律不进 ui/client.js。
// 这里守住三件事：投影字段齐全、消费方没读被裁字段、产物里确实没有它们。

const CONSUMERS = ['../src/research-toolview.js']

test('工具投影：字段齐全、数量与注册表一致、被裁字段不出现', () => {
  const projected = projectToolRegistry()
  assert.equal(projected.length, TOOL_REGISTRY.length, '投影不得丢工具')
  assert.deepEqual(Object.keys(projected[0]), CLIENT_TOOL_FIELDS, '投影只带声明过的字段')
  for (const tool of projected) {
    assert.ok(tool.name, '投影缺 name')
    assert.ok(tool.labelZh, `${tool.name} 投影缺 labelZh（工具卡标题）`)
    assert.ok(tool.summaryZh, `${tool.name} 投影缺 summaryZh（工具卡摘要）`)
    for (const field of SERVER_ONLY_FIELDS) {
      assert.equal(field in tool, false, `${tool.name} 不应带服务端字段 ${field}`)
    }
  }
  // 生成的源码片段必须自洽：工具数、字段名都在，且不含被裁字段字面量。
  const source = clientToolRegistrySource()
  assert.match(source, /const TOOL_REGISTRY = \[/)
  assert.match(source, /const ARTIFACT_KIND_LABELS = \{/)
  for (const field of SERVER_ONLY_FIELDS) {
    assert.ok(!new RegExp(`\\b${field}:`).test(source), `生成源码不应含 ${field} 字段`)
  }
})

test('工具投影：客户端消费方不得读取被裁字段（否则运行期拿到 undefined）', () => {
  for (const file of CONSUMERS) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    for (const field of SERVER_ONLY_FIELDS) {
      assert.ok(!new RegExp(`\\.${field}\\b`).test(source),
        `${file} 读了 ${field}，但它已被客户端投影裁掉；要么加进 CLIENT_TOOL_FIELDS，要么改读别的字段`)
    }
  }
})

test('工具投影：产物里 36 个工具的中文名与摘要都在，服务端专用字段不在', () => {
  const bundle = readFileSync(new URL('../ui/client.js', import.meta.url), 'utf8')
  for (const tool of TOOL_REGISTRY) {
    assert.ok(bundle.includes(JSON.stringify(tool.name)), `产物缺工具 ${tool.name}`)
    assert.ok(bundle.includes(JSON.stringify(tool.labelZh)), `产物缺中文名 ${tool.labelZh}`)
    assert.ok(bundle.includes(JSON.stringify(tool.summaryZh)), `产物缺摘要 ${tool.name}`)
  }
  // 哨兵：任一工具的 example 正文都不该出现在浏览器产物里。
  const sentinel = TOOL_REGISTRY.map(tool => String(tool.example || '')).sort((a, b) => b.length - a.length)[0]
  assert.ok(sentinel.length > 30, '注册表 example 字段应足够长，才能当哨兵')
  assert.ok(!bundle.includes(sentinel.slice(0, 40)), 'example 是服务端字段，不得进入客户端产物')
  // 标签函数仍在产物内。
  assert.match(bundle, /function toolLabel\(/)
  assert.match(bundle, /function artifactKindLabel\(/)
})
