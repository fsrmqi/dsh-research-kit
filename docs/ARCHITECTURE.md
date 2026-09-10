# 架构与数据契约

本文是 `dsh-research-kit` 的架构参考：模块职责、运行时数据流、DSH 宿主边界、目录数据契约与扩展点。需要改动代码或新增资产时以此为准。

文档索引见 [`README.md`](README.md)；手工验收方式见 [`MANUAL-QA.md`](MANUAL-QA.md)；方法工坊与草稿增强器的嵌入细节见 [`METHOD-WORKSHOP.md`](METHOD-WORKSHOP.md)。

## 1. 架构决策

### 1.1 一句话架构

`dsh-research-kit` 是一个 **浏览器侧 DSH 插件**：它维护科研资源目录、把工作流和用户参数组装成可编辑 Prompt，并由 DSH 当前会话负责实际发送与执行。

```text
┌────────────────────────────────────────────────────────────────────┐
│                          DSH 宿主                                   │
│  conversation.view        conversation.input.*    inputActions      │
│  （视图槽位）              （左入口/浮层/右增强）   setDraft / submit │
└───────▲───────────────────────────▲───────────────────▲────────────┘
        │                           │                   │
  注册统一视图                 注册输入槽位        写入 / 发送最终 Prompt
        │                           │                   │
┌───────┴───────────────────────────┴───────────────────┴────────────┐
│                   DSH Research Kit（浏览器侧）                       │
│                                                                     │
│  ResearchConsole（统一容器 + 两级吸顶）                              │
│    ├─ ①「资源与工作流」 catalog.js ──► catalog/*.json               │
│    ├─ ②「方法工坊」     vendored 工件 + prompt-studio-glue          │
│    ├─ ③「研究灵感库」   research-vault.js ◄─► vault-core.js         │
│    └─ ④「研究证据图谱」 evidence-store.js ◄─► evidence-graph-core   │
│                                                                     │
│  所有分区共享同一出口：setDraft() / submit()，缺失时降级为复制 Prompt │
└───────▲─────────────────────────────────────────────────────────────┘
        │  仅两条受控路由（index.js，Node half）
        │  /query（公开数据源直查，经 ctx.web.fetch） · /semantic-enhance*
└───────┴──── DSH 受控 web 服务 / 当前会话模型路由
```

### 1.2 不引入独立后端的原因

第一期不需要沙箱、数据库代理或任务队列。它们会重复 DSH 已经承担的能力，并带来权限、保密、成本和状态同步问题。

**例外：Node half 只保留两条无法在浏览器侧完成的受控路由**（`index.js`，见 §2.1）：

1. `/dsh-research-kit/query` —— 公开数据源直查。浏览器无法直接跨域访问这些 API，且需要进程内缓存与限流；出网一律经 DSH `ctx.web.fetch()`，插件自身不持有凭据。
2. `/dsh-research-kit/semantic-enhance`（含 `/stream`）—— 草稿语义增强。复用当前会话已建立的模型路由（`sessionId → provider/model`），不持有任何 API Key。

两者都不构成"插件自己的后端"：无独立进程状态可持久化、无凭据、无模型选择权，宿主卸载插件后不残留。除此之外的一切仍在浏览器侧完成。

| 能力 | 所有者 | 本插件职责 |
| --- | --- | --- |
| 模型路由与调用 | DSH | 不读取密钥，不自行调用模型。 |
| 当前对话与发送 | DSH | 通过 `inputActions` 写入或提交。 |
| 文件、`@` 提及与文件内容注入 | DSH | 只在 UI 中提示用户使用原生能力。 |
| MCP、Web、数据库工具 | DSH / 已安装插件 | 只如实标注工作流的接入前提。 |
| 工作流资产与 Prompt 组装 | Research Kit | 维护 JSON 目录、表单、校验与预览。 |
| 科研结论的责任 | 研究者 | 产物必须标为草案/待核验，不自动升级为事实。 |

### 1.3 已知宿主兼容性原则

同级 `dsh-promptkit` 已验证 DSH 的 `conversation.view` 与 `inputActions` 集成方式，但 DSH 的槽位 props 曾在版本间演变。因此：

- 首次接入必须在真实 DSH profile 启动验证，而不是只依赖单元测试；
- 所有访问 `inputActions` 的代码必须允许其暂时不存在，展示可理解的错误，不得使视图崩溃；
- 仅在用户点击“发送到当前会话”时调用 `submit()`；
- 不截获 Enter，不改变原生输入框行为；
- 不重新实现 `@文件` 自动补全、上传或文件解析。

## 2. 目录与模块职责

