#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.argv[2]
if (!root) {
  process.stderr.write('用法：npm run check:dsh-app -- /path/to/deepseek-harness\n')
  process.exitCode = 2
} else {
  const read = file => readFileSync(resolve(root, file), 'utf8')
  try {
    const dsh = JSON.parse(read('package.json'))
    const plugin = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const version = String(dsh.version || '')
    const peer = plugin.peerDependencies?.['@deepseek-ai/dsh']
    if (!/^0\.1\.7(?:-|$)/.test(version) || peer !== '>=0.1.7-0 <0.1.8-0') {
      throw new Error(`DSH ${version} 与插件声明 ${peer} 未经过本适配检查；请先审阅接口再扩展版本范围。`)
    }
    const input = read('packages/client/ui-conversation/src/client/contract/input.ts')
    const tools = read('packages/client/ui-tool/src/client/contract/slots.ts')
    const desktop = read('apps/desktop/README.md')
    for (const [name, source, tokens] of [
      ['输入框', input, ['captureInsertion()', 'insertText(text: string, span: TokenSpan)', 'setDraft(text: string)']],
      ['工具卡', tools, ["'tool.call.toolview'", "phase: 'preparing'", "phase: 'start'", "phase: 'result'"]],
      ['Desktop', desktop, ['dsh-app://app/', '$DSH_HOME/profiles/desktop', 'Plugins page']],
    ]) {
      for (const token of tokens) if (!source.includes(token)) throw new Error(`${name} 接口缺少 ${token}；需人工重新适配。`)
    }
    process.stdout.write(`DSH ${version}：插件版本、输入框、工具卡和 Desktop profile 静态契约通过。仍需真实 App 验收。\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
