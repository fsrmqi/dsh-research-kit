# 文档索引

本项目按「读者是谁、要回答什么问题」分层组织文档。先读与你的目标对应的那一行。

## 按目标找文档

| 我想… | 读这份 |
| --- | --- |
| 知道这个插件是什么、值不值得装 | [../README.md](../README.md) · [English](../README.en.md) |
| 装起来并跑通一次任务 | [../README.md](../README.md) 的「安装」「使用」两节 |
| 知道它**不**做什么、边界在哪 | [PRODUCT.md](PRODUCT.md) |
| 改代码：加工作流 / 技能 / 数据源 | [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| 搭本地开发环境、跑测试 | [DEVELOPMENT.md](DEVELOPMENT.md) |
| 搞懂模块职责、数据流、目录 schema | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 改方法工坊或草稿增强器 | [METHOD-WORKSHOP.md](METHOD-WORKSHOP.md) |
| 做或校验研究结果解释图（diagram IR） | [ARCHITECTURE.md](ARCHITECTURE.md) §7 · `scripts/render-diagrams.mjs` · `scripts/validate-diagrams.mjs` |
| 确认改动没把界面改坏 | [MANUAL-QA.md](MANUAL-QA.md) |
| 知道第三方归属与许可 | [../NOTICE](../NOTICE) |
| 知道接下来打算做什么 | [../ROADMAP.md](../ROADMAP.md) |
| 上报安全漏洞 | [../SECURITY.md](../SECURITY.md) |

## 文档分层

| 层 | 回答什么问题 | 文档 | 语言 |
| --- | --- | --- | --- |
| 门面 | 这是什么？要不要用？ | [README.md](../README.md) · [README.en.md](../README.en.md) | 中 / 英 |
| 使用 | 怎么用？边界在哪？ | README 使用流程 · [PRODUCT.md](PRODUCT.md) | 中文 |
| 贡献 | 我能改什么？怎么改？ | [CONTRIBUTING.md](../CONTRIBUTING.md) · [DEVELOPMENT.md](DEVELOPMENT.md) | 中文 |
| 原理 | 为什么这样设计？ | [ARCHITECTURE.md](ARCHITECTURE.md) · [METHOD-WORKSHOP.md](METHOD-WORKSHOP.md) | 中文 |
| 验证 | 我怎么确认它是好的？ | [MANUAL-QA.md](MANUAL-QA.md) | 中文 |
| 出处 | 改了什么？接下来做什么？ | [CHANGELOG.md](../CHANGELOG.md) · [ROADMAP.md](../ROADMAP.md) | 中文 |

## 语言说明

**深入文档目前只有中文。** 门面（README）与贡献入口提供英文版，但架构、开发、验收、原理类文档不维护双语——两份会各自漂移，反而不如诚实声明单一语言。

如果你需要某份英文文档，请开 Issue 说明用途，比维护一份自动翻译更有价值。

## 配图

对外展示用的架构图放在 `assets/`，全部是手写 SVG，随仓库分发、不经过构建：

| 文件 | 内容 | 引用处 |
| --- | --- | --- |
| `architecture.svg` | 全局架构：宿主 / 插件 / 两条受控路由 / 外部通道 | README（中英）、ARCHITECTURE §1.1 |
| `research-loop.svg` | 科研闭环四分区 | README（中英）、PRODUCT §3 |
| `prompt-pipeline.svg` | Prompt 组装五步链路 | ARCHITECTURE §3 |
| `data-source-paths.svg` | 数据源双路径（插件直查 vs Agent 回退） | PRODUCT §2、ARCHITECTURE §3.0a |
| `responsibility-boundary.svg` | 三方责任边界（插件 / DSH / 研究者） | PRODUCT §7 |

改图时的三条要求：**①** 保持手写 SVG，不引入构建步骤——`ui/client.js` 之外的产物越多，维护面越大；**②** 图里不写会随内容增长的统计数字（条目数、数据源数、直查来源数），一律改用无数量的措辞——图是随仓库分发的静态文件，写死数字后每加一条资源就要回来改图，实际已因此漂移（`architecture.svg` 曾停在 128 项，而当时真实值已是 441 项）。**设计与结构性数字不受此限**（四个分区、五个步骤、两条受控路由），它们描述的是设计不变量，不随目录增长而变；统计数字只写在能被校验的文本文档里（README / PRODUCT / ARCHITECTURE），且必须与实测一致；**③** 改完在真实浏览器里渲染核对一遍排版，确认无文字溢出、无元素重叠——手写坐标最容易在这里出错。

> 别把本节与**交互解释图**混为一谈：本节说的是随仓库分发的**静态**展示图（手写 SVG）。交互解释图是运行期产出物——由 `scripts/render-diagrams.mjs` 从 diagram IR **确定性**生成单文件 HTML（内置 archify viewer 的视觉预设、章节叙事、语义透镜），由用户按需产出与分享，**不进仓库**，因此也不受上述三条约束。工具链与门禁说明见 [ARCHITECTURE.md](ARCHITECTURE.md) §7。

## 三条最重要的约束

无论你读哪份文档，这三条都是前提：

1. **`ui/client.js` 是构建产物，不得手改。** 改源码后必须 `npm run build` 并提交产物，CI 会校验一致性。
2. **`vendor/` 下的工件均为 SHA 锁定快照，不得手改。** 当前 3 个（`promptkit-embed.js`、`archify/template.html`、`archify/i18n.mjs`），清单与校验方式见 `vendor/vendor-manifest.json` 与 [NOTICE](../NOTICE)；改动任何一个都会让 `npm run check` 失败。
3. **自动化测试无法替代真实 profile 验收。** 仓库内 219 项测试（24 个测试文件）覆盖纯逻辑断言、渲染级初始状态（真实 react-dom/server）与源码/产物文本断言，但交互（点击 / 事件）与宿主 props 形状仍只有真实 profile 能证明；升级 DSH 后必须重跑 [MANUAL-QA.md](MANUAL-QA.md)。
