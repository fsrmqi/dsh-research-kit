# MCP Server 跨平台配置指南

本文说明如何将 `dsh-research-kit` 的 MCP Server 接入 Codex、Claude Code、Zed 与 DSH 四种宿主。接入后，Agent 可以直接调用 21 个科研 Tool（文献检索、引用验证、证据管理、图表生成、写作质量检查、AI 披露生成等），不需要通过 UI 手动操作。

## 前置条件

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 22.6 | 运行 MCP Server |
| npm | >= 10 | 安装依赖 |
| LaTeX（可选） | texlive / MacTeX | 生成图表脚本中的 `text.usetex` |

## 启动方式

MCP Server 支持三种启动方式，选择一种即可：

### 方式 A：npx（推荐，零安装）

```bash
npx dsh-research-kit-mcp
```

### 方式 B：全局安装

```bash
npm install -g dsh-research-kit
dsh-research-kit-mcp
```

### 方式 C：本地克隆

```bash
git clone https://github.com/fsrmqi/dsh-research-kit.git
cd dsh-research-kit
npm install
node mcp/server.js
```

以下配置示例以方式 A（npx）为准。如果用方式 B 或 C，把 `command` 换成对应启动命令。

---

## Codex

### Codex CLI

编辑 `~/.codex/config.toml`，添加：

```toml
[mcp_servers.dsh-research-kit]
command = "npx"
args = ["-y", "dsh-research-kit-mcp"]
```

如果用本地克隆：

```toml
[mcp_servers.dsh-research-kit]
command = "node"
args = ["/absolute/path/to/dsh-research-kit/mcp/server.js"]
```

### Codex Desktop

1. 打开 Codex Desktop -> Settings -> MCP Servers
2. 点击 Add Server
3. Name: `dsh-research-kit`
4. Command: `npx`
5. Args: `-y dsh-research-kit-mcp`
6. 保存并重启会话

### 验证

在 Codex 会话中输入：列出所有可用的 MCP 工具。Agent 应列出 21 个 dsh-research-kit 的 Tool。

---

## Claude Code

### 项目级配置

在项目根目录创建 `.mcp.json`：

```json
{
  "mcpServers": {
    "dsh-research-kit": {
      "command": "npx",
      "args": ["-y", "dsh-research-kit-mcp"]
    }
  }
}
```

### 全局配置

编辑 `~/.claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "dsh-research-kit": {
      "command": "npx",
      "args": ["-y", "dsh-research-kit-mcp"]
    }
  }
}
```

### 验证

在 Claude Code 中运行 `/mcp`，应看到 dsh-research-kit 状态为 connected。然后输入搜索审阅论文相关的工作流，Agent 应调用 research_catalog_search 并返回结果。

---

## Zed

在项目根目录创建 `.zed/settings.json`（或编辑全局 `~/.config/zed/settings.json`）：

```json
{
  "context_servers": {
    "dsh-research-kit": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "dsh-research-kit-mcp"]
    }
  }
}
```

保存后 Zed 会自动启动 MCP Server 进程。在 Assistant Panel 中可以查看已连接的 Tool。

### 验证

打开 Assistant Panel，输入：请验证 DOI 10.1038/s41586-020-2649-2 是否存在。Agent 应调用 research_citation_verify 并返回论文元数据。

---

## DSH（DeepSeek Harness）

dsh-research-kit 本身就是 DSH 插件。MCP Server 可以在 DSH 内以两种方式运行：

### 方式 1：DSH 插件内置（自动）

插件安装后，MCP Server 随 DSH 宿主自动可用。Agent 在当前会话中可以直接调用 MCP 工具，无需额外配置。

确认方式：在 DSH 会话中让 Agent 列出当前可用的 MCP 工具。如果看到 `mcp__dsh-research-kit__search_workflows` 等条目，说明已自动接入。

### 方式 2：独立进程（与 UI 并行）

如果 DSH 插件未安装（或你想在其他终端单独使用），在 DSH 的 MCP 配置中添加：

```json
{
  "mcpServers": {
    "dsh-research-kit": {
      "command": "npx",
      "args": ["-y", "dsh-research-kit-mcp"]
    }
  }
}
```

### UI + Agent 并行

DSH 的独特优势是 UI 和 MCP 同时可用：

- **UI 四分区**：人手动选工作流、拼 Prompt、发送，Agent 执行 prompt。
- **MCP Tool**：Agent 自主调用 research_catalog_search -> research_workflow_compose -> research_source_query，拿到结构化数据后自主推理。
- **Agent 活动面板**：人查看 Agent 的调用轨迹，在 checkpoint 处确认。

