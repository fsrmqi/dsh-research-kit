import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const toolsDir = path.join(root, 'mcp/tools')
const files = (await readdir(toolsDir))
  .filter(file => file.endsWith('.js'))
  .sort()

for (const file of files) {
  const relativePath = path.posix.join('mcp/tools', file)
  const result = spawnSync(process.execPath, ['--check', relativePath], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout)
    process.exit(result.status || 1)
  }
}

console.log(`MCP 工具模块语法检查通过：${files.length} 个文件。`)
