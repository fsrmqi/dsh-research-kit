# 贡献指南

感谢你考虑为 dsh-research-kit 贡献代码、工作流或数据源条目。

本文件说明**怎么参与**；设计原理见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，验收方式见 [docs/MANUAL-QA.md](docs/MANUAL-QA.md)。

## 环境准备

| 需要 | 说明 |
| --- | --- |
| Node.js `>= 22.6` | 本仓库无运行时依赖，不需要 `npm install` |
| DSH | 若要验证界面行为，需要一个可运行的 DSH Web profile；见 [DSH 仓库](https://github.com/deepseek-ai/deepseek-harness) |
| `pnpm` | 仅在执行 `dsh plugin` 时需要；其 store 布局主版本必须与目标 profile 记录一致（见 [常见坑](#常见坑)） |

```bash
git clone https://github.com/fsrmqi/dsh-research-kit.git
cd dsh-research-kit
npm run build   # 生成 ui/client.js（构建产物，提交到仓库，勿手改）
npm run check   # 目录契约校验 + 语法检查
npm test        # 纯逻辑与契约回归测试
```

改动 `catalog/`、`src/`、`dsh/` 或 `scripts/build-client.mjs` 后，统一执行：

```bash
npm run build && npm run check && npm test && node --check ui/client.js
```

**CI 会校验「重新构建后产物无 diff」**——提交前忘了 `npm run build` 会直接挂 CI。

## 提交 Pull Request

1. Fork 并新建分支，分支名建议 `feat/…`、`fix/…`、`docs/…`；
2. 按上一节跑完四项命令（构建 + 校验 + 测试 + 产物语法）；
3. 在 PR 描述中填清楚：**改了什么、为什么、怎么验证**；
4. 涉及 DSH 槽位适配的改动，请写明**目标 DSH 版本**与验证方式（附截图或最小日志更佳）；
5. 保持 PR 聚焦——一个 PR 只做一件事，便于评审。

评审预期：维护者会检查契约校验是否覆盖了新改动、文档是否同步、是否引入了未说明的网络请求或遥测。若你的改动与现有设计取舍冲突，欢迎先在 Issue 里讨论，不必先写完整实现。

提交信息建议使用 `feat: …` / `fix: …` / `docs: …` / `chore: …` 前缀。

**贡献许可**：向本仓库提交内容即表示你同意以本项目使用的 [MIT 许可证](LICENSE) 授权该贡献。请勿提交你无权授权的第三方代码或 Prompt 文本。

## 新增工作流

工作流是**发给当前 Agent 的执行指令**，不是功能宣传文案。新增前请先阅读[架构文档 §5 的 Prompt 作者规范](docs/ARCHITECTURE.md)，然后：

1. 在 `catalog/workflows.json` 中按现有条目的字段结构新增 JSON 对象；
2. `id` 使用小写 kebab-case，发布后不复用、不改名；
3. Prompt 中的每个 `{placeholder}` 必须在 `placeholders` 中声明，反之亦然；
4. Prompt 必须包含防编造 / 待核验边界（校验器和测试会强制检查）；
5. 需要用户材料时设置 `requiresFiles: true`，并提示使用 DSH 原生 `@文件`；
6. `suggestedSkillIds` 只引用已存在的技能 ID；
7. 运行 `npm run check && npm test`，全部通过后再提交。

每条工作流至少做一次人工走查：确认模型不会被 Prompt 引导为虚构事实、过度承诺或遗漏不确定性。

## 新增技能

技能是可组合的指导模块，不是可执行代码。除公共字段外需要：

- `promptFragment`：一段纪律性指导（≥10 字符），启动工作流勾选后并入 Prompt；
- `checklist`：面向用户的人工检查清单（≥3 条）；
- `availability`：当前只允许保守值 `prompt-guidance`；`requires-host-capability` 会失去附加能力。

## 新增数据源

数据源条目本身只是**说明与接入前提**，不是已接通的能力：

1. 在 `catalog/databases.json` 中新增条目，字段结构见[架构文档 §4.3](docs/ARCHITECTURE.md)；
2. `availability` 使用保守值：`reference-only` 或 `requires-mcp`；
3. **只有实现了对宿主能力的真实探测并覆盖自动化测试后，才允许标记 `available-in-host`**；
4. `accessNote` 必须如实写出检索前提（是否需要订阅、API Key、机构授权、数据使用协议），不得暗示已经可用；
5. 若该来源的 API 是公开且无凭据的，可以同步在 `dsh/database-query.js` 增加适配器——此时需要补测试，覆盖正常、空结果、429、401/403、超时与 Agent 回退路径。

## 常见坑

| 现象 | 原因与处理 |
| --- | --- |
| `dsh plugin …` 报 `ERR_PNPM_UNEXPECTED_STORE` | PATH 上的 `pnpm` 与目标 profile 的 store 布局主版本不一致。对照 `node_modules/.modules.yaml` 的 `storeDir` 与 `pnpm store path`，改用一致的主版本 |
| 打开界面才 `ReferenceError`，构建却无报错 | 新模块漏登记 `scripts/build-client.mjs` 的 `files` 白名单。产物只是少了一段代码，`node --check` 查不出来 |
| CI 报构建产物与源码不同步 | 忘了 `npm run build`，或手改了 `ui/client.js` |
| `npm run check` 报工件 SHA 不匹配 | `vendor/` 下的文件被改动了。工件是 SHA 锁定快照，**不得手改**；更新需同步 `vendor/vendor-manifest.json` |
| 测试通过但界面真的坏 | 自动化测试全部是纯逻辑断言与源码/产物文本断言，无法覆盖渲染层。请按 [MANUAL-QA.md](docs/MANUAL-QA.md) 在真实 profile 复核 |

## 报告问题

提交 Issue 时请附以下三件套，缺任一项都难以定位：

1. **DSH 版本**（`dsh --version`）与插件版本 / commit；
2. **安装方式**（本地目录 / GitHub 钉 commit / tarball）；
3. **复现步骤**与预期 / 实际行为。

涉及宿主契约的问题（视图不出现、写入草稿变成直接发送、发送失败等）请务必写明 DSH 版本——`conversation.view` 槽位与 `inputActions` 契约随 DSH 版本变化，同类症状在不同版本上根因不同。

界面相关问题请附浏览器控制台的首个错误栈。[MANUAL-QA.md §4](docs/MANUAL-QA.md) 的失败定位树可能已经覆盖你的症状。

安全相关问题**不要**开公开 Issue，请按 [SECURITY.md](SECURITY.md) 的渠道上报。
