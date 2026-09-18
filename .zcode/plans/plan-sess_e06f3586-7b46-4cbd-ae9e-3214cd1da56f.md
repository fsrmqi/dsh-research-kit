# P0：工具元数据注册表 + research_run_status

## 现状要点（探索结论）

- 27 个工具定义在 `mcp/tools/index.js`（zod schema，统一 `wrap()` 返回 `data + meta`）；同一文件里维护 `DISCOVERY_ROUTES` 帮助路由。
- 中文工具名在 `src/agent-activity.js:9`（`TOOL_LABELS`/`ARTIFACT_LABELS`），产物映射在 `mcp/execution/call-logger.js:15`（`ARTIFACT_KINDS`），文档表格手工维护在 `docs/MCP-SETUP.md:205`（开头残留「21 个」）——四处独立漂移。
- run 状态散落三处：`~/.dsh-research-kit/passports/<run_id>.yaml`、`checkpoints/<run_id>.json`、`logs/calls.jsonl`；无统一查询工具。mcp 侧 `readCallLogs` 无 runId 过滤（dsh 侧有，可照抄）；passport 顶层不含 workflow_id（只在 pending 步骤里）；证据盘点 summary 是 `research_evidence_review` 内即时计算，可抽成共享函数。
- `test/mcp-smoke.test.mjs` 硬编码 `tools.length === 27`，并提供了 StdioClientTransport + HOME 沙箱的现成 E2E 模式。

## 一、新建 `mcp/tool-registry.js`（纯数据、浏览器安全）

单一事实源，每个工具一条：

```js
{
  name: 'research_literature_search',
  category: 'literature',            // catalog|workflow|source|metadata|evidence|run|review|figure|disclosure|navigation
  tier: 'entry',                     // 'entry' 聚合入口 | 'fine' 细粒度
  access: 'read-only',               // 'read-only' | 'writes' | 'external'（外呼 API）
  requiresConfirmation: false,       // 写入/审批类为 true（checkpoint_approve、evidence_save、run_export…）
  helpRoute: 'literature',           // research_help 的 route id；research_help 自身为 null
  labelZh: '综合文献检索',            // UI 活动面板 + 文档
  summaryZh: '默认文献检索入口：多源检索、去重、可选核验与显式证据保存',
  artifactKind: '',                  // 仅 6 个产物类工具非空，值同现 ARTIFACT_KINDS
}
```

27 条数据 + 少量派生 helper（`toolMeta(name)`、`toolLabel(name)`、`artifactKindOf(tool)`、`entryTools()`）。

## 二、消费方接线（删重复，不引入第二份）

1. **`mcp/execution/call-logger.js`**：`ARTIFACT_KINDS` 改为从 registry 导入生成（或直接调 `artifactKindOf`），删本地表。
2. **`src/agent-activity.js`**：`TOOL_LABELS`/`ARTIFACT_LABELS` 删除，改为 import registry 的 `toolLabel()` 与产物标签 helper（产物中文标签 `figure:'图表脚本'` 等也进 registry：`ARTIFACT_KIND_LABELS`）。注意 `scripts/build-client.mjs` 的 `files` 列表需加入 `mcp/tool-registry.js`（排在 `src/agent-activity.js` 之前），`ui/client.js` 随构建再生。
3. **`mcp/tools/index.js` 的 `DISCOVERY_ROUTES`**：路由的 id/label/keywords/chain（带推荐理由的叙述性内容）保留在 index.js，但 chain 中引用的工具名与 registry 做 1:1 校验（见测试）。
4. **`docs/MCP-SETUP.md`**：新建 `scripts/sync-tool-docs.mjs`——从 registry 生成「Tool 清单速查」表格，写入 `<!-- tool-table:start -->` / `<!-- tool-table:end -->` 标记之间；`--check` 模式校验漂移并挂进 `npm run check`；同时把开头「21 个科研 Tool」改为按 registry 计数生成的一句话（或至少修正为 28）。

## 三、新增 `research_run_status`（第 28 个工具，只读）

支撑性小改动先行：

- `mcp/execution/call-logger.js` 的 `readCallLogs` 增加 `runId` 过滤参数（照抄 `dsh/agent-activity.js:55` 的做法）。
- `mcp/state/material-passport.js`：`exportPassport`/`toYaml`/`fromYaml` 支持顶层可选 `workflow_id`（自写解析器已能解析未知顶层 `\w+:` 键，天然向后兼容旧护照）；新增 `loadPassport(runId)` 读取单个护照文件。
- 证据盘点 summary（total/stored_grades/suggested_grades/missing_traceability/unverified）从 `research_evidence_review` 的 execute 中抽成 `mcp/execution/evidence-inventory.js` 的共享函数，review 与 status 共用。

