# DSH 兼容性矩阵

这份文档回答三个问题：**这个插件声称支持哪些 DSH 版本？它依赖宿主的哪些接口？这些说法由什么证明？**

事实源只有一个文件：[`scripts/lib/dsh-baselines.mjs`](../scripts/lib/dsh-baselines.mjs)。文档、CLI（`scripts/check-dsh-app.mjs`）与测试（`test/dsh-compat-matrix.test.mjs`）都从它取数——改基线只改一处，三处同时跟着走。

## 1. 为什么需要它

`peerDependencies` 只能声明**范围**，不能证明任何事：范围写对了，插件照样可能依赖一个宿主从未提供的接口。而「宿主提供什么」是**外部事实**，会随宿主版本变化：

- 本仓库当前支持的宿主是 DSH `0.1.7` 与 `0.2` 线的已列 rc（见下表）。宿主换掉一个槽位名、改掉一个事件名，插件不会报错——它只是**静默不显示**。这类故障在真实 profile 里表现为「功能不见了」，排查成本极高。
- 因此本仓库把「依赖了宿主什么」写成可核对的清单（seam），并让 CI 拿**真实宿主源码**逐条核对。矩阵能证明的是「宿主源码里确实有这些字符串与签名」；它不能证明「运行时 props 形状一致」——那一步仍然只能由真实 profile 验收（[MANUAL-QA.md](MANUAL-QA.md)）。

## 2. 支持的基线

| 基线 tag | 宿主版本 | 为什么在清单里 |
| --- | --- | --- |
| `dsh-v0.1.7-rc.1` | `0.1.7-rc.1` | 兼容下限：`peerDependencies` 范围的下沿 |
| `dsh-v0.1.7-rc.2` | `0.1.7-rc.2` | 0.1.7 线最新 rc：peer 准入与 Desktop 转发按此行核对 |
| `dsh-v0.2.0-rc.1` | `0.2.0-rc.1` | 0.2 线首个 rc；确认既有集成仍可加载 |
| `dsh-v0.2.0-rc.2` | `0.2.0-rc.2` | 0.2 线最新 rc；确认既有 UI 槽位、会话事件与 Desktop 转发仍可用 |
| `dsh-v0.2.1-rc.1` | `0.2.1-rc.1` | 0.2.1 线首个 rc；`tool.call.toolview` 注入面收窄与 `DraftSnapshot` 草稿模型首次出现，按此行核对它们未波及本插件 |
| `dsh-v0.2.1-rc.2` | `0.2.1-rc.2` | 0.2.1 线第二个 rc；确认 toolview 注入面收窄、草稿改 `DraftSnapshot` 后既有 seam 仍逐字成立 |
| `dsh-v0.2.1-rc.3` | `0.2.1-rc.3` | 0.2.1 线第三个 rc；宿主新增导航入口定制、视图固定与埋点（`5ff2919` / `39d2903` / `6751649`），确认未触及本插件注册的视图与槽位契约 |
| `dsh-v0.2.1-rc.4` | `0.2.1-rc.4` | 0.2.1 线第四个 rc；宿主修 ACP/MCP 诊断输出与视图 tooltip（`cc4446e` / `41736cd` / `c38265a`），其中 MCP 修复对本插件的 tools-only MCP server 是净收益 |
| `dsh-v0.2.1-rc.5` | `0.2.1-rc.5` | 0.2.1 线最终 rc；0.2.2-rc.1 直接从它切出（merge-base 即本行 tag），二者是线性后继关系 |
| `dsh-v0.2.2-rc.1` | `0.2.2-rc.1` | 0.2.2 线首个 rc；客户端契约变化以新增为主（input 加 `insertQuote` / `phase:'sending'`，chat 加 `text-interaction` / `user.before`，toolview 与 view owner props 未动；另有本插件未使用的 `fileMentions` 删除与 `readAttachment` 签名调整），12 条 seam + 平台表在 rc.5→rc.1 上逐字成立；宿主 Node engines 升到 `>=24.9.0` |
| `dsh-v0.2.2-rc.2` | `0.2.2-rc.2` | 0.2.2 线第二个 rc（线性包含 rc.1）；客户端改动仍以新增为主（`hoc` 槽种与 `conversation.hero.frame` / `conversation.chat.markdown.fence`、composer 文件粘贴路由与失败重试、`insertQuote` 可选摘要、plugin-manager Git 更新入口），本插件均未使用；12 条 seam + 平台表逐字成立 |
| `dsh-v0.2.2-rc.3` | `0.2.2-rc.3` | 0.2.2 线第三个 rc（线性包含 rc.2）；新增 `sidebar.session.action` hoc 槽、`workspace.picker` Factory（含 `workspace.picker.directoryFlow`）与官方可选 bundle `deepseek-chat-import`，本插件未使用；12 条 seam + 平台表逐字成立 |
| `dsh-v0.2.2-rc.4` | `0.2.2-rc.4` | 12 条宿主契约与客户端模块表通过 |
| `dsh-v0.2.2-rc.5` | `0.2.2-rc.5` | 本机 Desktop App 与 CLI 所用版本，12 条宿主契约与客户端模块表通过 |