```text
dsh-research-kit/
├── catalog/                         # 人工审核的科研资产，纯数据
│   ├── workflows.json               # 参数化 Prompt 工作流（65）
│   ├── skills.json                  # Prompt 指导或宿主能力前提（8）
│   ├── databases.json               # 数据源说明与接入状态（55）
│   └── database-metadata.json       # 数据源分组等展示元数据
├── src/
│   ├── catalog.js                   # 资源读取、搜索、查询、Prompt 组装（纯函数）
│   ├── catalog-storage.js           # 收藏与使用历史的 CatalogStorage 接口
│   ├── research-selection-store.js  # 会话级资源选择（仅存于当前会话）
│   ├── evidence-store.js            # 本会话证据索引（只读汇总）
│   ├── evidence-vault-store.js      # 证据库持久化：IndexedDB 最小 schema + 内存降级 + 项目隔离 / 去重 / 备份
│   ├── theme.js                     # 视觉令牌单一真源（--rk-* 明暗双源 + 交互反馈）
│   ├── ui.js                        # 统一基础组件层（按钮/卡片/输入/标签/空态/弹窗…）
│   ├── research-console.js          # 统一视图容器：分区调度 + 两级吸顶偏移实测
│   ├── research-workbench.js        # 分区①「资源与工作流」：目录检索 + Prompt 组装
│   ├── research-vault.js            # 分区③「研究灵感库」：资产增删改 / 版本 / 验证状态 + 沉淀层子模块切换
│   ├── research-evidence-vault.js   # 证据库面板（项目切换 / 删除 / 导入导出）与保存表单
│   ├── research-evidence-graph.js   # 分区④「研究证据图谱」：关系图渲染
│   ├── database-query-panel.js      # 公开数据源直查面板（工作台详情内嵌）
│   ├── composer-launcher.js         # 输入框工具行「资源/工作流程」入口
│   ├── composer-overlay.js          # 输入框 overlay 资源选择器与启动弹窗
│   └── lib/
│       ├── icons.js                 # 图标 path
│       ├── enhance-output.js        # 模型输出协议解析（Node half 与浏览器共用）
│       ├── vault-core.js            # 灵感资产纯逻辑与隐私边界
│       ├── evidence-graph-core.js   # 证据图谱布局纯逻辑
│       ├── evidence-vault-core.js   # 证据条目纯逻辑：标识符识别、规范化、隐私校验、去重键、备份格式
│       ├── console-sections.js      # 统一容器的分区契约（名称/定位/用途/边界/独占数据）
│       └── overlay-anchor.js        # 输入卡片浮层的锚定与可用高度解算（纯函数）
├── dsh/
│   ├── standalone-glue.js           # DSH 槽位注册唯一入口（view + input.left + input.overlay + input.right）
│   ├── slot-registry.js             # 四个槽位的 id/order/label 单一事实源（纯数据）
│   ├── prompt-studio-glue.js        # 分区②「方法工坊」宿主与 provider 实例化
│   ├── prompt-enhancer-glue.js      # 草稿增强器宿主：研究上下文桥接 + SSE 客户端
│   ├── database-query.js            # 公开数据源直查适配器、缓存与限流（Node half）
│   └── semantic-enhance.js          # 语义增强 system 指令与两条路由（Node half）
├── ui/
│   ├── package.json                 # 浏览器子包元数据
│   └── client.js                    # 构建生成的 DSH ModuleLoader 产物（勿手改）
├── vendor/
│   ├── promptkit-embed.js           # vendored 界面工件（SHA-256 锁定，勿手改）
│   └── vendor-manifest.json         # 工件来源 commit 与校验和
├── scripts/
│   ├── build-client.mjs             # 内联目录数据并生成浏览器产物（含符号顺序断言）
│   ├── check-vendor.mjs             # 校验 vendored 工件未被篡改
│   └── validate-catalog*.mjs        # 目录契约校验（CLI 与测试共用纯逻辑库）
├── test/                            # 113 项测试（15 个测试文件 + 1 个 IndexedDB 桩：纯逻辑 + vm 沙箱断言）
├── docs/                            # 读者文档，索引见 docs/README.md
├── index.js                         # Node half：仅注册受控路由
├── package.json
└── cordis.patch.yml                 # DSH bundle 注册补丁
```

### 2.1 分层规则

| 层 | 可以做什么 | 不可以做什么 |
| --- | --- | --- |
| `catalog/` | 声明研究流程、文本、字段、关联、限制 | 放可执行 JS、密钥、未核验结论。 |
| `src/catalog.js` | 纯函数、数据校验、搜索、Prompt 组装 | 访问 DOM、网络、`localStorage`。 |
| `src/catalog-storage.js` | 收藏/历史读写、变更通知，隔离 localStorage | 存参数值或完整 Prompt；网络访问。 |
| `src/research-selection-store.js` | 会话级资源选择的读写与广播 | 跨会话持久化。 |
| `src/evidence-store.js` | 在当前页面内存中汇总本会话已选资源、已启动工作流与直查来源的**索引**，并向各视图实时广播 | 执行查询、持久化、保存原始文件或检索词、生成结论。 |
| `src/evidence-vault-store.js` | 证据库持久化：IndexedDB 最小 schema、按项目隔离与去重、备份序列化，并提供内存降级 | 触碰 DOM；在降级时伪装成已持久化；保存未经用户确认的条目。 |
| `src/theme.js` | 主题 CSS 变量与 GlobalStyle 注入 | 读取宿主私有主题 API。 |
| `src/ui.js` | 无业务状态的基础组件与图标 | 持有业务逻辑或读取目录数据。 |
| `src/research-console.js` | 分区调度、分区导航、两级吸顶偏移实测 | 持有任何分区的业务逻辑，或读写分区的数据。 |
| `src/research-workbench.js` / `research-vault.js` / `research-evidence-graph.js` | React 状态、渲染、调用注入的宿主动作 | 直接依赖 DSH 私有全局或发网络请求。 |
| `src/lib/*` | 与 DOM 解耦的纯逻辑（协议解析、布局解算、隐私边界、分区契约） | 触碰 DOM 或宿主 API。 |
| `src/composer-launcher.js` / `composer-overlay.js` | 输入框入口、overlay 选择器、启动弹窗 | 绕过 `inputActions` 直接发送或读取文件。 |
| `dsh/standalone-glue.js` | 将 DSH props 映射为组件 props、注册槽位（返回统一释放函数） | 处理领域业务、拼 Prompt。 |
| `dsh/slot-registry.js` | 槽位 id / order / label 的纯数据声明 | 执行注册本身。 |
| `dsh/prompt-studio-glue.js` / `prompt-enhancer-glue.js` | 为 vendored 组件与增强器提供宿主装配 | 修改 vendored 工件本身。 |
| `dsh/database-query.js` / `semantic-enhance.js` | Node half 的两条受控路由 | 持久化状态、持有凭据、自行选择模型。 |
| `vendor/` | 存放经审查、SHA 锁定的工件快照 | 手工编辑；运行时从相邻目录加载。 |
| `ui/client.js` | 仅为构建产物 | 手工编辑。 |
| `index.js` | 保持插件 Node half 可被加载；仅注册 §1.2 的两条受控路由 | 持久化状态、持有凭据、自行选择模型或注册未经需求确认的路由。 |

