#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { tools } from './tools/index.js'
import { logCall } from './execution/call-logger.js'

const server = new McpServer({
  name: 'dsh-research-kit',
  version: '0.1.0',
}, {
  capabilities: {
    tools: {},
  },
})

for (const tool of tools) {
  server.tool(tool.name, tool.description, tool.inputSchema, async params => {
    const start = Date.now()
    try {
      const result = await tool.execute(params)
      await logCall({ tool: tool.name, params, result, duration_ms: Date.now() - start })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    } catch (e) {
      await logCall({ tool: tool.name, params, error: e.message, duration_ms: Date.now() - start })
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: true, message: e.message }, null, 2) }],
        isError: true,
      }
    }
  })
}

const transport = new StdioServerTransport()
await server.connect(transport)