`package.json` 的 `peerDependencies` 与 `engines.dsh` 声明同一个范围 `>=0.1.7-0 <0.1.8-0 || >=0.2.0-0 <0.2.3-0`（`engines.dsh` 是宿主优先读取的口径：0.2.1 线自 rc.1 起就已优先读它并忽略 peer，只有 0.1.7/0.2.0 线忽略它、回落到 peer）。矩阵里每个基线版本都必须落在该范围内——这条由测试自己断言，防止「清单越写越宽、peer 范围却没收」。宿主自身的 Node `engines` 分两段：`0.1.7`～`0.2.1` 线是 `^22.19.0 || >=24.0.0`，`0.2.2` 线是 `>=24.9.0`——插件自己的 `>=22.19` 不拦，但在 0.2.2 线上跑必须是 Node 24.9+。

范围里的 `-0` 哨兵不是笔误：普通 semver 的「预发布只在同 tuple 比较器下匹配」规则会拒掉 rc，而宿主 `packages/boot/app-boot/src/plugin-compatibility.ts` 用 `includePrerelease: true` 匹配 peer 范围，`-0` 上界正是让每个小版本覆盖到自己的预发布。自查版本准入时要用 `semver.satisfies(version, range, { includePrerelease: true })`——默认参数会给出相反的结论。

**0.2.2 线已声明（自 `0.2.2-rc.1` 起）。** 该线首个 rc 于 2026-11-04 发布；peer 上界随之从 `<0.2.2-0` 放宽到 `<0.2.3-0`，`engines.dsh` 用同一范围。版本关系要注意：早先的 `0.2.2-alpha.2` 与 `0.2.1-rc.5` 曾在 rc.4 之后分叉，但 **`0.2.2-rc.1` 是从 `0.2.1-rc.5` 直接切出的发布分支**（merge-base 即 rc.5 tag 提交，中间包含 alpha.3 的依赖升级），二者线性包含，不再有「声明了 0.2.2、却不覆盖 Desktop 当前宿主」的错位。宿主 delta 审计结论：12 条 seam + 平台模块表 13/13 逐字成立；客户端契约改动以新增为主（`InputActions.insertQuote`、`InputState.phase` 加 `'sending'`、`conversation.chat.text-interaction` 与 `conversation.chat.user.before` 槽、`uiConversation.interactions` 注册表、`agent.model` durable 选择、plugin-manager 行详情返回按钮；另有 `ChatViewInjected` / `ChatNodeOwnerProps` 删除 `fileMentions` 注入、`readAttachment` 签名调整，两处本插件都未使用），本插件用到的 toolview 三阶段、`ConvViewOwnerProps`、`InputActions.setDraft/insertText/captureInsertion`、`plugins.*` props 形状均未变。两处真实影响已在本版处理：① composer seat 加 `will-change: transform` 成为 fixed 后代的 containing block，插件在 composer 槽里的 fixed 浮层（草稿增强兜底钮、沉淀伴生钮）已改为 `createPortal(document.body)`；② 模型路由改读 `agent.model.current()`（见 CHANGELOG）。跨页预选视图仍未解：rc.1 依旧没有 `openView(sessionId, view, focus)` 之类公开入口，`binding().activate()` 只激活不选标签，「回到会话」的边界不变。