### 2.2 统一视图的分区契约

三个并列视图（科研工作台 / 研究方法工坊 / 研究灵感库）已合并为单一 `conversation.view`（`dsh-research-kit-console`），内部按「发现 → 构造 → 沉淀 → 证据」的科研闭环做四个二级分区。证据图谱是 Research Kit 自有分区，汇总本会话资源、工作流、查询来源与资产关系；其余三个分区组件继续以 `embedded` 模式复用。

| 分区 | 定位 | 核心用途 | 职责边界 | 独占数据 |
| --- | --- | --- | --- | --- |
| 资源与工作流 | 发现层 | 目录检索、按参数与技能组装 Prompt、公开数据源直查 | 不生产知识、不沉淀资产、不直接出网 | 目录收藏与使用历史 |
| 方法工坊 | 构造层 | 方法卡库、变量填充生成可编辑 Prompt、从当前对话提取草稿并写回输入框 | 不管理资产正文、不检索项目记忆或最近会话、不替工作流决定领域参数 | 方法卡与工坊资产 |
| 研究灵感库 | 沉淀层 | 资产增删改、版本派生与对比、验证状态跟进 | 不生成 Prompt、不存原始数据与完整查询结果 | 灵感资产 |
| 研究证据图谱 | 证据层 | 可视化本会话已选资源、已启动工作流、直查来源与资产之间的关系 | 不执行查询、不生成结论、不保存原始文件与检索词 | 本会话证据索引（`evidence-store`） |

契约由 `src/lib/console-sections.js` 声明、`test/research-console.test.js` 守护：

- 每个分区必须声明名称、定位、核心用途、职责边界与独占数据五项；
- 职责边界必须显式包含否定项（"不做什么"），数据归属必须互斥，避免合并后功能重叠；
- 分区 id 必须与 `src/research-console.js` 的组件映射表一一对应，不允许出现"有导航无内容"的空分区。

合并过渡期的「原「旧标签」」提示徽标已移除：三个分区的旧位置映射在合并后已稳定，徽标只是常驻噪声，且它会随窗口变窄折行、反过来改变导航高度（而导航高度正是二级吸顶的偏移量来源）。因此 `formerLabel` 一并不再作为契约字段保留，避免留下无消费方的死数据。

**分区宽度一致性**：四个分区必须铺满内容区，水平内边距统一引用流式令牌 `--rk-gutter: clamp(16px, 3vw, 34px)`（`src/theme.js` 唯一定义处，容器导航条与四个分区五处共同消费）：视口 ≥1133px 时取上限 34px（与既有视觉刻度一致），其间随窗口线性收缩，880px 以下由媒体查询锁定 16px。宽度方向一律用 `100%` 相对父容器解算，不得出现固定像素宽度。方法工坊复用 vendored `PromptStudio`，其根 `<main>` 内联了 `width: min(1240px, max(100%, calc(100vw - 280px)))` 与 `margin: 0 auto`——这是「独立插件页 + 为宿主侧栏预留 280px」场景的写法。嵌入统一容器后父容器已是扣除侧栏后的可视区，叠加该上限会使本分区收成居中窄栏（宽屏留白、窄容器横向溢出），与另外三个铺满分区视觉割裂。

vendor 为 SHA 锁定工件不可改，因此由 `dsh/prompt-studio-glue.js` 的宿主包装提供锚点 `.rk-studio-host`，`src/theme.js` 以 author 级 `!important` 规则覆盖内联宽度（内联声明非 `!important` 时可被覆盖），只解绑宽度、内边距与 `overflow`，不改动组件其他样式。真实 Chromium 实测（视口 1280px）：

| 父容器宽 | 解绑前 main 宽 | 解绑后 main 宽 |
| --- | --- | --- |
| 1440px | 1240px（左右各留白 100px） | 1440px（铺满） |
| 900px | 1000px（横向溢出 100px） | 900px（贴合） |

流式令牌四档视口实测（方法工坊分区，`--rk-gutter` 解算值）：

