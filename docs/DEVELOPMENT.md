# 开发与验收手册

本文面向需要改动 `dsh-research-kit` 的开发者：环境准备、模块登记规则、测试策略与交付检查单。

当前仓库处于**可用状态**——589 项目录资产、统一视图四分区、公开数据源直查、方法工坊与草稿增强器、MCP Server（36 个 research_* 工具）与 Agent 活动面板均已实现，并通过两轮真实 DSH profile 烟测。本文描述**现状**与必须遵守的约束；未完成事项见根目录 [ROADMAP.md](../ROADMAP.md)。

## 1. 开始前

### 环境

- Node.js `>= 22.19`（与 DSH 宿主的 `^22.19.0 || >=24.0.0` 对齐；运行时零依赖；开发态运行 `npm test` 需先 `npm install` 安装 devDependencies 里的 react / react-dom——渲染级降级测试用真实 react-dom/server 渲染初始状态，不引入 jsdom；CI 已含 `npm ci`）；
- 可运行的 DSH Web profile —— DSH 是独立开源项目，见 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)；
- 参照 [dsh-promptkit](https://github.com/fsrmqi/dsh-promptkit) 的 DSH slot 适配方式（同为 DSH 浏览器插件）。

### 现有命令

```bash
cd dsh-research-kit

npm run build   # 根据 src/、catalog/ 与锁定工件生成 ui/ 下三个浏览器产物
npm run check   # 目录契约校验 + 源码语法检查
npm test        # 先重建浏览器产物，再运行目录逻辑、分片聚合、存储层、查询、渲染级降级、组装回放、构建产物、分区契约、DSH 槽位注册与宿主契约矩阵测试（508 项 / 70 个测试文件）
npx playwright install chromium # 首次安装浏览器；Linux CI 使用 --with-deps
npm run test:browser            # 加载生成产物，执行真实浏览器交互回归
```

兼容性与质量门（细节见 [COMPATIBILITY.md](COMPATIBILITY.md)）：

```bash
npm run baselines:fetch          # 拉取基线 DSH tag 到 .tmp/dsh-repo（CI 用；离线时矩阵改核对降级路径）
npm run check:dsh-app            # 对照基线源码逐条核查宿主契约；-- --require-source 让"缺源码/源码未自证"变成失败
                                 #   已解包副本（.tmp/dsh-tags）与工作树副本未绑 git → 默认只警告，
                                 #   --require-source 下需加 --allow-unverified-source 才放行；工作树脏需 --allow-dirty
npm run check:test-count         # 文档里的测试数字必须与实测一致（跑一遍套件比对）
npm run coverage                 # 覆盖率棘轮：低于当前 Node 主版本的地板即失败
npm run coverage:ci              # 同上 + 顺带核对文档测试数字（复用这一遍套件，CI 用它）
npm run coverage:update          # 重新测量当前主版本的地板（只抬不降，先自检后落盘）
npm run verify                   # CI 的本地等价物：check + test + 宿主契约 + coverage:ci（不含需联网的 baselines:fetch 与需 profile 的 test:browser）
```

本地开发回路（各自只管理自己记录的 pid，**绝不**按进程名杀 `dsh web`——那可能是你正在用的界面）：

```bash
npm run dev:register   # 把当前仓库登记进本机 DSH profile
DSH_PROFILE=desktop npm run dev:register   # 同上，但登记进 Desktop App 用的 desktop profile
npm run dev:watch      # 源码一变就重建 ui/ 产物（Web 与 App 共用这一份）
npm run dev:web        # 启动一个受管的本机 dsh web（端口冲突时报错而不是抢占）
```

Web 与 Desktop App 跑的是同一份 `ui/client.js`：Web 由 `dev:web` 起在被管端口（默认 3080）；Desktop App 是 Electron 外壳，直接加载打包后的 Web 入口（`dsh-app://app/`，默认 19387），再把应用请求转发给本机 Web Host。因此**改完产物后必须刷新 App 里的插件页/页面**——`dsh web` 起的那个实例不会替 App 加载代码，App 也用独立的 `desktop` profile（插件安装、`localStorage`、IndexedDB 都与 Web 分开，见 [APP-MIGRATION.md](APP-MIGRATION.md)）。客户端半只允许使用相对路由与 `location.href` 基准：宿主源是 http(s) 还是 `dsh-app` 由宿主承担，`test/build-client.test.js` 会拦下写死的绝对地址、按 `location.protocol/host/port` 分支、以及用页面 origin 当 URL 基准的写法。

浏览器回归由 `scripts/browser-regression.cjs` 启动仅监听本机随机端口的测试宿主，加载真实 React、`ui/client.js` 及其延迟工件，通过插件槽位挂载工作台、方法工坊、输入框弹层与增强器。覆盖延迟资源单次请求、三类资源分类及恢复全部、弹层分类、收藏与详情、科研模式保留手动编辑、英文查询传递、数据库切换清空结果、Plugins 行配置预设的点击写入（写入的 ops 与 revision、宿主拒绝时的「预设未保存」、只读禁用与未就绪不渲染），以及 390px 窄屏横向溢出检查。数据库返回固定测试数据，宿主写入/发送动作使用测试替身；不调用外部数据库或真实会话。

默认使用 Playwright Chromium；本机已有 Chrome 时可运行 `PLAYWRIGHT_CHANNEL=chrome npm run test:browser`。截图输出到已忽略的 `browser-results/`，失败时额外保存 `failure.png`；CI 在 push 和 pull request 时执行并上传截图。启动或断言失败会以非零状态退出，服务器与浏览器会在退出前关闭。此回归不替代真实 DSH profile 的集成验收。

工作台和弹层分类栏统一使用 `src/catalog-category-filter.js` 中的 `CatalogCategoryFilter`，通过 `type / categories / value / onChange` 传入状态；快捷分类及颜色在此集中维护。新增组件已登记到构建器的 UI 组件之后、两处调用方之前。

每次改动目录或浏览器源码后，统一执行：

```bash
npm run build && npm run check && npm test && node --check ui/client.js && node --check ui/promptkit.js
```

> **新增源码模块只要登记一处：** `scripts/build-client.mjs` 的 `files` 白名单（拼接顺序即符号可见顺序，模块间没有 `import`）。漏登记 `files` **不会有任何构建报错**，`node --check ui/client.js` 也查不出——产物只是少了一段代码，直到打开对应界面才 `ReferenceError`。同时在 `ORDERED_SYMBOLS` 补一条定义顺序断言，把「顺序错位」提前成构建期错误而非运行时崩溃。
>
> **语法不用登记：** `npm run check` 的 `scripts/check-syntax.mjs` 遍历整棵源码树（当前 208 个 `.js/.mjs`，含 `dsh/` 路由模块与 `mcp/`）单进程解析，取代了此前那条 59 项、每加一个文件都要手动补的 `node --check` 清单——它漏掉 149 个文件，却看起来还在守语法（`dsh/claim-review.js` 这类模块加个语法错误，老门禁照样绿）。清单里那 11 个 `mcp/tools/*.js` 的重复检查（`precheck`）也一并删掉了。

> **顶层符号名必须全局唯一，且每次改完源码都要重新 `npm run build`。** 所有模块被拼进同一个函数作用域，因此两个文件各写一个 `const sessions` 会让整个产物 `SyntaxError: Identifier 'sessions' has already been declared`——而这个错误只在**重新构建**时才出现：不 build 就跑 `npm run check`，检查的仍是旧产物，会一直显示为通过。**重名 `function` 比重名 `const` 更阴险**：声明合法、后者静默覆盖前者，产物照样通过 `node --check`，只在运行到调用点才炸（实测：`research-selection-store.js` 与 `evidence-store.js` 各有一个 `stateFor`，形状不同，覆盖后 `state.ids` 不可迭代，统一视图与输入框浮层一起白屏）。现已由构建期的 `assertUniqueTopLevelSymbols` 硬失败并报出 `文件:行`，不必靠记忆；函数重名按职责加前缀（`formatAssetTime` / `formatWorkbenchTime` / `formatEvidenceTime`），不要依赖「两份内容一样，覆盖也无所谓」。

> `strip()` 只认识 `export const` / `export function` / `export async function`（后者是单独一条规则，必须排在普通 `export function` 之前）与整行 `export {}`；用了别的导出形式会残留 `export` 关键字，同样是产物级别语法错误。

## 2. 当前基线

| 项目 | 状态 | 位置 |
| --- | --- | --- |
| 目录数据（351 工作流 + 109 技能 + 129 数据源，共 589 项） | 已完成并过契约校验 | `catalog/{workflows,skills,resources}/`（分片 + 各自 `index.js` 聚合入口） |
| 本地搜索与占位符替换 | 已实现（搜索覆盖正文） | `src/catalog.js` |
| 必填字段阻止发送 | 已实现（工作台与弹窗双处） | `composeWorkflow()` |
| 附加技能/数据库模块 | 已实现（`extraSkillIds`/`extraDatabaseIds`） | `src/catalog.js` |
| 目录契约校验器 | 已实现（CLI 与测试共用纯逻辑库） | `scripts/validate-catalog*.mjs` |
| 科研模式任务预设（通用研究/文献与论文/生物信息学/作物遗传育种/临床与人群研究/数据分析与可视化） | 已实现 | `src/research-workbench.js` |
| 收藏与使用历史（localStorage） | 已实现（`CatalogStorage` 接口） | `src/catalog-storage.js` |
| 工作台双栏 UI（主题变量/窄屏/aria） | 已实现 | `src/research-workbench.js` + `src/theme.js` |
| 统一视图容器与四个分区（发现/构造/沉淀/证据） | 已实现 | `src/research-console.js` + `src/lib/console-sections.js` |
| 分区契约测试（名称/定位/用途/边界/映射） | 已实现 | `test/research-console.test.js` |
| 输入框快捷入口与 overlay 选择器 | 已实现 | `src/composer-*.js` + `dsh/standalone-glue.js` |
| 浮层锚定卡片的可用高度解算（纯函数 + 单测） | 已实现 | `src/lib/overlay-anchor.js` + `test/composer-overlay.test.js` |
| 槽位注册测试（调用注册表 + 产物包含性检查） | 已实现 | `test/dsh-slots.test.js` |
| 证据库持久化 / 项目隔离 / 去重 / 备份（跨刷新以最小 IndexedDB 桩断言） | 已实现 | `test/evidence-vault.test.js` + `test/helpers/fake-indexeddb.js` |
| 证据库写入决策（未选择不注入 / 宿主不支持时降级 / 选择基准） | 已实现（纯逻辑 + 视图接线契约） | `test/evidence-vault.test.js` 的 4c 段 |
| 证据库 Agent 批量初判（一键执行 / 默认跳过人工条目 / 可选重跑 / 取消 / 并发快照保护） | 已实现；仅判断元数据与笔记，不读取全文，不改变人工核验状态 | `dsh/evidence-agent-assess.js` + `src/lib/agent-evidence-batch.js` + `test/evidence-agent-batch.test.js` |
| 证据图谱节点与边（含已保存证据接入、布局稳定性、端口路由、邻域/路径、URL 视图状态、不暴露笔记） | 已实现 | `test/evidence-graph.test.js` |
| 组装回放（分区① 内嵌紧凑回放 + 独立 viewer 弹窗） | 已实现 | `src/route-replay.js` + `src/lib/archify-adapter.js` + `test/route-replay.test.js` |
| 研究结果解释图（diagram IR → 单文件交互 HTML） | 已实现（工具链；仓库内不预置 IR 文件） | `scripts/render-diagrams.mjs` + `scripts/validate-diagrams.mjs` |
| 浏览器级交互回归（真实 Chromium，加载构建产物） | 已实现 | `scripts/browser-regression.cjs` + `npm run test:browser` |
| 宿主动作缺失的渲染级降级断言（禁用态 / 提示文案 / 不抛错 / 接线契约） | 已实现（真实 react-dom/server，无 jsdom） | `test/render-smoke.test.js` + `test/helpers/dom-stub.js` |
| 浏览器 ModuleLoader 构建 | 已实现（CI 校验可复现） | `scripts/build-client.mjs` |
| 真实 DSH profile 启动烟测 | **已完成（两轮，2026-09-10）**；证据库写入 Prompt（W1–W3）与证据图谱（G1–G4）的现场验收于 2026-09-11 通过 | 清单见 [MANUAL-QA.md](MANUAL-QA.md) |
| 宿主动作缺失降级的**交互级**断言（点击后不写入、不发送） | 未完成——渲染级已覆盖初始状态（react-dom/server），「点击」路径还需一个能构造缺失 `inputActions` 的真实 DOM 事件运行时（jsdom 或等价 harness） | 见 [ROADMAP §1](../ROADMAP.md) |
| 深色主题 / 窄屏核验 | **已完成** | 烟测观测项 O1 / O2 |
| DSH 兼容性矩阵（多基线 tag × 宿主 seam，含可选 seam 与已知缺口绊线） | 已实现（4 个基线；无源码时改核对降级路径，用例数不随环境变；seam 清单、基线清单与产物 require 提取都有冻结清单/空转守卫，可选 seam 的恒缺失状态被冻结，来源自证绑 git tag/HEAD；CI 用 --require-source 硬失败） | `scripts/lib/dsh-baselines.mjs` + `scripts/check-dsh-app.mjs` + `test/dsh-compat-matrix.test.mjs`；读者文档 [COMPATIBILITY.md](COMPATIBILITY.md) |
| 可选能力软探测（缺服务只降级、不进 inject） | 已实现 | `dsh/optional-service.js` + `test/optional-service.test.mjs` |
| 覆盖率棘轮（地板与测试规模都只许涨，按 Node 主版本分别记录） | 已实现（Node 26 → 73 / 68 / 67，Node 22.19 → 80 / 73 / 75；缺当前主版本的地板即失败；`span` 记的测试文件数/用例数低于记录值即失败——比值型覆盖率挡不住"删测试"） | `scripts/check-coverage.mjs` + `coverage-baseline.json` |
| 文档测试数字真值校验（文档 == 实测） | 已实现（同一句式全局匹配、句式未命中即失败、句式数量有下限；矩阵每基线用例数按冻结常量校验） | `scripts/check-test-count.mjs` + `scripts/lib/doc-test-count.mjs` |
| 敌意输入加固（外部数据形状异常不升级为崩溃 / 502） | 已实现（TOP5 路径 + 同族路径） | `test/hostile-input.test.mjs`；规则见 [CONTRIBUTING.md 的「两条硬规则」](../CONTRIBUTING.md) |

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

确认**构建产物**（而不是源码）能在目标 DSH 版本加载。已于 2026-09-10 在真实 DSH Web profile 上完成两轮烟测：F1–F4 快线、R1 发布门槛与 O1–O3 观测项全部通过，期间修复 1 处分区渲染缺陷；仅 R2（宿主动作缺失，无法从外部构造）未覆盖。2026-09-11 在同一 profile 上追加验证证据库写入 Prompt 的 W1–W3，全部通过。

> **逐项步骤、失败定位树与证据模板见 [`MANUAL-QA.md`](MANUAL-QA.md)**，本文不重复。

**本项无法由单元测试替代。** 仓库内 508 项测试覆盖纯逻辑断言、渲染级初始状态与源码/构建产物的文本断言（`test/dsh-slots.test.js` 直接调用注册表、slots 服务为模拟对象），能证明「产物能注册槽位」「降级时按钮真的带 disabled」，但不能证明目标 DSH 版本的 props 形状与之一致。宿主侧的**源码契约**（哪个文件定义了哪个槽位与事件）由 `npm run check:dsh-app` 对照基线 tag 逐条核查，见 [COMPATIBILITY.md](COMPATIBILITY.md)——它能把「宿主换了 API」提前到 CI，但同样不能替代 profile 里的真实交互验收。

**升级 DSH 版本后必须重跑 [`MANUAL-QA.md`](MANUAL-QA.md) 的完整清单**——此前那次走查证明的只是当时那个 DSH build 的 props 形状。

若 DSH 的 slot props 与当前 glue 不符，优先在 glue 层适配（`dsh/standalone-glue.js` 是唯一知道宿主 props 形状的文件），不要让 React 组件去读宿主私有数据。

### Milestone D：扩充第一批内容 ✅

已完成。当前 351 条工作流（28 个类目，按流程族分片维护于 `catalog/workflows/`，类目明细见 [README「目录内容」](../README.md#目录内容)）、109 项技能（`catalog/skills/`）与 129 个数据源（`catalog/resources/`），全部通过契约校验与「分片 ↔ 入口 ↔ 产物」三向断言。

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

当前分层（2026-09-11 起）：

1. **纯逻辑测试**：领域决策（布局、路由、邻域/路径、`planCitationWrite`、组装回放的 trace 与 archify `data-*` 适配契约等）直接断言输入输出；
2. **渲染级降级测试**（`test/render-smoke.test.js`）：用真实 `react-dom/server` 渲染初始状态，断言宿主动作缺失时按钮真的带 `disabled`、降级文案真的存在、视图不抛错——**不引入 jsdom**，靠 `test/helpers/dom-stub.js` 补齐 window/localStorage 等 SSR 缺失面。边界（不掩饰）：SSR 不执行事件，所以「点击后是否真的不写入」在这里测不到，由源码接线断言钉住调用关系；
3. **源码/产物文本断言**：接线契约（守卫必须存在）与构建产物一致性；
4. **浏览器级交互回归**（`scripts/browser-regression.cjs`，`npm run test:browser`）：真实 Chromium 加载构建产物并挂载四槽位，覆盖资源分类筛选与恢复、弹层分类、收藏与详情、科研模式与手动编辑共存、数据库切换清空结果、窄屏横向溢出；宿主写入/发送用测试替身，不调外部服务；
5. **真实 profile 烟测**：props 形状、槽位注册与交互，见 `docs/MANUAL-QA.md`。

### 5.1 单元测试

优先测试无需 DSH 的确定性行为：

- `searchCatalog`：类型筛选、名称/描述/标签搜索、空查询；
- `itemById`：命中与未命中；
- `composeWorkflow`：必填阻止、可选字段默认语义、多次同一占位符替换、未知占位符；
- 目录校验器：所有错误分支；
- Prompt 安全守卫（如有）：禁止弱化“不编造”规则。

### 5.2 组件测试

新增渲染级断言时（参考 `test/render-smoke.test.js`）：`installDomStub()` + `installFakeIndexedDB()` 后动态 `import` 组件，`renderToStaticMarkup(createElement(Component, props))`，用 `buttonMarkup(html, label)` 取出含特定文案的按钮标签断言 `disabled`；组件内部异步取数（IndexedDB / assetProvider）全部要能接受桩。SSR 覆盖不到的交互（点击、事件、useLayoutEffect）不要伪装测过——要么走源码接线断言，要么留给真实 profile。

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
- [ ] 改了测试数量或文件数时，`npm run check:test-count` 通过（它会直接告诉你该改成多少）；
- [ ] 不新增模型密钥、遥测或未说明的网络请求；
- [ ] 所有面向用户的中文文本清楚标明草案、核验与能力边界。

### 新增源码模块 / 外部数据解析

- [ ] 登记三处：`scripts/build-client.mjs` 的 `files`、`package.json` 的 `check`（宿主半区文件也要进）、[ARCHITECTURE.md 的受控清单](ARCHITECTURE.md)；
- [ ] 解析外部数据的函数是 total 的（见 [CONTRIBUTING.md 的「两条硬规则」](../CONTRIBUTING.md)），并在 `test/hostile-input.test.mjs` 补一条敌意 fixture；
- [ ] 覆盖率不低于当前 Node 主版本的地板（`npm run coverage`）。`coverage:update` **只抬不降**：下降时它会失败并要求补测试；若下降确实是设计取舍，直接改 `coverage-baseline.json` 并在 PR 写明理由。换 Node 主版本后要在那台版本上重新记录地板。地板块缺失、字段非法（含 `0 < 值 < 1`——Node 会把阈值向下取整成 0，那条指标的门禁会当场消失）时判为配置错误（exit 2）；`coverage:update` 也不会替你静默重建非法条目。

### 新增或修改工作流

- [ ] JSON schema 校验通过；
- [ ] 每个 `{placeholder}` 都有且只有一个字段定义；
- [ ] 有明确材料、范围、输出和不编造边界；
- [ ] 需要文件时设置 `requiresFiles: true`；
- [ ] 建议的技能/数据库关联真实存在且不承诺已接通；
- [ ] 已完成至少一次人工 Prompt 走查。

### DSH 适配变更

- [ ] 新旧目标 DSH 版本的 props 契约已记录；
- [ ] `npm run baselines:fetch && npm run check:dsh-app -- --require-source` 通过（宿主 seam 逐条核对，且每个基线都用**可自证**的 git 源核对过；见 [COMPATIBILITY.md](COMPATIBILITY.md)）；
- [ ] 真实 profile 已验证写入与发送；
- [ ] 不会重复注册 view；
- [ ] 会话切换时操作仍指向正确会话；
- [ ] 深色主题与窄屏已检查。
