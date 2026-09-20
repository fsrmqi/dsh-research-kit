#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { tools } from './tools/index.js'
import { logCall } from './execution/call-logger.js'
import { toolAnnotations } from './tool-registry.js'

const server = new McpServer({
  name: 'dsh-research-kit',
  version: '0.1.0',
}, {
  capabilities: {
    tools: {},
  },
})

for (const tool of tools) {
  server.tool(tool.name, tool.description, tool.inputSchema, toolAnnotations(tool.name), async params => {
    const start = Date.now()
    try {
      const result = await tool.execute(params)
      const toolError = result?.error === true
      await logCall({
        tool: tool.name,
        params,
        result,
        duration_ms: Date.now() - start,
        error: toolError ? `${result.code || 'TOOL_ERROR'}: ${result.message}` : undefined,
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        ...(toolError ? { isError: true } : {}),
      }
    } catch (e) {
      await logCall({ tool: tool.name, params, error: e.message, duration_ms: Date.now() - start })
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: true, message: e.message }) }],
        isError: true,
      }
    }
  })
}

const transport = new StdioServerTransport()
await server.connect(transport)