| 视口宽 | `--rk-gutter` 解算值 | main 宽 | 横向溢出 |
| --- | --- | --- | --- |
| 600px | 16px（媒体查询锁定） | 铺满 | 无 |
| 880px | 16px（媒体查询锁定） | 铺满 | 无 |
| 1000px | 30px（3vw） | 铺满 | 无 |
| 1440px | 34px（上限） | 铺满 | 无 |

契约由 `test/research-console.test.js` 守护：vendor 宽度写法漂移检测 + 宿主锚点存在 + 覆盖规则齐备（宽度 / 居中边距 / `overflow`）+ 流式令牌定义（上下限与视口项）+ 四分区内边距同刻度。

其中 `overflow` 解绑是吸顶生效的前提，原因见 §2.3：`S.page` 里的 `overflow: auto` 会在嵌入场景下变成一个不再滚动的内层滚动盒，把 `<main>` 内所有 `position: sticky` 的参照系锁死在它自己身上。

### 2.3 顶部吸顶分层

统一视图的可滚动内容很长（分区①详情栏、分区③资产列表都能把页面撑到数千像素），而检索、筛选与模式切换是复用频率最高的动作。顶部因此采用**两层吸顶 + 一条分层原则**，而不是把所有头部一把吸住：

> **吸顶只放「随时要用的操作」，不放「读一次就够的内容」。**

| 层级 | 元素 | 是否吸顶 | 理由 |
| --- | --- | --- | --- |
| 一级 | `.rk-console-nav`（分区导航 + 说明块） | 是 | 回答"我在哪个分区"，跨分区切换不应需要回滚 |
| — | 分区封面 `PageHead`（kicker / 标题 / 导语 / 低频动作） | 否 | 定位是"封面"：标题与一级导航的当前标签重复，导语是读一次的介绍；吸住会白占约 87px 并放大重复感 |
| 二级 | `.rk-sticky-toolbar`（该分区的常驻操作行） | 是 | 高频控件。资源 128 项、资产与方法库持续增长，滚走意味着每次操作都要先回顶部 |

四个分区的二级吸顶带按同一口径组装（检索 + 筛选 + 该分区的模式/主操作）：

| 分区 | 二级吸顶带内容 | 实现 |
| --- | --- | --- |
| 资源与工作流 | 科研模式 · 检索框 · 类型筛选（全部/工作流程/技能/数据库/收藏/历史） | `Toolbar sticky` |
| 方法工坊 | 方法检索框 · 分类下拉 | vendored 组件的筛选块（宿主侧解绑，见下） |
| 研究灵感库 | 检索框 · 状态筛选 · 项目筛选 · 新建资产 | `Toolbar sticky` |
| 研究证据图谱 | 节点计数 · 关系计数 · 图例 | `Toolbar sticky` |

**操作下沉而非封面吸顶**：`科研模式` 原挂在分区封面右侧、`新建资产` 原挂在封面动作区，都会随页面滚走（实测 `科研模式` 滚 800px 后 top = −555），每次切换都要先回顶部。两者都是常驻控件，因此下沉进二级吸顶带；而导出/恢复备份是一次性维护动作，留在封面即可，不占用常驻高度。

**折行顺序有意为「模式 → 检索 → 筛选」**：三者放不下一行时按 DOM 顺序折行，把最宽的筛选项留在最后折行才能占满整行；若把「科研模式」放末尾，被挤到第二行的就是它一个窄控件，会留下一整行空白（实测 1180px 窗口即触发）。检索框的 flex 基准（`1 1 200px`）也是按"三者同占一行"倒推的：922px 内容宽下 模式 176 + 检索 200 + 筛选 495 + 间距 20 = 891 ≤ 922。

**偏移量必须实测，不得写死像素**：二级吸顶的 `top` 取 `var(--rk-console-nav-h)`，由 `ResearchConsole` 用 `ResizeObserver` 观察一级导航并写入；挂载时先写一次，卸载时清理。写死必然错位——导航高度随窗口变窄换行（说明块变 4–5 行）而变化，实测在 1280px 宽下为 149px、780px 宽下为 180px。

三个关键约束：

- **观察 `box: 'border-box'`**：`ResizeObserver` 默认只观察 content-box，因此"内边距/边框把导航撑高而内容框不变"的变化不会触发回调，二级吸顶会停在旧位置、压进导航底下。此缺陷只有在真实宿主里扰动导航高度才暴露得出来。
- **吸顶带必须有背景**，且垂直节奏由内边距而非外边距承接——外边距区域不绘制背景，吸顶后滚动内容会从缝隙透出（故 `Toolbar` 在 `sticky` 态把 `margin` 置零，由 `.rk-sticky-toolbar` 的 `padding` 接管）。
- **`overflow` 必须解绑**（方法工坊专属，见下）：任何祖先建立滚动盒都会夺走后代 sticky 的参照系。

**方法工坊的两条 vendor 解绑**（这是四个分区里唯一不由本仓库实现的区块，两条都只有真实宿主才暴露）：

