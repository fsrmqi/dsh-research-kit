
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: 'node',
  args: ['mcp/server.js'],
})
const client = new Client({ name: 'smoke-test', version: '0.1.0' })

const timeout = setTimeout(() => { console.error('TIMEOUT'); process.exit(1) }, 20_000)

try {
  await client.connect(transport)
  console.log('1. CONNECTED')

  const toolList = await client.listTools()
  console.log(`2. LISTED ${toolList.tools.length} tools:`, toolList.tools.map(t => t.name).join(', '))

  const result = await client.callTool({ name: 'search_workflows', arguments: { query: '审阅论文', limit: 2 } })
  const parsed = JSON.parse(result.content[0].text)
  console.log('3. search_workflows OK:', JSON.stringify(parsed.data?.workflows?.[0]?.id))
  console.log('   meta.confidence:', parsed.meta?.confidence)

  const compose = await client.callTool({ name: 'compose_workflow', arguments: { workflow_id: parsed.data.workflows[0].id, params: { focus: '统计' } } })
  const composeParsed = JSON.parse(compose.content[0].text)
  console.log('4. compose_workflow OK, prompt chars:', composeParsed.data?.prompt?.length)

  const save = await client.callTool({ name: 'save_evidence', arguments: {
    identifier_type: 'doi',
    identifier: '10.9999/smoke-test',
    title: 'MCP Smoke Test Entry',
    note: 'Automated smoke test',
    project: 'mcp-test',
  } })
  const saveParsed = JSON.parse(save.content[0].text)
  console.log('5. save_evidence OK:', JSON.stringify(saveParsed.data))

  const list = await client.callTool({ name: 'list_evidence', arguments: { project: 'mcp-test' } })
  const listParsed = JSON.parse(list.content[0].text)
  console.log('6. list_evidence OK:', listParsed.data?.entries?.length, 'entries')

  console.log('\nALL SMOKE TESTS PASSED')
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
  await client.close()
}
