# 方法工坊与草稿增强器：嵌入设计

本文说明 Research Kit 如何把「方法工坊」（Method Workshop）与「研究草稿增强器」（Draft Enhancer）嵌入 DSH 会话界面，以及维护它们时必须遵守的约束。目标读者是需要改动这两块功能的贡献者。

这两块功能均已完整可用——本文是**设计说明与维护规范**，不是待执行的迁移计划。

> 方法工坊的界面组件是 vendored 工件（见 §3），草稿增强器是本仓库自有实现。

## 1. 这两个功能是什么

| 入口 | 位置 | 作用 |
| --- | --- | --- |
| 方法工坊 | `conversation.view` · 分区② | 方法卡库 + 变量填充 → 可编辑 Prompt；可从当前对话提取草稿、可写回输入框 |
| 草稿增强器 | `conversation.input.right`（order 80） | 把输入框草稿整理/增强：轻量档（零 Token）与语义档（复用当前会话模型、SSE 流式、五维诊断、可取消）；强度三档（低/中/高） |

两者共享同一套方法资产与视觉令牌（`--rk-*`），但职责不重叠，边界见 §6。

## 2. 现有装配总览

```text
conversation.view            dsh-research-kit-console   科研工作台（统一容器）
├── 分区① 资源与工作流      catalog + Prompt 组装 + 公开数据源直查
├── 分区② 方法工坊          Method Workshop（vendored 组件 + 宿主装配）
├── 分区③ 研究资产库        灵感资产 / 证据库管理
└── 分区④ 研究证据图谱      本会话资源 / 工作流 / 查询来源 / 资产 / 已保存证据的关系图
conversation.input.left      dsh-research-kit-launcher          资源 / 工作流程入口
conversation.input.overlay   dsh-research-kit-overlay           选择器与启动弹窗
conversation.input.right     dsh-research-kit-draft-enhancer    草稿增强器
```

| 文件 | 职责 |
| --- | --- |
| `vendor/promptkit-embed.js` | 方法工坊界面的自包含浏览器工件（SHA-256 锁定，勿手改） |
| `vendor/archify/template.html` + `i18n.mjs` | 组装回放弹窗与解释图共用的交互 viewer 工件（SHA-256 锁定，勿手改；见 §3） |
| `vendor/vendor-manifest.json` | 工件的来源 commit 与校验和清单 |
| `scripts/check-vendor.mjs` | 工件一致性校验（`npm run check` 首步） |
| `dsh/prompt-studio-glue.js` | 方法工坊的 DSH 宿主装配（provider 实例化 + `.rk-studio-host` 锚点） |
| `dsh/prompt-enhancer-glue.js` | 草稿增强器宿主装配 + 研究上下文桥 |
| `dsh/semantic-enhance.js` | 语义增强 Node half（非流式 + SSE 流式） |
| `dsh/slot-registry.js` | 全部 slot 注册的单一事实源（纯数据，供 glue 与测试共用） |
| `dsh/standalone-glue.js` | 所有 slot 注册的唯一入口 |
| `src/lib/enhance-output.js` | 模型输出协议（`[DIAG]` + `===PROMPT===`）解析，Node/浏览器共用 |
| `src/lib/vault-core.js` | 灵感资产纯逻辑（隐私边界、筛选） |
| `src/research-vault.js` | 研究资产库管理视图 |
| `scripts/build-client.mjs` | 把 vendored 工件与自有模块拼接为 `ui/client.js`（含工件内旧路径改写） |

## 3. vendored 工件：为什么要它、怎么维护

> **本仓库现有 3 个 vendored 工件**：`vendor/promptkit-embed.js`、`vendor/archify/template.html`、`vendor/archify/i18n.mjs`。清单与校验方式见 `vendor/vendor-manifest.json` 与 [NOTICE](../NOTICE)，三者由 `scripts/check-vendor.mjs` 统一校验。本节详述其中与方法工坊直接相关的 promptkit 工件；archify 两个工件服务于工作台的组装回放与解释图，锁定与升级规则完全相同。

