import { z } from 'zod/v3'
import { itemById } from '../../src/catalog.js'
import { readCallLogs } from '../execution/call-logger.js'
import { contract } from '../execution/contract.js'
import { inventoryEvidence } from '../execution/evidence-inventory.js'
import { err, wrap } from '../execution/wrapper.js'
import { getCheckpointState, initializeCheckpoints, recordApproval } from '../state/checkpoint-manager.js'
import { exportPassport, importPassport } from '../state/material-passport.js'
import { buildRunOverview, listRecentRuns } from '../state/run-overview.js'

export const runLifecycleTools = [
  {
    name: 'research_run_start',
    description: 'Start a traceable research run from a catalog workflow. Creates the Material Passport and initializes its human checkpoints in one call. Use this as the default run entry point; research_run_export remains for explicit state snapshots later in the workflow.',
    inputSchema: {
      workflow_id: z.string().describe('Catalog workflow ID to run'),
      project: z.string().optional().default('default').describe('Project name for this research run'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional caller-chosen run ID; generated when omitted.'),
      current_stage: z.string().optional().default('research_planning').describe('Initial workflow stage'),
      constraints: z.array(z.string()).optional().describe('Research constraints to carry in the new passport'),
    },
    async execute({ workflow_id, project, run_id, current_stage, constraints }) {
      const workflow = itemById(workflow_id)
      if (!workflow || workflow.type !== 'workflow') return err(`工作流 "${workflow_id}" 不存在。`)
      try {
        const passport = await exportPassport({
          run_id,
          project,
          current_stage,
          constraints,
          workflow_id: workflow.id,
          pending: [{ stage: current_stage, workflow_id, note: `已启动工作流：${workflow.name}` }],
        })
        const checkpoint_state = await initializeCheckpoints(passport.run_id, workflow, [])
        return contract({
          current_stage,
          workflow: { id: workflow.id, name: workflow.name, category: workflow.category },
          checkpoint_state,
          passport: { yaml: passport.passport_yaml, hash: passport.hash },
        }, {
          source: 'research-run-starter',
          confidence: 'verified',
          disclaimer: '创建运行和检查点不代表研究步骤已经执行；每项研究结论仍需人工核验。',
          run_id: passport.run_id,
          summary: {
            workflow_id: workflow.id,
            workflow_name: workflow.name,
            current_stage,
            pending_checkpoints: (checkpoint_state.pending || []).length,
          },
          next_actions: [
            '使用 research_run_status 查看运行总览、证据盘点与推荐下一步。',
            '使用 research_workflow_compose 生成当前阶段的可执行 Prompt。',
            '检索与保存请走 research_literature_search；核验与保存均须显式开启。',
          ],
        })
      } catch (e) {
        return err(`启动研究运行失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_run_status',
    description: 'Read-only overview of a research run: current workflow stage, pending human checkpoints, evidence inventory (totals, missing traceability, unverified), recent artifacts, and recommended next actions. Without run_id, lists the most recently active runs. Never executes research steps or writes any state.',
    inputSchema: {
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Research run ID to inspect; omit to list recent runs.'),
      project: z.string().optional().describe('Project name for the evidence inventory; defaults to the run\'s passport project or "default".'),
      limit: z.number().int().min(1).max(200).optional().default(100).describe('Max evidence entries included in the inventory'),
      recent_limit: z.number().int().min(1).max(50).optional().default(10).describe('Max runs listed when run_id is omitted'),
    },
    async execute({ run_id, project, limit, recent_limit }) {
      try {
        if (!run_id) {
          const runs = await listRecentRuns({ limit: recent_limit })
          return contract({
            runs,
          }, {
            source: 'research-run-status',
            confidence: 'cached',
            disclaimer: '运行列表来自护照与检查点文件；创建运行不代表研究步骤已经执行。',
            summary: {
              runs_listed: runs.length,
              waiting_review: runs.filter(run => run.pending_checkpoints > 0).length,
            },
            next_actions: [
              ...(runs.length ? ['选择一个 run_id 再次调用，查看该运行的总览与推荐下一步。'] : []),
              ...(!runs.length ? ['当前没有已启动的运行；使用 research_run_start 从目录工作流创建。'] : []),
            ],
          })
        }

        const overview = await buildRunOverview(run_id)
        const workflow = overview.workflow_id ? itemById(overview.workflow_id) : null
        const evidence = await inventoryEvidence({
          project: project || overview.project === 'unknown' ? (project || 'default') : (project || overview.project),
          run_id,
          limit,
        })
        const logs = await readCallLogs({ limit: 200, runId: run_id })
        const artifacts = logs.filter(call => call.ok !== false && call.artifact_kind).slice(0, 10)
          .map(call => ({ kind: call.artifact_kind, tool: call.tool, summary: call.result_summary, at: call.at }))
        const pending = overview.checkpoint_state.pending || []
        const { missing_traceability: missing, unverified } = evidence.summary
        return contract({
          project: evidence.project,
          current_stage: overview.current_stage,
          workflow: overview.workflow_id ? { id: overview.workflow_id, ...(overview.workflow_name ? { name: overview.workflow_name } : {}) } : null,
          status: overview.status,
          checkpoints: { pending, approved: overview.checkpoint_state.approved || [] },
          stage_progress: overview.stage_progress,
          evidence: evidence.summary,
        }, {
          source: 'research-run-status',
          confidence: 'cached',
          disclaimer: '状态汇总为只读投影，不代表研究步骤已被执行或核验；每项结论仍需人工确认。',
          run_id,
          summary: {
            current_stage: overview.current_stage,
            status: overview.status,
            workflow_completed: overview.stage_progress?.workflow_completed ?? null,
            pending_checkpoints: pending.length,
            evidence_total: evidence.summary.total,
            missing_traceability: missing,
            unverified,
          },
          next_actions: [
            ...(pending.length ? [`人工审批 ${pending.length} 个待放行检查点：${pending.join('、')}；使用 research_run_checkpoint_approve 并由人工确认。`] : []),
            ...(missing ? [`补齐 ${missing} 条缺少稳定标识符或链接的证据来源。`] : []),
            ...(unverified ? [`人工核验 ${unverified} 条尚未核验的证据；自动建议不等同于确认。`] : []),
            ...(!evidence.entries.length ? ['该 run 还没有证据条目；使用 research_literature_search 检索并显式保存可追溯来源。'] : []),
            ...(!pending.length && evidence.entries.length && !artifacts.length ? ['证据已就绪；使用 research_review_output 审阅研究草稿，或 research_run_export 导出护照交接。'] : []),
            ...(!pending.length && artifacts.length ? ['使用 research_run_export 导出护照交接，或 research_review_output 继续审阅草稿。'] : []),
          ],
          artifacts,
        })
      } catch (e) {
        return err(`运行状态查询失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_run_export',
    description: 'Export a Material Passport (cross-session research state snapshot) as YAML.',
    inputSchema: {
      project: z.string().optional().describe('Project name'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Reuse an existing Research Kit run ID; otherwise a new ID is generated.'),
      workflow_id: z.string().optional().describe('Workflow ID; used to initialize required checkpoints'),
      current_stage: z.string().describe('Current pipeline stage (e.g. literature_search, evidence_extraction, synthesis)'),
      completed: z.array(z.object({ stage: z.string(), tool: z.string(), summary: z.string() })).optional().describe('Completed steps'),
      pending: z.array(z.object({ stage: z.string(), tool: z.string().optional(), workflow_id: z.string().optional(), note: z.string().optional() })).optional().describe('Remaining steps'),
      constraints: z.array(z.string()).optional().describe('Research constraints to carry forward'),
      evidence_ids: z.array(z.string()).optional().describe('Evidence IDs referenced by this pipeline'),
    },
    async execute(input) {
      try {
        const result = await exportPassport(input)
        if (input.workflow_id) {
          const workflow = itemById(input.workflow_id)
          if (!workflow || workflow.type !== 'workflow') return err(`工作流 "${input.workflow_id}" 不存在。`)
          const completedStages = (input.completed || []).map(step => step.stage)
          result.checkpoint_state = await initializeCheckpoints(result.run_id, workflow, completedStages)
        }
        return wrap(result, { source: 'material-passport', confidence: 'verified' })
      } catch (e) {
        return err(`导出失败：${e.message}`)
      }
    },
  },

  {
    name: 'research_run_import',
    description: 'Import a Material Passport to resume a multi-step research pipeline from a saved state.',
    inputSchema: {
      passport_yaml: z.string().describe('The YAML content of the Material Passport to import'),
    },
    async execute({ passport_yaml }) {
      try {
        const result = await importPassport(passport_yaml)
        return wrap(result, { source: 'material-passport', confidence: 'verified' })
      } catch (e) {
        return err(`导入失败：${e.message}`)
      }
    },
  },
]

export const runCheckpointTools = [
  {
    name: 'research_run_checkpoint_status',
    description: 'Get the checkpoint state for a research pipeline run.',
    inputSchema: {
      run_id: z.string().describe('Run ID from research_run_export'),
    },
    async execute({ run_id }) {
      const state = await getCheckpointState(run_id)
      return wrap(state, { source: 'checkpoint-manager', confidence: 'verified' })
    },
  },

  {
    name: 'research_run_checkpoint_approve',
    description: 'Approve a checkpoint to allow the agent to continue to the next stage.',
    inputSchema: {
      run_id: z.string().describe('Run ID'),
      stage: z.string().describe('Stage name to approve'),
      note: z.string().optional().describe('Optional note about the approval'),
    },
    async execute({ run_id, stage, note }) {
      try {
        const result = await recordApproval(run_id, stage, { approved_by: 'user', note })
        return wrap(result, { source: 'checkpoint-manager', confidence: 'verified' })
      } catch (e) {
        return err(e.message)
      }
    },
  },
]
