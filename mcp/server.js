#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { tools } from './tools/index.js'

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
    try {
      const result = await tool.execute(params)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    } catch (e) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: true, message: e.message }, null, 2) }],
        isError: true,
      }
    }
  })
}

const transport = new StdioServerTransport()
await server.connect(transport)