1. **vendored 左列的死 sticky**。组件把筛选块与整个方法列表放进同一列 `<aside>`，并给这一列写了 `position: sticky; top: 14px`。但左列是栅格中最高的项（实测 910px，高于视口），`align-items: start` 下它的包含块与自身等高、没有滑动余量，那条规则是死代码——实测滚 700px 后左列 top = −355（1:1 跟随滚走），检索框彻底消失。即便它能生效，`top: 14px` 也会把检索框压到分区导航（149px 高、`z-index: 20`）底下。修法：`.rk-studio-host aside { position: static !important }` 解除整列吸顶，改为只让筛选块 `.rk-studio-host aside > div:first-child` 吸顶。
2. **根 `<main>` 的 `overflow: auto`**。`S.page` 里写了 `overflow: auto`（独立插件页时 `main` 就是滚动容器）。嵌入统一容器后真正的滚动容器是宿主 `scrollBody`，而这层 `overflow: auto` 会成为一个不再滚动的内层滚动盒，把 `<main>` 内所有 `position: sticky` 的参照系锁死在它自己身上——实测祖先链上 `MAIN of=auto`，筛选块因此 1:1 跟随滚动、吸顶完全失效。修法：`.rk-studio-host > main { overflow: visible !important }`。

该吸顶带的释放行为与另外三个分区略有不同：它的包含块只有左列（不是整个分区），因此**方法列表滚完之后会随之释放**、自然滑到导航底下。这是 sticky 的规范行为（元素不能越过其包含块），语义上也合理——列表已不在视野内时检索已无意义。

层级关系：二级 `z-index: 15` 必须低于一级 `20`，否则操作行会盖住分区切换。

真实宿主持久化验证（DSH 3080，`scrollBody` 高 557px）：

| 验证项 | 结果 |
| --- | --- |
| 四分区吸顶顶边 vs 导航底边（滚 200 / 400 / 600px） | 均为 225px，严丝合缝；灵感库 225px；方法工坊 225px；证据图谱 225px |
| 扰动导航高度 149 → 189 → 185 → 149px | 变量与吸顶位置逐次跟随 |
| 视口 1400 / 1280px | 操作行单行，带高 76px，顶边 = 导航底边 |
| 视口 1100 / 980 / 820 / 700px | 操作行折为两行（带高 126px），顶边仍 = 导航底边 |
| 视口 ≤880px（方法工坊） | 双栏栅格塌陷为单列（`grid-template-columns` = 650px 单列），筛选块在列表可见区间内恒贴住导航底（256px） |

契约由 `test/sticky-header.test.js` 守护：两级吸顶存在 + 偏移引用实测变量（不得写死 / 不得回到 `fixed`）+ 四个分区都接入（含方法工坊 vendor 侧解绑与漂移检测）+ 常驻操作在吸顶带内且不留在封面 + 层级关系 + 构建产物含锚点。

容器职责边界：只做导航与分区声明，不持有业务逻辑、不读写任何分区的数据。三个生成侧分区共享同一出口——最终都通过 `inputActions.setDraft()` / `submit()` 写入当前会话，或在宿主动作缺失时走「复制 Prompt」兜底；证据图谱是只读视图，不向会话写入任何内容。

## 3. 运行时数据流

### 3.0a 完整资源中心（统一视图 · 分区①「资源与工作流」）

统一容器 `dsh-research-kit-console` 默认落在「资源与工作流」分区。该分区是深度浏览面：顶部统一筛选全部、技能、数据库、工作流程；左侧按领域分组显示条目；右侧显示选中项详情。数据库按六个研究入口分组：文献与引文、临床与公共卫生、基因组与遗传变异、组学与表达数据、蛋白质/结构/通路、化学/药物/毒理。详情固定显示官方 URL、数据类型、稳定标识符、访问方式、查询提示、引用记录要求和当前状态（仅参考 / 需要 MCP 或 Web / 当前会话可用），不得以目录元数据暗示已完成检索。

数据库查询有两条执行路径：公开直查由插件 Node half 的 `/dsh-research-kit/query` 路由完成，所有网络请求经 DSH `ctx.web.fetch()` 发出，浏览器不持有密钥；首批适配器包括 PubMed、Crossref、OpenAlex、Semantic Scholar、Europe PMC、ClinicalTrials.gov、openFDA、UniProt 和 PubChem。另一条是显式的 Agent 调用：用户点击“让 Agent 查询”后，插件通过当前会话 `inputActions.setDraft()` 与 `inputActions.submit()` 提交带来源约束的任务，DSH Agent 自行使用可用 Web、MCP、文件与工具完成多步查询。需要订阅、API Key、受控数据协议或专用 MCP 的来源，在完成对应服务端凭据/连接器配置前走 Agent/MCP 回退，不得伪造查询结果。

### 3.0 输入框入口与资源选择器

除顶部 `conversation.view` 的“科研工作台”外，插件还必须在 DSH 输入框工具行的 `conversation.input.left` 注册两个紧凑入口：**资源**、**工作流程**。点击后由 `conversation.input.overlay` 在输入卡片上方打开选择器，避免用户离开当前聊天。两个入口是不同的面板，不能互相混入条目。

**浮层锚定契约（禁止写死视口坐标）**：`conversation.input.overlay` 的挂载点不是任意插槽，而是宿主输入卡片顶边的一条零高条——`InputBar` 的 `.overlayAnchor` 为 `position:absolute; inset:0 0 auto; height:0`，其父 `[data-composer-card]` 为 `position:relative`；槽位包装 `div[data-slot]` 是 `display:contents`，不参与布局。宿主自身的光标菜单（`/` 与 `@`）用的正是同一个锚点，其定位是 `position:absolute; bottom:calc(100% + 4px); left:0; max-width:min(537px,100%)`。

因此浮层必须同样相对锚点解算，不得出现固定像素坐标或 `100vw` / `100vh`：