**0.2.2-rc.2 已列入基线。** rc.2 在 rc.1 之后、线性包含 rc.1（`merge-base` 即 rc.1 的 tag 提交），但改动面比 rc.1 大得多（合并了 master 的整条发布列车）。逐面审计结论：**12 条 seam + 平台模块表 13/13 在 rc.2 上仍逐字成立**；客户端契约改动全部是新增，没有本插件用到的形状变化——`hoc` 槽种落地并新增 `conversation.hero.frame`（root）与 `conversation.chat.markdown.fence`（session）两个包裹层；composer 增加文档级文件粘贴路由与失败重试（`ComposerBarInjected.registerFileIntake` / `retry`、`ComposerBarOwnerProps.occurrence`）；`InputActions.insertQuote` / `DraftQuote` 增加可选 `summary`（草稿正文与发送内容仍用 `text`）；plugin-manager 增加 Git 更新入口（`PluginTabProps.update`、`BundleInfo.update: 'registry' | 'git'`）；sidebar / settings / approval 的 `hooks` 与选装字段也各有新增。Server 侧新增 agent-team、office 工具、MCP manager 与 `wsl` 平台准入，均不触及本插件的注册面。本插件用到的 toolview 三阶段、`ConvViewOwnerProps`、`InputActions.setDraft/insertText/captureInsertion`、`plugins.detail.*` / `plugins.row.config` props 形状未变；rc.1 上处理的两处真实影响（composer portal、`agent.model.current()`）在 rc.2 上同样成立且已保留。跨页预选视图边界同 rc.1。

**0.2.2-rc.3 已列入基线。** rc.3 在 rc.2 之后、线性包含 rc.2；改动面集中在官方可选 bundle 与 ui 槽位新增：`sidebar.session.action`（root hoc，包裹 New-session 行内容）、`workspace.picker` Factory（root，含 `workspace.picker.directoryFlow`），以及新的官方实验性可选 bundle `deepseek-chat-import`（导入 DeepSeek 网站聊天导出，使用上述两个槽位）；另有图标、CI 与 tsconfig 调整。本插件不注册 sidebar/workspace 槽，也不使用 chat-import；**12 条 seam + 平台模块表 13/13 在 rc.3 上仍逐字成立**，本插件用到的 toolview 三阶段、`ConvViewOwnerProps`、`InputActions.setDraft/insertText/captureInsertion`、`plugins.detail.*` / `plugins.row.config` props 形状未变；rc.1/rc.2 处理的两处适配继续生效。跨页预选视图边界同 rc.1。

新增一个受支持版本 = 在 `BASELINES` 加一条 + 拉 tag + 跑测试。失败信息会点名**哪条 seam 在哪个宿主文件里少了什么**。

## 3. 我们依赖的宿主契约

`HOST_SEAMS` 共 **12 条**（全部必需），逐条对应宿主源码里的一个文件与若干**逐字**存在的 token。CLI 报的「13 条 seam」是再加上一条动态检查（浏览器模块表能回答产物的每个 `require`），它不是 `HOST_SEAMS` 的成员：

| seam | 宿主位置 | 覆盖的槽位/能力 |
| --- | --- | --- |
| `conversation-view` | `packages/client/ui-conversation/src/client/contract/views.ts` | `conversation.view`（统一工作台挂载点） |
| `conversation-input-slots` | `.../ui-conversation/src/client/contract/slots.ts` | `conversation.input.left/right/overlay` |
| `chat-assistant-actions` | `packages/client/ui-chat/src/client/contract/slots.ts` | `conversation.chat.assistant-actions` |
| `tool-call-toolview` | `packages/client/ui-tool/src/client/contract/slots.ts` | `tool.call.toolview`（含 `preparing/start/result` 三阶段） |
| `plugin-detail-slots` | `packages/client/ui-plugin-manager/src/client/slot-contract.ts` | `plugins.detail.section/badge/actions`、`plugins.row.config` 与配置表写入 |
| `input-contract` | `.../ui-conversation/src/client/contract/input.ts` | `captureInsertion()` / `insertText()` / `setDraft()` |
| `agent-events` | `packages/core/agent/src/runtime-types.ts` | `agent/created`、`agent/disposed` |
| `desktop-app-origin` | `apps/desktop/README.md` | `dsh-app://app/` 源与 Desktop profile 目录 |
| `desktop-plugin-api-forward` | `apps/desktop/src/main.ts` | Desktop 主进程的插件 API 转发 |
| `desktop-request-forward` | `apps/desktop/src/web-document.ts` | 文档层请求转发（插件路由在 App 内可达） |
| `workspace-session-navigation` | `packages/client/ui-workspace/src/client/navigation.ts` | `uiWorkspace.openSession(target: SessionTarget)`（「回到会话」把主区切回当前会话） |
| `conversation-view-activation` | `.../ui-conversation/src/client/conversation/assembly.ts` | `uiConversation.binding(source)` + `ConversationBinding.activate(target)`（把工作台视图加入会话活跃目标集） |

