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

## 三条最重要的约束

无论你读哪份文档，这三条都是前提：

1. **`ui/client.js` 是构建产物，不得手改。** 改源码后必须 `npm run build` 并提交产物，CI 会校验一致性。
2. **`vendor/promptkit-embed.js` 是 SHA 锁定的工件，不得手改。** 改动会导致 `npm run check` 失败。
3. **自动化测试无法替代真实 profile 验收。** 仓库内 84 项测试全是纯逻辑与 vm 沙箱断言；升级 DSH 后必须重跑 [MANUAL-QA.md](MANUAL-QA.md)。