| 维度 | 取值 | 依据 |
| --- | --- | --- |
| 水平位置 | `left: 0` | 与输入卡片左缘对齐（触发按钮在卡片左下工具区） |
| 垂直位置 | `bottom: calc(100% + 8px)` | 锚点高度为 0，即紧贴卡片顶边上方 8px |
| 宽度 | `min(560px, 100%)` | `100%` 解析为锚点（= 卡片内容盒）宽度，窄窗口自动收窄 |
| 高度 | 实测「锚点顶边 → 滚动区顶边」 | 见下 |

写死坐标会同时坏掉三件事：浮层左缘与触发按钮脱节（宽屏下卡片居中，浮层却停在视口左侧）；`bottom` 一旦按「猜的输入区高度」取值，就会压住输入卡片，且输入框行数增加后错位加剧；卡片宽度与居中位置随窗口变化时浮层不跟随。

**高度上限与裁剪边界**：会话滚动区（`.scrollBody`）是 `overflow: hidden auto`，浮层顶部越出其上沿的部分不可达、会被裁掉（标题与关闭按钮首当其冲）。所以可用高度取实测的「卡片顶边 → 滚动区顶边」再扣掉间隙与顶部留白，并且**裁剪边界优先于 620px 上限偏好**：空间不足时浮层变矮（内部列表仍可滚动），而不是顶着上限被裁。解算逻辑在 `src/lib/overlay-anchor.js`（纯函数 `overlayMaxHeight`，与 DOM 结构无关，可直接单测），测量与重算在 `src/composer-overlay.js`（`useLayoutEffect` + 观察卡片与滚动区 + 监听 `resize`）。锚点缺失时必须放弃测量，绝不以浮层自身矩形当锚点，否则高度会自反馈抖动。

真实 Chromium 实测（同一构建产物、同一段 DOM 结构、1180px 宽视口）：

| | 浮层 left | 卡片 left | 浮层底边与卡片顶边 | 上沿越界 |
| --- | --- | --- | --- | --- |
| 修复前（视口固定定位） | 14px | 193px | −10px（压住卡片） | 0 |
| 修复后（锚点定位） | 194px | 193px | +7px | 0 |

自适应实测：输入框加高 260px → 卡片顶边 527px→291px，浮层上限 511px→275px；滚动区压到 460px → 上限 338px；卡片收窄到 380px → 浮层宽 560px→378px；滚动区压到 300px（空间严重不足）→ 上限 178px，仍不越界。

契约由 `test/composer-overlay.test.js` 守护：可解算性（边界优先、不产生越界高度与负高度、非法输入回落上限）、定位不得回到 `fixed` / 像素偏移、宽度相对锚点、测量监听齐备。

```text
输入框左侧「资源」 / 「工作流程」
  → 自定义事件打开 conversation.input.overlay
  → 工作流程：搜索、按科研场景分类筛选并选择一个流程
  → 资源：在“全部 / 数据库 / 技能”之间切换并勾选（只记录当前会话的选择）
  → 工作流程预览弹窗：填写参数、检查 Prompt
  → 「使用工作流程」：写入 DSH 草稿，不自动发送
  → 用户可用原生回形针 / @文件补材料，再自行发送
```

资源面板底部显示已选资源 chip 清单（可单个移除或清空），输入框的“资源”入口同步显示已选数量；工作流面板底部显示当前筛选数量和“点击使用”提示。资源选择按 `sessionId` 在当前浏览器页面内共享，完整工作台和输入框浮层看到同一组资源，但不会跨会话持久化。资源选择的语义：技能将作为可见的附加指导片段；数据库只作为“当前会话具备对应工具时才可访问”的研究提示（附加时强制携带“未确认具备访问能力前，不得声称已检索”边界）。二者均不得被展示成已执行的外部调用。

### 3.0b 科研模式领域预设

工作台头部通过一个“科研模式”下拉选择领域预设：**基因遗传**、**临床队列**、**通用科研**；选择“未启用”即可关闭。这样把低频、高影响的配置从首屏按钮组收起。启用后：

- 自动附加该领域的技能组合（与工作流自身建议技能为覆盖关系：开预设按预设附加，关预设回到建议集）；
- Prompt 前统一拼接基础纪律段与领域纪律段（基因遗传含 ACMG/AMP 解读规则、组学过滤留痕、跨物种外推限制；临床队列含去标识化要求与“研究草案——非临床用途”强制标注）；
- 写入/发送/复制三个出口统一按预设组装。

预设是「指导组合」，不是能力开关——不自动执行任何工具，不改变宿主能力。

### 3.1 打开工作台与浏览资源

```text
DSH 加载 ui/client.js
  → ModuleLoader 执行 researchKitApply(ctx)
  → 在 conversation.view 注册“科研工作台”
  → 用户打开工作台
  → ResearchWorkbench 从内联 catalog 数据读取资源
  → searchCatalog({ query, type }) 返回列表
  → itemById(selectedId) 返回右侧详情
```

目录数据构建时内联进 `ui/client.js`，因此工作台首次使用不依赖网络请求。更新目录后必须重新执行 `npm run build`。

### 3.2 启动工作流