三条规则：

1. **seam 失败 = 红灯**。它表示宿主移除了插件硬依赖的东西。
2. **较新能力的降级不写成可选 seam，写成交接契约**。宿主 0.2.1-rc.1 才提供「开新会话并预填草稿」（`startSession` 的 `prompt` 加上 **`conversation` 服务**的 `input.requestDraftInitialization`；`whenDraftExists` 语义自 0.2.1-rc.3 起），`0.1.7` / `0.2.0` 线没有该通道，该线旧宿主上这个入口必须整块不渲染（`0.2.1-rc.1` / `rc.2` 会渲染，只是不识别 `whenDraftExists`）。若把它写成 `optional: true` 的 seam，旧基线上它会恒绿，反而掩盖「宿主补上了却没人用」；因此它由 `PLUGIN_CONTRACTS` 的 `host-navigation-wiring` / `workbench-new-session-entry` 看守——断言 glue 里**仍然**同时探测 `startSession` 与 `requestDraftInitialization`、且 UI 按 `typeof launchSession === 'function'` 决定是否渲染入口。一条永远打 ○ 的 seam 会让人误以为它还在看守什么。
3. **可选能力绝不写进 `dsh.client.inject`**。inject 里的名字缺失会让宿主拒绝装载**整个插件**，用户看到的是「插件不见了」；可选能力缺失只该让一个入口消失。宿主半区取用可选服务一律走 [`dsh/optional-service.js`](../dsh/optional-service.js)（`ctx.get` 不存在或抛错都退化为「不可用」）；浏览器半区同理，`uiWorkspace` / `uiConversation` / `conversation` 都只经 `ctx.get?.()` 软探测。

**客户端半只有一份：Web 与 Desktop App 共用同一个 `ui/client.js`。** App 是 Electron 外壳，加载打包后的同一份客户端（`dsh-app://app/`，默认 19387），把应用请求转发给本机 Web Host（`dsh-app` 被注册成 standard + secure + supportFetchAPI 的自定义协议，所以相对路由的 `fetch`、剪贴板与 `crypto.subtle` 在 App 内都可用）。因此上表里的客户端槽位 seam 对两种形态同样有效，App 专有的只有 `desktop-app-origin` / `desktop-plugin-api-forward` / `desktop-request-forward` 三条；也正因为源形态不同，客户端**不得**假定页面源是 http(s)：相对路由与 `location.href` 基准是唯一与宿主形态无关的写法，`test/build-client.test.js` 会拦下写死的绝对请求地址、按 `location.protocol/host/port` 分支、以及用页面 origin 当 URL 基准的写法。

### 3.1 客户端 `inject` 的口径

`package.json` 的 `dsh.client.inject` 列的是**其它客户端插件行的包名**，宿主按依赖闭合解析；产物里硬编码的 `inject: ['slots', 'sessions']` 则是客户端 cordis 服务。两者口径不同，都不能塞可选服务。

## 4. 已知缺口（seam 全绿但功能是死的）

字符串 seam 有一个天然盲区：**宿主接口存在、插件接线却对不上**。这时矩阵全绿，功能却永远不出现。所以每条已知缺口都配一个**绊线断言**：断言「插件里仍然写着那段对不上的代码」。修好之后绊线会失败，逼你回来同步删掉缺口记录、本文与 ROADMAP——不修，则永远有一条测试在说「这里还欠着」。

客户端注入声明已清理，并由矩阵逐版本核对。

宿主声明 `conversation.session.panel.section` 时，会话面板显示该会话关联的科研项目与待审核论断。宿主提供会话级 `addReferences` 时，项目首页可把工作区内相对文件路径添加到该会话草稿。两个入口独立探测。

MCP 按需加载模式下，宿主加载器表明服务器已连接。项目记忆面板需要全局可见的检索工具；可在会话里由 Agent 加载后检索，或把对应服务器设为预加载。

