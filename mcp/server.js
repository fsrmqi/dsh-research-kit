#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod/v3'
import { timingSafeEqual } from 'node:crypto'
import { tools } from './tools/index.js'
import { logCall } from './execution/call-logger.js'
import { toolAnnotations, toolMeta } from './tool-registry.js'

const server = new McpServer({
  name: 'dsh-research-kit',
  version: '0.1.0',
}, {
  capabilities: {
    tools: {},
  },
})

function confirmationConfig() {
  const mode = String(process.env.DSH_RESEARCH_KIT_CONFIRM_WRITES || 'required').trim().toLowerCase()
  return { required: mode !== 'disabled', token: String(process.env.DSH_RESEARCH_KIT_CONFIRMATION_TOKEN || '').trim() }
}

function confirmationTokenMatches(candidate, expected) {
  const left = Buffer.from(String(candidate || ''))
  const right = Buffer.from(String(expected || ''))
  return left.length === right.length && timingSafeEqual(left, right)
}

function inputSchemaWithConfirmation(tool) {
  if (!toolMeta(tool.name)?.requiresConfirmation) return tool.inputSchema
  return {
    ...tool.inputSchema,
    confirmation_token: z.string().min(1).optional().describe('Fallback shared secret for hosts without MCP elicitation; must equal DSH_RESEARCH_KIT_CONFIRMATION_TOKEN'),
  }
}

async function confirmWrite(tool, params) {
  if (!toolMeta(tool.name)?.requiresConfirmation) return null
  const config = confirmationConfig()
  if (!config.required) return null
  if (config.token && confirmationTokenMatches(params?.confirmation_token, config.token)) return null
  try {
    const result = await server.server.elicitInput({
      mode: 'form',
      message: `确认执行写入类 MCP 工具 ${tool.name}？`,
      requestedSchema: {
        type: 'object',
        properties: {
          confirm: {
            type: 'boolean',
            title: '人工确认',
            description: '勾选表示用户已确认本次写入。',
          },
        },
        required: ['confirm'],
      },
    })
    if (result.action === 'accept' && result.content?.confirm === true) return null
    return { error: true, code: 'CONFIRMATION_DECLINED', message: '写入操作未获得人工确认。' }
  } catch (error) {
    return {
      error: true,
      code: 'CONFIRMATION_UNAVAILABLE',
      message: `当前宿主不支持 MCP elicitation。请配置 DSH_RESEARCH_KIT_CONFIRMATION_TOKEN 并传入 confirmation_token，或显式设置 DSH_RESEARCH_KIT_CONFIRM_WRITES=disabled。（${error?.message || error}）`,
    }
  }
}

for (const tool of tools) {
  server.tool(tool.name, tool.description, inputSchemaWithConfirmation(tool), toolAnnotations(tool.name), async params => {
    const start = Date.now()
    try {
      const confirmationError = await confirmWrite(tool, params)
      if (confirmationError) {
        await logCall({
          tool: tool.name,
          params,
          result: confirmationError,
          duration_ms: Date.now() - start,
          error: `${confirmationError.code}: ${confirmationError.message}`,
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(confirmationError) }],
          isError: true,
        }
      }
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