```text
用户选择工作流
  → 填写 placeholders
  → composeWorkflow(workflow, values, { enforceRequired: false })
  → Prompt 预览（保留未填字段的可读占位）
  → 用户可编辑 Prompt
  → 点击“写入”或“发送”
  → composeWorkflow(..., { enforceRequired: true }) 校验必填字段
  → inputActions.setDraft(finalPrompt)
  → [仅发送按钮] inputActions.submit()
  → DSH 将 Prompt 交给当前会话 / 当前模型 / 已配置工具
```

`finalPrompt` 的优先级是：用户编辑后的 Prompt > 根据当前字段值新组装的 Prompt。手动编辑后，字段和技能勾选的后续变更**不会**自动改写正文；UI 必须显示这一状态，并提供“恢复自动生成”操作。资源切换或当前筛选使所选条目失效时，必须切换到当前结果集的第一项并清空编辑态，避免把上一个工作流的内容错误发送。

### 3.3 文件依赖的工作流

`requiresFiles: true` 的语义是“没有材料就不应声称完成该任务”，不是插件拥有上传能力。

第一期行为：

1. UI 显示黄色材料提示；
2. Prompt 明确要求使用用户通过 DSH 原生 `@文件` 引用的材料；
3. 插件不读取、上传、复制或检查文件内容；
4. 后续只有在 DSH 提供稳定的草稿提及解析契约时，才可补充“尚未发现 `@` 引用”的软提示；该提示不得阻止写入或发送。

## 4. 目录数据契约

### 4.1 公共字段

所有条目必须具备以下字段：

```ts
type BaseItem = {
  id: string               // 全局唯一、小写 kebab-case，发布后不得随意改名
  type: 'workflow' | 'skill' | 'database'
  name: string             // 面向用户的简短中文名称
  description: string      // 一句明确用途，不得承诺未接入能力
  category: string         // 当前受控分类名称（工作流六类：论文与手稿/文献研究/基因组学/临床研究/数据分析/研究设计）
  tags: string[]           // 搜索同义词和学科标签
}
```

`id` 是收藏、历史、关联和未来迁移的稳定主键；显示名称可以调整，`id` 不应复用。

### 4.2 Workflow

```ts
type Placeholder = {
  key: string              // 匹配 Prompt 中 {key}，只允许字母、数字、-、_
  label: string            // 表单标签与报错文本
  required: boolean
  multiline?: boolean      // true 渲染 textarea
  hint?: string            // 输入提示；不能假装为默认事实
}

type Workflow = BaseItem & {
  type: 'workflow'
  prompt: string
  placeholders: Placeholder[]
  requiresFiles?: boolean
  suggestedSkillIds?: string[]
  suggestedDatabaseIds?: string[]
  limitations?: string[]
}
```

约束：

- `prompt` 中的每一个 `{key}` 必须在 `placeholders` 中声明；
- `placeholders` 中未出现在 Prompt 的字段不应存在；
- 必填字段是工作流真正无法开始的研究决策或材料描述，避免把可由 Agent 查证的信息误设为必填；
- 可选字段缺失时替换为“未指定（请按综合方式处理）”，不得留原始 `{key}`；
- `limitations` 是可见边界，例如“只形成分析计划草案，不构成统计咨询”；
- Prompt 中必须区分材料事实、待验证信息和推断；禁止要求模型捏造文献、数据、页码或实验结果。

### 4.3 Skill 与 Database

```ts
type ResearchSkill = BaseItem & {
  type: 'skill'
  guidance: string
  // 可选指导模块：勾选后以「附加指导」段落并入工作流 Prompt 末尾
  promptFragment?: string
  // 面向用户的人工检查清单，仅用于详情页展示
  checklist?: string[]
  availability: 'prompt-guidance' | 'requires-host-capability'
}

type ResearchDatabase = BaseItem & {
  type: 'database'
  accessNote: string
  url?: string             // 接口地址，详情页展示
  availability: 'reference-only' | 'requires-mcp' | 'available-in-host'
}
```

当前目录只应使用 `prompt-guidance` 和 `requires-mcp` 等保守状态。只有实现了对 DSH/MCP 能力的真实探测并覆盖自动化测试后，才允许标记 `available-in-host`。

### 4.4 关联资源与附加技能

工作流通过 `suggestedSkillIds`、`suggestedDatabaseIds` 关联参考项。关联只影响 UI 说明与后续 Prompt 指导，不代表插件已经执行该能力。

带 `promptFragment` 的技能（`prompt-guidance`）是可组合的指导模块：启动工作流时 UI 列出建议技能供用户勾选（默认勾选建议项），勾选的片段以「附加指导」列表并入 Prompt 末尾；用户随后可在预览中继续编辑。该机制只是文本拼装，不是技能执行。

缺失关联 ID 的处理规则：开发环境应在目录校验中报错；生产 UI 则跳过该项并保留工作流可用，不能导致页面崩溃。`composeWorkflow` 对未知或非技能的附加 ID 静默忽略。

## 5. Prompt 作者规范

工作流不是“科研能力的宣传文案”，而是发给当前 Agent 的执行指令。每一条工作流都应具备以下部分，按任务必要性取舍：

1. **材料与范围**：引用哪些用户提供材料，任务面向何种研究对象；
2. **执行顺序**：使用短而明确的步骤，避免泛泛的“全面分析”；
3. **证据边界**：什么必须核验，什么只能标为待确认；
4. **输出结构**：草案的主要组成和应报告的局限；
5. **禁止项**：不编造引用/数据/定位，不把推断伪装成事实；
6. **人工责任**：需要人工核验或领域专家确认的事项。

