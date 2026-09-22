import { z } from 'zod/v3'
import { readCallLogs } from '../execution/call-logger.js'
import { contract } from '../execution/contract.js'
import { err } from '../execution/wrapper.js'

export const observabilityTools = [{
  name: 'research_usage_stats',
  description: 'Read-only aggregated tool-usage observability: per-tool call counts, failure rates, help-route demand, and where research chains commonly break. Only sanitized metadata is counted — query terms, goals, note text and paper content are never stored or returned.',
  inputSchema: {
    run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID to scope the statistics'),
    limit: z.number().int().min(10).max(200).optional().default(200).describe('Max recent call-log entries analyzed'),
  },
  async execute({ run_id, limit }) {
    try {
      const logs = await readCallLogs({ limit, ...(run_id ? { runId: run_id } : {}) })
      const byTool = new Map()
      for (const call of logs) {
        const bucket = byTool.get(call.tool) || { tool: call.tool, calls: 0, failed: 0 }
        bucket.calls += 1
        if (call.ok === false) bucket.failed += 1
        byTool.set(call.tool, bucket)
      }
      const tools = [...byTool.values()].map(bucket => ({ ...bucket, failure_rate: bucket.calls ? Number((bucket.failed / bucket.calls).toFixed(3)) : 0 })).sort((a, b) => b.calls - a.calls)
      const helpCalls = byTool.get('research_help')?.calls || 0
      const startedRuns = new Set(logs.filter(call => call.tool === 'research_run_start' && call.run_id).map(call => call.run_id))
      const advancedRuns = new Set(logs.filter(call => call.run_id && startedRuns.has(call.run_id) && call.tool !== 'research_run_start').map(call => call.run_id))
      const stalledRuns = [...startedRuns].filter(id => !advancedRuns.has(id))
      return contract({ scope: run_id ? { run_id } : { window: `last ${logs.length} calls` }, window_entries: logs.length, tools, observability: { help_calls: helpCalls, runs_started: startedRuns.size, runs_stalled_after_start: stalledRuns.length, stalled_run_ids: stalledRuns.slice(0, 5) } }, {
        source: 'usage-stats', confidence: 'cached', disclaimer: '统计只基于脱敏调用元数据；查询词、目标描述与论文正文从不落盘，也无法从这里还原。',
        summary: { entries_analyzed: logs.length, distinct_tools: tools.length, total_failures: tools.reduce((sum, tool) => sum + tool.failed, 0) },
        next_actions: [
          ...(tools.some(tool => tool.failure_rate >= 0.5 && tool.calls >= 2) ? ['存在失败率过高的工具；优先检查其前置依赖（如宿主 MCP 数据源配置）。'] : []),
          ...(helpCalls > logs.length * 0.3 && logs.length >= 10 ? ['research_help 占比过高；可在提示词里固化常用调用链。'] : []),
          ...(stalledRuns.length ? [`${stalledRuns.length} 个 run 启动后没有后续工具调用；用 research_run_status 查看它们停在哪一步。`] : []),
          '统计仅供改进工具体验；不构成对研究质量的评价。',
        ],
      })
    } catch (e) { return err(`用量统计失败：${e.message}`) }
  },
}]
