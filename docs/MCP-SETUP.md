# MCP Server 跨平台配置指南

本文说明如何将 `dsh-research-kit` 的 MCP Server 接入 Codex、Claude Code、Zed 与 DSH 四种宿主。接入后，Agent 可以直接调用 17 个科研 Tool（文献检索、引用验证、证据管理、图表生成等），不需要通过 UI 手动操作。

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

在 Codex 会话中输入：列出所有可用的 MCP 工具。Agent 应列出 17 个 dsh-research-kit 的 Tool。

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

在 Claude Code 中运行 `/mcp`，应看到 dsh-research-kit 状态为 connected。然后输入搜索审阅论文相关的工作流，Agent 应调用 search_workflows 并返回结果。

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

打开 Assistant Panel，输入：请验证 DOI 10.1038/s41586-020-2649-2 是否存在。Agent 应调用 verify_citation 并返回论文元数据。

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
- **MCP Tool**：Agent 自主调用 search_workflows -> compose_workflow -> query_source，拿到结构化数据后自主推理。
- **Agent 活动面板**：人查看 Agent 的调用轨迹，在 checkpoint 处确认。

两种方式共享同一个 `catalog/` 目录和同一个证据存储（文件系统为真源，IndexedDB 为 UI 缓存）。

---

## 通用验证

无论哪个宿主，用以下流程验证 MCP Server 工作正常：

```text
1. 让 Agent 调用 search_workflows（query="审阅论文"）
   -> 应返回 review-paper 工作流条目

2. 让 Agent 调用 verify_citation（identifier="10.1038/s41586-020-2649-2"）
   -> 应返回 exists=true, title="Array programming with NumPy"

3. 让 Agent 调用 save_evidence（identifier_type="doi", identifier="10.1038/test", title="Test"）
   -> 应返回 saved=true

4. 让 Agent 调用 list_evidence
   -> 应包含刚才保存的条目
```

四步全部通过说明 MCP Server 与当前宿主的集成正常。

---

## Tool 清单速查

| Tool | 功能 |
|------|------|
| `search_workflows` | 搜索 317 条工作流目录 |
| `compose_workflow` | 填参数生成 Prompt |
| `query_source` | 直查 Crossref / OpenAlex / Semantic Scholar 等 6 个数据源 |
| `verify_citation` | 验证 DOI / PMID / arXiv 是否存在 + claim 支持 |
| `save_evidence` | 保存证据条目（元数据，不存全文） |
| `list_evidence` | 检索已保存证据 |
| `grade_evidence` | 实证 / 推论 / 缺失三级分级 |
| `link_evidence` | 证据与资产互链 |
| `export_passport` | 导出跨会话状态快照 |
| `import_passport` | 导入状态快照恢复执行 |
| `generate_figure` | 按论文风格生成 matplotlib 脚本 |
| `list_figure_styles` | 列出 8 个可用图表风格 |
| `checkpoint_status` | 查看管道检查点状态 |
| `approve_checkpoint` | 审批检查点继续执行 |
| `claim_audit` | 文本级 claim-source 对齐审计 |
| `link_literature` | 发现证据间互引关系 |
| `anomaly_detect` | 检测冗余模式、矛盾表述与缺失要素 |

---

## 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| Agent 说没有可用工具 | MCP Server 未启动或连接失败 | 检查配置文件格式；运行 `node mcp/server.js` 确认入口存在 |
| Cannot find module | 路径错误或依赖未安装 | 确保用绝对路径；`npm install` 已执行 |
| verify_citation 超时 | Crossref API 网络不通 | 检查网络；SDK 默认 15 秒超时 |
| 图表脚本中 LaTeX 报错 | 未安装 texlive | 安装 texlive 或将 `text.usetex` 改为 `false` |
| 证据存储路径不对 | `os.homedir()` 返回异常目录 | 检查 `$HOME` 环境变量 |