两种方式共享同一个 `catalog/` 目录和同一个证据存储（文件系统为真源，IndexedDB 为 UI 缓存）。

---

## 通用验证

无论哪个宿主，用以下流程验证 MCP Server 工作正常：

```text
1. 让 Agent 调用 research_catalog_search（query="审阅论文"）
   -> 应返回 review-paper 工作流条目

2. 让 Agent 调用 research_citation_verify（identifier="10.1038/s41586-020-2649-2"）
   -> 应返回 exists=true, title="Array programming with NumPy"

3. 让 Agent 调用 research_evidence_save（identifier_type="doi", identifier="10.1038/test", title="Test"）
   -> 应返回 saved=true

4. 让 Agent 调用 research_evidence_list
   -> 应包含刚才保存的条目
```

四步全部通过说明 MCP Server 与当前宿主的集成正常。

---

## Tool 清单速查

命名统一为 `research_<领域>_<动作>`：`catalog`（目录）、`workflow`（编排）、`source` / `metadata`（外部信息）、`evidence`（证据）、`run`（运行状态）、`review`（审阅）、`figure`（图表）、`disclosure`（披露）。日常审阅优先调用 `research_review_output`；需要深挖单一问题时，再调用对应的细粒度 `research_review_*` 工具。

不知道该调用什么时，先使用 `research_help`。它按自然语言目标返回推荐工具和最短调用链，本身不执行检索、写入或审批。

| Tool | 功能 |
|------|------|
| `research_help` | MCP 工具导航：按目标推荐工具与最短调用链，不执行任何动作 |
| `research_catalog_search` | 搜索 317 条工作流目录 |
| `research_workflow_compose` | 填参数生成 Prompt |
| `research_source_query` | 直查 Crossref / OpenAlex / Semantic Scholar 等 6 个数据源 |
| `research_literature_search` | 默认文献检索入口：多源检索、去重、可选核验与显式证据保存 |
| `research_citation_verify` | 验证 DOI / PMID / arXiv 是否存在 + claim 支持 |
| `research_evidence_save` | 保存证据条目（元数据，不存全文） |
| `research_evidence_list` | 检索已保存证据 |
| `research_evidence_grade` | 实证 / 推论 / 缺失三级分级 |
| `research_evidence_review` | 默认证据盘点入口：只读汇总、建议分级与可追溯性风险识别 |
| `research_evidence_link` | 证据与资产互链 |
| `research_run_start` | 默认启动入口：创建研究运行、状态护照与人工检查点 |
| `research_run_export` | 导出跨会话状态快照 |
| `research_run_import` | 导入状态快照恢复执行 |
| `research_figure_generate` | 按论文风格生成 matplotlib 脚本 |
| `research_figure_list_styles` | 列出 8 个可用图表风格 |
| `research_run_checkpoint_status` | 查看管道检查点状态 |
| `research_run_checkpoint_approve` | 审批检查点继续执行 |
| `research_review_output` | 默认审阅入口：聚合声明引用、异常、写作与限制语检查 |
| `research_review_claims` | 文本级 claim-source 对齐审计 |
| `research_literature_link` | 发现证据间互引关系 |
| `research_review_anomalies` | 检测冗余模式、矛盾表述与缺失要素 |
| `research_review_writing` | 学术写作质量检查（模糊术语、废话开头、标点、句长） |
| `research_disclosure_generate` | 按期刊 AI 政策生成合规的 AI 使用披露声明（支持 15 个期刊） |
| `research_disclosure_list_policies` | 列出支持的期刊 AI 披露政策 |
| `research_review_hedging` | 检测保护性模糊限制语（不可静默删除） |
| `research_metadata_openalex_fetch` | 通过 DOI 或检索词获取 OpenAlex 完整元数据 |

---

## 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| Agent 说没有可用工具 | MCP Server 未启动或连接失败 | 检查配置文件格式；运行 `node mcp/server.js` 确认入口存在 |
| Cannot find module | 路径错误或依赖未安装 | 确保用绝对路径；`npm install` 已执行 |
| research_citation_verify 超时 | Crossref API 网络不通 | 检查网络；SDK 默认 15 秒超时 |
| 图表脚本中 LaTeX 报错 | 未安装 texlive | 安装 texlive 或将 `text.usetex` 改为 `false` |
| 证据存储路径不对 | `os.homedir()` 返回异常目录 | 检查 `$HOME` 环境变量 |