**详情页「回到会话」走的是哪条通道（0.3.0 已修）**：旧接线找的是服务级方法 `uiConversation.openView(sessionId, view, focus?)`，它在全部已列基线上都不存在——宿主真正的导航面是 `uiWorkspace.openSession(target)`（切回主区）+ `uiConversation.binding(source).activate(target)`（把目标视图加入会话活跃目标集），这两条自 0.1.7 起就有。现在由 [`src/lib/host-navigation.js`](../src/lib/host-navigation.js) 组合：先从会话列表快照里取 `retainedBy.mainView > 0` 的会话（宿主内置客户端也这么取），`openSession` 同步 retain 后再 `binding(id).activate('dsh-research-kit-console')`。顺序不可交换：先 `binding` 会因会话未激活而抛错。由此删掉了 `cross-page-view-navigation` 缺口与 `view-navigation` 探测，两条真实 API 升级为必需 seam（见 §3）。

**为什么按钮写「回到会话」而不是「打开工作台」**：`activate(target)` 只把目标加入会话的**活跃目标集**（让数据源开始工作），渲染哪个视图由宿主会话 store 的 `s.view` 决定，而 `s.view` 的写入口只在宿主自己的会话头部组件里（`apply.ts` 的 `selectView`，插件拿不到跨页句柄）。因此从 Plugins 页跨页跳转时只能保证「主区切回当前会话」：该会话上次停在科研工作台（宿主已持久化这个选择）时会随之恢复，否则落在默认对话视图。不承诺选标签是**故意**的——承诺了就会变成一个「点了没反应」的边缘。若将来宿主提供公开的跨页视图选择入口，再改文案与这一节。

**会话视图的发现性不再由插件负责**：0.2.1-rc.3 起宿主把未固定（pin）的视图收进会话标签栏的「更多会话视图」菜单；宿主同时向注册的视图操作行注入 `onOpen` / `onPinnedChange`，固定与否由宿主 UI 决定（当前内置 UI 还没有消费 pin 的入口）。插件只需正常注册 `conversation.view`，**不注册任何视图导航行**。

**「在新会话开始」（0.2.1-rc.1+）**：工作台的第三个出口把同一份组装结果交给宿主 `uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' })`，由宿主经 `conversation.input.requestDraftInitialization` 预填为草稿（不自动发送，附件始终保留）。通道自 0.2.1-rc.1 起存在；`whenDraftExists` 自 0.2.1-rc.3 起被识别，更早宿主按「已有草稿则保留」处理（本入口新开的会话草稿为空，照常预填）。`0.1.7` / `0.2.0` 线完全没有该通道，因此该线不渲染入口（探测必须同时看 `uiWorkspace.startSession` 与 **`conversation` 服务**的 `input.requestDraftInitialization`——别探成 `uiConversation`，它没有 `input`）。它不新增宿主 seam（旧基线无法核对它），由 §3 规则 2 描述的接线契约看守。

## 5. 怎么跑

```bash
npm run baselines:fetch                                   # 拉基线 tag 到 .tmp/dsh-repo（浅克隆）
npm run check:dsh-app                                     # 无参数 = 核对全部基线
npm run check:dsh-app -- --require-source                 # 缺源码、或源码无法自证即失败（CI 用，防止静默降级）
npm run check:dsh-app -- --require-source --allow-unverified-source   # 明知是已解包副本（未绑 git）仍要跑严格模式
node scripts/check-dsh-app.mjs /path/to/fork --allow-dirty            # 明知工作树有未提交改动仍要核对
npm run check:dsh-app -- ~/dev/deepseek-harness           # 核对本地工作树（按 package.json 版本匹配基线）
npm test                                                  # 含 test/dsh-compat-matrix.test.mjs
```

退出码：

| 码 | 含义 |
| --- | --- |
| `0` | 全部核对通过；**或者**未找到任何源码且没加 `--require-source`（明确跳过，输出里会打印 `○ 跳过 …`） |
| `1` | 有必需 seam、平台模块表、版本自证或插件自身契约失败 |
| `2` | 用法/前置条件错误：未知参数、路径不存在、工作树版本不在基线里、工作树有未提交改动（未加 `--allow-dirty`）、HEAD 不是该基线 tag 的提交；`--require-source` 下少任何一个基线的源码、或源码未自证（未加 `--allow-unverified-source`）也归此类 |

`--require-source` 的语义是「**每个**声明的基线都真的核对过」，不是「至少核对了一个」——少一个就退出 2 并点名缺哪个。未知参数（例如把 `--require-source` 拼错）同样直接退出 2，不允许静默降级成跳过：CI 只看退出码，静默跳过等于门禁消失。

