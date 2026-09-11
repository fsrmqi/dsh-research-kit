# 开发与验收手册

本文面向需要改动 `dsh-research-kit` 的开发者：环境准备、模块登记规则、测试策略与交付检查单。

当前仓库处于**可用状态**——128 项目录资产、统一视图四分区、公开数据源直查、方法工坊与草稿增强器均已实现，并通过两轮真实 DSH profile 烟测。本文描述**现状**与必须遵守的约束；未完成事项见根目录 [ROADMAP.md](../ROADMAP.md)。

## 1. 开始前

### 环境

- Node.js `>= 22.6`（本仓库无运行时依赖，不需要 `npm install`）；
- 可运行的 DSH Web profile —— DSH 是独立开源项目，见 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)；
- 参照 [dsh-promptkit](https://github.com/fsrmqi/dsh-promptkit) 的 DSH slot 适配方式（同为 DSH 浏览器插件）。

### 现有命令

```bash
cd dsh-research-kit

npm run build   # 根据 src/ 与 catalog/ 生成 ui/client.js
npm run check   # 目录契约校验 + 源码语法检查
npm test        # 先重建浏览器产物，再运行目录逻辑、存储层、查询、构建产物、分区契约与 DSH 槽位注册测试（116 项）
```

每次改动目录或浏览器源码后，统一执行：

```bash
npm run build && npm run check && npm test && node --check ui/client.js
```

> **新增源码模块必须登记两处：** `scripts/build-client.mjs` 的 `files` 白名单（拼接顺序即符号可见顺序，模块间没有 `import`）与 `package.json` 的 `check` 脚本（逐文件 `node --check`）。漏登记 `files` **不会有任何构建报错**，`node --check ui/client.js` 也查不出——产物只是少了一段代码，直到打开对应界面才 `ReferenceError`。同时在 `ORDERED_SYMBOLS` 补一条定义顺序断言，把「顺序错位」提前成构建期错误而非运行时崩溃。

> **顶层符号名必须全局唯一，且每次改完源码都要重新 `npm run build`。** 所有模块被拼进同一个函数作用域，因此两个文件各写一个 `const sessions` 会让整个产物 `SyntaxError: Identifier 'sessions' has already been declared`——而这个错误只在**重新构建**时才出现：不 build 就跑 `npm run check`，检查的仍是旧产物，会一直显示为通过。**重名 `function` 比重名 `const` 更阴险**：声明合法、后者静默覆盖前者，产物照样通过 `node --check`，只在运行到调用点才炸（实测：`research-selection-store.js` 与 `evidence-store.js` 各有一个 `stateFor`，形状不同，覆盖后 `state.ids` 不可迭代，统一视图与输入框浮层一起白屏）。现已由构建期的 `assertUniqueTopLevelSymbols` 硬失败并报出 `文件:行`，不必靠记忆；函数重名按职责加前缀（`formatAssetTime` / `formatWorkbenchTime` / `formatEvidenceTime`），不要依赖「两份内容一样，覆盖也无所谓」。

> `strip()` 只认识 `export const` / `export function` / `export async function`（后者是单独一条规则，必须排在普通 `export function` 之前）与整行 `export {}`；用了别的导出形式会残留 `export` 关键字，同样是产物级别语法错误。

## 2. 当前基线

| 项目 | 状态 | 位置 |
| --- | --- | --- |
| 目录数据（65 工作流 + 8 技能 + 55 数据源） | 已完成并过契约校验 | `catalog/*.json` |
| 本地搜索与占位符替换 | 已实现（搜索覆盖正文） | `src/catalog.js` |
| 必填字段阻止发送 | 已实现（工作台与弹窗双处） | `composeWorkflow()` |
| 附加技能/数据库模块 | 已实现（`extraSkillIds`/`extraDatabaseIds`） | `src/catalog.js` |
| 目录契约校验器 | 已实现（CLI 与测试共用纯逻辑库） | `scripts/validate-catalog*.mjs` |
| 科研模式领域预设（基因遗传/临床/通用） | 已实现 | `src/research-workbench.js` |
| 收藏与使用历史（localStorage） | 已实现（`CatalogStorage` 接口） | `src/catalog-storage.js` |
| 工作台双栏 UI（主题变量/窄屏/aria） | 已实现 | `src/research-workbench.js` + `src/theme.js` |
| 统一视图容器与四个分区（发现/构造/沉淀/证据） | 已实现 | `src/research-console.js` + `src/lib/console-sections.js` |
| 分区契约测试（名称/定位/用途/边界/映射） | 已实现 | `test/research-console.test.js` |
| 输入框快捷入口与 overlay 选择器 | 已实现 | `src/composer-*.js` + `dsh/standalone-glue.js` |
| 浮层锚定卡片的可用高度解算（纯函数 + 单测） | 已实现 | `src/lib/overlay-anchor.js` + `test/composer-overlay.test.js` |
| 槽位注册测试（vm 沙箱跑产物） | 已实现 | `test/dsh-slots.test.js` |
| 证据库持久化 / 项目隔离 / 去重 / 备份（跨刷新以最小 IndexedDB 桩断言） | 已实现 | `test/evidence-vault.test.js` + `test/helpers/fake-indexeddb.js` |
| 浏览器 ModuleLoader 构建 | 已实现（CI 校验可复现） | `scripts/build-client.mjs` |
| 真实 DSH profile 启动烟测 | **已完成（两轮，2026-09-10）** | 清单见 [MANUAL-QA.md](MANUAL-QA.md) |
| 浏览器级交互测试（jsdom） | 未完成 | 见 [ROADMAP](../ROADMAP.md) |
| 深色主题 / 窄屏核验 | **已完成** | 烟测观测项 O1 / O2 |

## 3. 实现里程碑

以下四个里程碑记录本项目的能力边界是如何建立的。**A / B / C / D 均已完成**——保留在此处是因为它们说明了"为什么这么设计"，以及新增同类能力时应遵循的验收口径。

### Milestone A：让目录资产可靠 ✅

把「新增工作流」变成安全、可重复的内容工作，而不是依赖 UI 代码约定。

1. `scripts/validate-catalog.mjs`（CLI 与测试共用纯逻辑库）；
2. 校验 `id` 唯一性、类型、必填公共字段与合法 `availability`；
3. 校验 Workflow 占位符与 `placeholders` 双向一致；
4. 校验关联的 skill / database ID 存在；
5. 校验提示词中至少包含一条防编造 / 待核验边界；
6. 已接入 `npm run check`；
7. 每一项失败条件都有测试或固定 fixture。

**验收口径**：故意加入重复 ID、漏声明占位符或错误关联时，`npm run check` 必须非零退出并给出条目 ID 与字段名。

### Milestone B：完成科研工作台 UX ✅

使「目录 → 详情 → 参数 → Prompt 预览 → 运行」这条链路在 DSH 中完整可用：主题感知基础样式、学科分组与"需要材料"标记、参数表单、Prompt 预览与手动编辑（含"恢复自动生成"）、字段级错误、窄屏单栏、深色主题、空结果状态。

同时交付输入框快捷入口：`conversation.input.left` 的「资源 / 工作流程」打开 `conversation.input.overlay`，选择流程后显示预览确认弹窗；「使用工作流程」**只写入草稿，不自动发送**。

**验收口径**：用户可在不懂 Prompt 的前提下完成一次「审阅论文」任务启动；不会看到插件伪装出来的上传、数据库查询或模型执行状态。

### Milestone C：真实 DSH 集成 ✅

确认**构建产物**（而不是源码）能在目标 DSH 版本加载。已于 2026-09-10 在真实 DSH Web profile 上完成两轮烟测：F1–F4 快线、R1 发布门槛与 O1–O3 观测项全部通过，期间修复 1 处分区渲染缺陷；仅 R2（宿主动作缺失，无法从外部构造）未覆盖。

> **逐项步骤、失败定位树与证据模板见 [`MANUAL-QA.md`](MANUAL-QA.md)**，本文不重复。

**本项无法由单元测试替代。** 仓库内 116 项测试全是纯逻辑与 vm 沙箱断言（`test/dsh-slots.test.js` 虽执行构建产物，但 slots 服务是模拟的），只能证明"产物能注册槽位"，不能证明目标 DSH 版本的 props 形状与之一致。

**升级 DSH 版本后必须重跑 [`MANUAL-QA.md`](MANUAL-QA.md) 的完整清单**——此前那次走查证明的只是当时那个 DSH build 的 props 形状。

若 DSH 的 slot props 与当前 glue 不符，优先在 glue 层适配（`dsh/standalone-glue.js` 是唯一知道宿主 props 形状的文件），不要让 React 组件去读宿主私有数据。

### Milestone D：扩充第一批内容 ✅

已完成。当前 65 条工作流（论文与手稿 13、文献研究 12、基因组学 22、临床研究 5、数据分析 11、研究设计 2）、8 项技能与 55 个数据源，全部通过契约校验；学科类目覆盖论文与手稿、文献研究、基因组学、临床研究、数据分析与研究设计。

后续扩充方向见 [ROADMAP.md](../ROADMAP.md)。

## 4. DSH 集成实现指南

### 4.1 槽位职责

当前实现注册四个槽位，视图槽位只有一个（合并前为三个并列视图）：

```js
ctx.slots.inject('conversation.view', () =>
  ctx.slots.register({
    name: 'conversation.view',
    id: 'dsh-research-kit-console',
    order: 91,
    label: () => '科研工作台',
    inject: sessionId => ({ sessionId }),
  }, ResearchConsoleHost)
)
```

`ResearchConsoleHost` 负责把 DSH props 交给统一容器，由 `src/research-console.js` 在内部按分区调度：

- 分区契约（名称 / 定位 / 核心用途 / 职责边界 / 独占数据）声明在 `src/lib/console-sections.js`，改动分区结构只改这一处；
- 分区 → 组件映射写在 `src/research-console.js` 的 `SECTION_VIEWS`，新增分区必须同时补组件，否则契约测试会失败；
- 本仓库的分区组件以 `embedded` 模式渲染（跳过 `Page`/`GlobalStyle`，保留自身标题），vendored 方法工坊保持零改动、自带页头。**新增分区必须同样传 `embedded`**——否则容器 `Page` 内会嵌套第二层 `Page`，`min-height:100vh` 叠加产生多余滚动并把工具栏推到标签栏背后（该缺陷类已由 `test/research-console.test.js` 的「分区嵌入契约」守护）。
- 顶部吸顶分两层：一级是容器导航 `.rk-console-nav`，二级是各分区自己的操作行（检索 / 筛选 / 模式 / 主操作）。**分层原则：吸顶只放"随时要用的操作"，不放"读一次就够的内容"**——分区封面只留标题、导语与低频动作，常驻控件必须放进吸顶带（本仓库分区给 `Toolbar` 传 `sticky: true`，方法工坊走 vendored 侧解绑规则）。二级偏移量一律引用容器实测写入的 `--rk-console-nav-h`，不要写死像素。细则、两条 vendor 解绑与实测数据见 `docs/ARCHITECTURE.md` §2.3。

`standalone-glue.js` 是唯一知道 DSH props 形状的文件。后续 DSH 版本若更改 `inputActions` 或会话 ID 的位置，只改 `dsh/standalone-glue.js`。

### 4.2 输入与发送契约

工作台只假设两个操作：

```ts
type InputActions = {
  setDraft(text: string): void
  submit(): Promise<void> | void
}
```

实现要求：

- 先 `setDraft(finalPrompt)`，再 `submit()`；
- `submit()` 抛错时，保留已写入的草稿，让用户可手工发送；
- 若 `inputActions` 缺失，禁用操作按钮并显示原因；
- 不从插件侧调用模型、构建 messages 或篡改其他会话历史。

### 4.3 浏览器构建器

构建器目前为零外部依赖的简化拼接器，不是通用 bundler。维护时注意：

- 加入新的浏览器模块后，要把它放到 `files` 列表且保证依赖顺序；
- 任何 ESM import 均会被去除，因此模块间符号依赖需要按拼接顺序可见；
- JSON 需要构建时内联；
- 不要把 Node API、动态 import、CommonJS `require`（除 DSH 提供模块）留在最终浏览器代码；
- 引入复杂依赖前，应考虑迁移到受控 bundler，而不是继续扩大文本替换规则。

## 5. 测试策略

### 5.1 单元测试

优先测试无需 DSH 的确定性行为：

- `searchCatalog`：类型筛选、名称/描述/标签搜索、空查询；
- `itemById`：命中与未命中；
- `composeWorkflow`：必填阻止、可选字段默认语义、多次同一占位符替换、未知占位符；
- 目录校验器：所有错误分支；
- Prompt 安全守卫（如有）：禁止弱化“不编造”规则。

### 5.2 组件测试

使用最小的 `inputActions` fake：

```js
const actions = {
  drafts: [],
  submitted: 0,
  setDraft(text) { this.drafts.push(text) },
  submit() { this.submitted += 1 }
}
```

至少断言：缺必填项不会调用 `setDraft`/`submit`；缺宿主动作时按钮禁用且不显示成功；写入只调用 `setDraft`；发送先写入后发送；筛选后详情属于当前结果集；手工编辑 Prompt 的文本被发送；手动编辑后切换技能会给出恢复自动生成入口。

### 5.3 真实 DSH 烟测

真实 profile 烟测是发布门槛，因为 ModuleLoader 格式、slot 名称和 props 不能仅靠模拟测试保证。复用同级 `dsh-promptkit` 的 DSH profile smoke 思路，但不要复制其增强路由或输入拦截实现。

## 6. Pull Request 检查单

### 所有变更

- [ ] `npm run build && npm run check && npm test && node --check ui/client.js` 通过；
- [ ] 不手工编辑 `ui/client.js`；
- [ ] README 或相应文档已同步；
- [ ] 不新增模型密钥、遥测或未说明的网络请求；
- [ ] 所有面向用户的中文文本清楚标明草案、核验与能力边界。

### 新增或修改工作流

- [ ] JSON schema 校验通过；
- [ ] 每个 `{placeholder}` 都有且只有一个字段定义；
- [ ] 有明确材料、范围、输出和不编造边界；
- [ ] 需要文件时设置 `requiresFiles: true`；
- [ ] 建议的技能/数据库关联真实存在且不承诺已接通；
- [ ] 已完成至少一次人工 Prompt 走查。

### DSH 适配变更

- [ ] 新旧目标 DSH 版本的 props 契约已记录；
- [ ] 真实 profile 已验证写入与发送；
- [ ] 不会重复注册 view；
- [ ] 会话切换时操作仍指向正确会话；
- [ ] 深色主题与窄屏已检查。