工具本体（加在 `research_run_start` 附近，`research_run_export` 之前）：

- 参数：`run_id`（可选，合法 run_id 正则同现有）、`project`（可选，默认从护照取或 'default'）、`limit`（证据盘点条数上限，默认 100）。
- 无 `run_id`：扫 passports + checkpoints 目录（mtime 排序，复用 `dsh/agent-activity.js` 的 readCheckpoints 思路，下沉为 `mcp/state/run-overview.js` 里的共享函数），返回最近 runs 摘要列表（run_id、project、current_stage、pending checkpoint 数、更新时间），并提示带 run_id 重查。
- 有 `run_id`：聚合返回
  ```
  run_id, project, current_stage, workflow: {id?, name?},
  status: 'waiting_review' | 'active',      // 由 pending checkpoints 推导
  checkpoints: { pending: [...], approved: [...] },
  evidence: { total, stored_grades, suggested_grades, missing_traceability, unverified },
  artifacts: [ { kind, tool, summary, at } ],   // 最近 ≤10 条 ok && artifact_kind 的日志投影
  next_actions: [...]                        // 派生：待审批→提示人工审批；missing→补来源；unverified→人工核验；无证据→建议检索；否则→建议审阅/交接
  ```
- 语义约束：工具严格只读，`meta.disclaimer` 声明"状态汇总不代表研究步骤已被执行/核验"。
- 联动更新：`research_run_start` 的 `recommended_tools` 加入 `research_run_status` 并改用 `next_actions` 命名（与 evidence_review 对齐）；`DISCOVERY_ROUTES` 的 `resume` 路由链首步插入 `research_run_status`（"先看运行总览，再决定恢复/审批"）。

## 四、测试

1. **新 `test/research-pipeline-e2e.test.mjs`**：照抄 `mcp-smoke.test.mjs` 的 StdioClientTransport + mkdtemp HOME 沙箱模式，串联：
   `research_run_start`（带 workflow_id）→ `research_run_status`（验证阶段/checkpoint/空证据状态）→ `research_literature_search`（传不可配置 source 走确定性降级路径，不依赖公网）→ `research_evidence_save` → `research_evidence_review`（验证 summary 与 next_actions）→ `research_review_output`（审阅样例文本）→ `research_run_export`（交接）→ `research_run_status`（验证 artifacts 投影出现）。断言统一 `data + meta` 契约与 next_actions 非空。
2. **新 `test/tool-registry.test.js`**：registry 名称与 `tools` 数组 1:1（28 个，不多不少）；`DISCOVERY_ROUTES` 每条 chain 的工具都存在于 registry 且 helpRoute 吻合；`call-logger` 的产物映射与 registry 一致；`src/agent-activity.js` 无本地 TOOL_LABELS 残留（源码正则，参照 `test/research-console.test.js` 的接线断言写法）。
3. **更新 `test/mcp-smoke.test.mjs`**：`tools.length` 断言 27 → 28，并加一条 `research_run_status` 的 smoke 调用。
4. 跑 `npm test`（含 build）与 `npm run check`。

## 五、GitNexus 流程（AGENTS.md 要求）

- 编辑前对将被改动的符号（`readCallLogs`、`exportPassport`、`research_evidence_review` 的 execute 等）跑 `node .gitnexus/run.cjs impact <symbol> --direction upstream --repo .`，报告风险；HIGH/CRITICAL 则先回报再动手。
- 提交前跑 `node .gitnexus/run.cjs detect-changes --scope all --repo .`，`partial/truncated` 不视为通过。

## 明确不做（与你的约束一致）

- 不做自动执行链的超级工具；`research_run_status` 纯只读。
- 不删任何细粒度工具；registry 的 `tier` 字段只是标注入口层级。
- 不在本轮动 UI 面板的呈现逻辑（P1）；本轮只让 UI 标签开始从 registry 取数，消除双份维护。

## 不确定处的默认选择（可改）

- 文档采用「标记间自动生成 + check 校验」而非纯手工校验——脚本写好后文档永不再漂移。
- run 列表来源用 passports ∪ checkpoints 目录（UI localStorage 的 run 与 MCP 侧隔离，本轮不打通）。
- passport 增加 `workflow_id` 顶层字段属于向后兼容的加列，不改旧文件。