**源码自证（哪份源码才算「那个发布」）**：git 源（第 1~3 条）的内容由 `git show <tag>:<file>` 取出，天然绑在 tag 的提交上，算**已自证**；第 4 条已解包副本与工作树副本里的 `package.json` 是**人写的**，改一个 `version` 就能冒充基线，所以只算**未自证**——默认模式会打印 `○ 源码来源未自证` 并如实说明原因，`--require-source` 则直接退出 2（除非显式传 `--allow-unverified-source`）。工作树模式是 git 仓库时还会要求：工作树干净（否则退出 2，除非 `--allow-dirty`）、HEAD 就是该基线 tag 的提交（tag 不在本地时打印警告说明绑不上）。这样「拿任意一份改过 version 的副本跑 CI 式核对」不再可能冒充发布验证。

源码解析顺序（`scripts/lib/dsh-compat.mjs` 的 `resolveDshRepo` 与 `sourceForBaseline`）：

1. `$DSH_REPO`（指向宿主仓库或工作树）；
2. `.tmp/dsh-repo`（`npm run baselines:fetch` 的落点，CI 用）；
3. `~/dev/deepseek-harness`（本机常见克隆位置）；
4. `.tmp/dsh-tags/<基线 id>`（离线时把基线 tag 解包成工作树；也可用 `DSH_TAGS_DIR` 改目录）——本机没网、没克隆时靠这一条，前三处都找不到它才生效。

**离线时矩阵不跳过、也不静默通过**：`test/dsh-compat-matrix.test.mjs` 每个基线恒定 4 个用例——有源码就核对宿主，没源码就核对**降级路径本身**（跳过原因是否可读可操作、`checkHostSeams` / `checkPlatformModules` 对缺失源码是否 fail-closed、CLI 是否把误用与「没源码」都拒绝成退出码 2）。用例数因此不随环境变化（`# tests` 计不计被 skip 的 suite 会让文档数字忽 459 忽 469，`check:test-count` 在干净 clone 上必红）。CI 用 `--require-source` 把「没源码」变成硬失败。除宿主源码外，同文件里还有一组**永远可跑**的断言：基线数据自洽、**基线清单冻结**（新增/删除基线必须同步本条清单与文档里的「N 个基线」）、seam 形状合法、插件注册的每个槽位都在矩阵里被看守、插件自身接线契约、**Plugins 行配置注册 key 必须等于 `<包名>#<patch row id>`**、以及已知缺口绊线。

## 6. 升级 DSH 的操作步骤

1. 读宿主 changelog，判断是否落在已声明的 peer 范围内；
2. 若是新版本：在 `scripts/lib/dsh-baselines.mjs` 的 `BASELINES` 加一条（tag + version + notes），必要时同步 `package.json` 的 `peerDependencies` 与 `engines.dsh`（两边必须逐字一致，测试会断言）；
3. `npm run baselines:fetch`，`npm run check:dsh-app -- --require-source`；
4. 失败项逐条处理：宿主改了名字就改 glue 层（`dsh/standalone-glue.js` 是唯一知道宿主 props 形状的文件），不要为了让检查通过而放宽 token；
5. `npm test` + 重跑 [MANUAL-QA.md](MANUAL-QA.md) 的真实 profile 清单（矩阵证明源码契约，profile 证明运行时形状）；
6. 若删掉了一条旧基线，同步删本文表格与 `BASELINES`，并在 `ROADMAP.md` 记录兼容范围变化。

## 7. 边界：这里**不**做什么

- 不引入宿主仓库的构建或类型依赖：矩阵只做 `git show tag:file` 的文本核对 + 正则抽取，离线可跑——无源码时核对的是上面的降级路径，而不是「跳过」。
- 不复制参考项目 `dsh-context` 的代码（它是 Apache-2.0，本仓库是 MIT）；借鉴的是**工程方法**（多基线矩阵、发布流水线、覆盖率棘轮），不是内容。二者的槽位取向不冲突：同一 `conversation.view` 槽可注册多个视图，`order` 只决定标签顺序——`dsh-context` 的视图 `order` 20，本仓库的科研工作台 `order` 91，可同时安装。
- 不把「源码里存在某个字符串」当成兼容性证明。矩阵是**下限保险**，真实交互验收仍是 [MANUAL-QA.md](MANUAL-QA.md)。