方法工坊的界面来自另一个 MIT 项目 [dsh-promptkit](https://github.com/fsrmqi/dsh-promptkit)。本仓库不把它作为运行时依赖，而是**把构建好的自包含工件快照进 `vendor/`**，使安装 dsh-research-kit 的用户无需另外安装 dsh-promptkit。

理由有三：

1. **安装即用**——用户只装一个插件就拿到全部能力，不做运行时跨仓库解析；
2. **可审计**——工件有明确的来源 commit 与 SHA-256，`npm run check` 首步就会校验，篡改会直接失败；
3. **构建确定性**——工件内容固定，产物可复现。

维护纪律：

- **`vendor/` 下的文件不得手改。** 其 SHA-256 被 `scripts/check-vendor.mjs` 锁定，改动会导致 `npm run check` 失败；
- 更新工件必须同步更新 `vendor/vendor-manifest.json` 的 `sourceCommit` / `sha256` / `sizeBytes`；
- 工件内残留的旧插件路径由构建器在拼接时改写为本插件的路径，产物不应出现跨插件 fetch 路径。

> 若后续要把工件替换为可维护的源码子模块，应先确保替换后的模块在真实 DSH profile 上通过 [`MANUAL-QA.md`](MANUAL-QA.md) 的完整清单。

## 4. 命名空间纪律

vendored 工件与自有模块最终处于**同一个 JavaScript 工厂作用域**，因此每次新增模块都要检查顶层冲突：

| 维度 | 规则 |
| --- | --- |
| 顶层 `const` / `class` / `function` | 不得重名（构建器的 `ORDERED_SYMBOLS` 会断言定义顺序） |
| 事件名 | 一律 `dsh-research-kit.*` 前缀 |
| `localStorage` key | 一律 `dsh-research-kit.` 前缀（方法资产用 `dsh-research-kit.promptkit.`，避免与独立安装的 PromptKit 互相读写） |
| CSS 变量 | 工件用 `--pk-*`，本仓库用 `--rk-*`，允许并存但不得互相覆盖 |
| DSH slot id | 一律 `dsh-research-kit-*` |

## 5. 构建器集成规则

浏览器构建器是**受控拼接器**，不是通用 bundler。

### 拼接顺序

`vendor/promptkit-embed.js` 必须排在自有模块之前——后续 glue 通过 `PromptKit` 命名空间引用其组件与 provider。

```text
PromptKit embed
→ catalog / state / theme
→ UI 组件层
→ PromptStudio glue
→ standalone glue
```

### 新增源码模块必须登记两处

1. `scripts/build-client.mjs` 的 `files` 白名单（拼接顺序即符号可见顺序，模块间没有 `import`）；
2. `package.json` 的 `check` 脚本（逐文件 `node --check`）。

**漏登记 `files` 不会有任何构建报错**，`node --check ui/client.js` 也查不出——产物只是少了一段代码，直到打开对应界面才 `ReferenceError`。同时在 `ORDERED_SYMBOLS` 补一条顺序断言，把「顺序错位」提前成构建期错误。

### 任何改动后必须运行

```bash
npm run build && npm run check && npm test && node --check ui/client.js
git diff --check
```

## 6. 两个入口的职责边界

方法工坊与草稿增强器都属于「构造侧」，但**输入与输出不同**，不要互相吞并：

| 维度 | 方法工坊 | 草稿增强器 |
| --- | --- | --- |
| 起点 | 方法卡（结构化模板） | 输入框里已有的草稿 |
| 是否读当前对话 | 可以（「从对话提取」起稿） | 以草稿为准，附只读研究上下文摘要 |
| 输出 | 可编辑的完整 Prompt，可写回输入框 | 改写后的草稿，可撤销、可对比原稿 |
| 是否用模型 | 不用（纯模板组装） | 语义档使用当前会话模型 |
| 归属数据 | 方法卡与工坊资产 | 无（不落盘） |

方法工坊**不**接入项目记忆检索与跨会话最近材料——那是草稿增强器与（未来的）Memory Center 的职责。两处都读同一批资产会让同样的输入得到两个不同输出，这是刻意避免的。

## 7. Node half：两条受控路由

根 `index.js` 是唯一的 Node half，统一注入：

```js
export const inject = ['webServer', 'web', 'llm', 'sessions']
```

| 路径 | 用途 |
| --- | --- |
| `/dsh-research-kit/query` | 公开数据源直查（带缓存与速率预算）与 Agent 回退任务生成 |
| `/dsh-research-kit/semantic-enhance` | 非流式研究草稿增强 |
| `/dsh-research-kit/semantic-enhance/stream` | 流式增强与诊断（SSE：open / stage / delta / done / error） |

约束：

- 会话模型路由在 `agent/created` 记录 `sessionId → provider/model`，在 `agent/disposed` 删除；**只存标识，不存 Key**；
- 插件晚于会话启动或热重载时 `agent/created` 不会再触发，因此缓存未命中时向 `ctx.sessions` 反查一次并缓存；探测失败安全退化为 503 + 可读错误，不崩溃；
- 研究上下文经请求体 `researchContext` 传入，服务端做 4000 字符长度约束，仅作改写参照，不落盘、不授权；
- 研究化 system 指令强制：不编造引用 / DOI / 数据集 / 页码 / 临床结论、保持草稿研究范围、受限数据保密、结论标注待人工核验。

## 8. 资产与隐私边界

| 资产类型 | 保存内容 | 边界 |
| --- | --- | --- |
| 方法 | 用户私有 Markdown 方法卡 | 仅本地浏览器 |
| 灵感资产 | 可复用 Prompt、研究问题、待验证假设 | 不保存原始附件、患者数据、完整查询结果（正文超 8000 字符拒绝保存） |
| 会话资源选择 | 当前会话的数据库 / 技能 | 仅页面内存，按 `sessionId` 隔离 |
| 工作流历史 | 工作流 ID、名称、时间、Prompt 首行摘要 | 不保存完整 Prompt、参数或文件内容 |

> Memory Center 接入若要做，必须经过：检索 → 来源与摘要预览 → 用户选择 → 组装 Prompt。**禁止静默注入。**

## 9. 测试与验收

单元测试覆盖（见 `test/`）：

- 方法 provider、私有方法与资产使用本仓库的 storagePrefix；
- 工作流 Prompt、方法 Prompt、资源 Prompt 的组合顺序；
- 语义增强输出协议、诊断解析、取消与超时；
- 公开数据源 API 的正常 / 空结果 / 429 / 401-403 / 超时 / Agent 回退；
- 会话资源选择在同 session 共享、跨 session 隔离；
- slot 注册包含一个统一视图（内部四分区）、左右输入槽位与 overlay。

真实 profile 手工验收见 [`MANUAL-QA.md`](MANUAL-QA.md)。其中与本文相关的必测项：

1. 方法工坊能显式发送 Prompt 到当前会话，且不影响其他 session；
2. 从输入框写入草稿 → 点增强 → 流式预览出现；
3. 勾选数据库与技能后启动工作流，最终 Prompt 含边界声明、不含密钥；
4. 没有相邻的 dsh-promptkit 源目录时，方法工坊仍能打开；
5. 本地存储中不含 Prompt 正文、文件内容、查询敏感参数或凭据。

## 10. 已知风险

- 构建产物 `ui/client.js` 现为 **2.3 MB**（2,396,255 B），其中 vendored 工件约占 1.36 MB：promptkit 工件 637 KiB + archify 模板 756 KiB（后者整段作为字符串注入，供浏览器侧组装解释图 HTML）。引入新功能前先比较加载体积与 DSH 首屏时间。
- 工件的全局 CSS 与 `--pk-*` 变量可能与宿主或本仓库的 `--rk-*` 相互影响，改动视觉层时需在真实宿主复核。
- 两个入口可能同时监听键盘、外部点击与 `storage` 事件；所有新事件必须命名空间化。
- DSH 的 slot props 与模型路由随版本变化，真实 profile 验证不可省略。

## 11. 尚未实现

1. **发送前自动增强**：需要宿主下发「发送当前草稿」钩子，当前 DSH 槽位契约未提供；
2. **Memory Center 项目记忆检索**：上下文桥已预留接口，检索路由尚未接入；
3. **诊断结果自动暂存**：诊断目前只在会话内展示，用户可在灵感库手动存为待验证假设卡。