### 推荐模板

```md
请针对 {topic} 完成 {task} 草案。

材料与范围：只依据用户通过 @文件 引用的材料和已核验来源；{scope}。

按以下顺序进行：
1. …
2. …
3. …

输出：包含 …，并清楚列出不确定性、材料缺口和待人工确认项。

禁止：不得编造文献、DOI、数据、图表、页码、样本量、统计结果或作者意图。
```

### 审稿工作流的额外规范

- 未公开稿件需提醒保密与适用 AI 政策；
- 先区分“未报告”与“设计/分析不当”；
- 每条评论应当尽可能定位到章节、图、表或原文可见位置；
- 不默认建议接收或拒稿；
- 建议必须与问题规模相称，不能把所有不足都升级为“要求新实验”。

## 6. UI 状态与可访问性

### 6.1 必须覆盖的状态

| 状态 | 可见行为 |
| --- | --- |
| 初始状态 | 默认选中 `review-paper`，显示目录、详情和 Prompt 预览。 |
| 收藏视图 | 「★ 收藏」分组按收藏顺序列出；空态提示点击星标收藏。 |
| 历史视图 | 「历史」分组列出最近使用（名称、首行摘要、时间）；点击回到对应工作流；空态说明记录时机。 |
| 科研模式预设 | 点击领域按钮启用/关闭；技能勾选与纪律段随预设变化并有提示。 |
| 搜索或类型筛选 | 右侧详情必须属于当前结果集；原选中项不在结果中时，选择第一项；无结果时显示空态。 |
| 搜索无结果 | 清楚显示“没有匹配的科研资源”，且不保留错误详情。 |
| 非工作流资源 | 技能显示指导、附加片段与检查清单；数据库显示接入前提；均不显示发送按钮。 |
| 缺必填参数 | 预览可见；点击写入/发送时显示缺失字段名称且不调用 DSH。 |
| 文件依赖 | 显示原生 `@文件` 指引，不伪造上传完成状态。 |
| 手动编辑后变更字段/技能 | 显示不会自动合并的提示，并允许恢复由当前字段和技能生成的 Prompt。 |
| 缺必填参数（实时） | 预览区下方黄条列出未填必填项名称。 |
| 数据源详情 | 显示接入前提与接口地址；不显示发送按钮。 |
| 写入成功 | 仅在 `inputActions.setDraft` 真实存在并执行后，使用 `role=status` 提示已写入。 |
| 发送成功 | 仅在 `setDraft` 与 `submit` 都真实存在并执行后，使用 `role=status` 提示已发送；是否切换回聊天由宿主能力和产品决定。 |
| 宿主动作不可用 | 显示“当前 DSH 会话尚未提供输入操作”，不静默失败。 |

### 6.2 无障碍与视觉要求

- 所有可点击的资源和筛选项必须是原生 `<button>`；
- 选中态不能只依赖颜色，要有边框、文字或 `aria-pressed`；
- 表单字段必须使用 `<label>` 与可见必填说明；
- 状态反馈使用 `role="status"`；
- 窄屏布局改为单列并提供返回列表操作；
- 颜色、字体、间距应优先复用 DSH 主题变量或同级插件的基础样式，避免固定浅色背景在深色主题失效。

当前骨架仅验证了主流程，深色主题、窄屏和键盘可达性属于 Phase 1 的完成条件。

## 7. 构建与发布边界

`ui/client.js` 是适配 DSH `window.__ModuleLoader__` 的生成文件。构建脚本会：

1. 读取 `catalog/*.json`；
2. 将目录数据内联；
3. 移除源码 ESM import/export；
4. 生成以 `dsh-research-kit` 为 ModuleLoader ID 的浏览器模块。

因此**任何 `catalog/`、`src/`、`dsh/` 或构建脚本的改动**都必须重新构建并提交生成产物：

```bash
npm run build && npm run check && npm test && node --check ui/client.js
```

CI 会校验「重新构建后产物无 diff」，忘记重建会直接挂 CI。`scripts/build-client.mjs` 的 `files` 是显式白名单——**新增模块漏登记不会有任何构建报错**，产物只是少了一段代码，直到打开对应界面才 `ReferenceError`。

不要手工编辑 `ui/client.js`。如果需要引入依赖，先确认 DSH 浏览器模块是否可通过 `require()` 提供；未经验证不得把 npm 依赖直接留在浏览器源码中。

## 8. 后续扩展点

### 8.1 本地偏好与个人工作流

建议通过一个独立 `CatalogStorage` 接口接入 `localStorage`：收藏、最近使用和个人导入工作流均放在该接口后，不污染 `catalog.js` 的纯函数职责。

### 8.2 Memory Center

Memory Center 只能提供“可预览的候选上下文”。完整交互必须是：搜索 → 显示来源与文本摘要 → 用户选择 → 组装 Prompt。禁止静默把记忆注入研究任务。

### 8.3 能力探测

应由独立 `HostCapabilitiesProvider` 返回已经验证的能力，例如 `{ web: true, mcpServers: ['pubmed'] }`。目录卡片和发送前检查只读取该 provider，不能根据资源名称推断数据库已可用。

### 8.4 任务记录

若以后增加“最近运行”，记录应只保存工作流 ID、用户确认后的参数摘要、Prompt 哈希/版本和时间；不要默认保存完整论文文本、敏感数据或模型输出。
