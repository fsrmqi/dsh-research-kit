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

`package.json` 声明的范围是 `>=0.1.7-0 <0.1.8-0 || >=0.2.0-0 <0.2.1-0`（宿主 `engines`：`^22.19.0 || >=24.0.0`）。矩阵里每个基线版本都必须落在该范围内——这条由测试自己断言，防止「清单越写越宽、peer 范围却没收」。

新增一个受支持版本 = 在 `BASELINES` 加一条 + 拉 tag + 跑测试。失败信息会点名**哪条 seam 在哪个宿主文件里少了什么**。

## 3. 我们依赖的宿主契约

`HOST_SEAMS` 共 **11 条**（下表 10 条必需 + 1 条可选），逐条对应宿主源码里的一个文件与若干**逐字**存在的 token。CLI 报的「12 条 seam」是再加上一条动态检查（浏览器模块表能回答产物的每个 `require`），它不是 `HOST_SEAMS` 的成员：

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
| `view-navigation`（**可选**） | `.../ui-conversation/src/client/conversation/assembly.ts` | `uiConversation.openView(sessionId, view, focus?)` |

三条规则：

1. **必需 seam 失败 = 红灯**。它表示宿主移除了插件硬依赖的东西。
2. **可选 seam（`optional: true`）缺失只报告，不失败**。宿主没提供时插件必须自己降级：`view-navigation` 缺失时「打开工作台」按钮整块不渲染（留一个点了没反应的死按钮比没有更糟）。
3. **可选能力绝不写进 `dsh.client.inject`**。inject 里的名字缺失会让宿主拒绝装载**整个插件**，用户看到的是「插件不见了」；可选能力缺失只该让一个入口消失。宿主半区取用可选服务一律走 [`dsh/optional-service.js`](../dsh/optional-service.js)（`ctx.get` 不存在或抛错都退化为「不可用」）。

### 3.1 客户端 `inject` 的口径

`package.json` 的 `dsh.client.inject` 列的是**其它客户端插件行的包名**，宿主按依赖闭合解析；产物里硬编码的 `inject: ['slots', 'sessions']` 则是客户端 cordis 服务。两者口径不同，都不能塞可选服务。

## 4. 已知缺口（seam 全绿但功能是死的）

字符串 seam 有一个天然盲区：**宿主接口存在、插件接线却对不上**。这时矩阵全绿，功能却永远不出现。所以每条已知缺口都配一个**绊线断言**：断言「插件里仍然写着那段对不上的代码」。修好之后绊线会失败，逼你回来同步删掉缺口记录、本文与 ROADMAP——不修，则永远有一条测试在说「这里还欠着」。

| 缺口 | 影响 | 绊线 |
| --- | --- | --- |
| `cross-page-view-navigation` | 已发布的 0.1.7 与 `0.2.0-rc.1`/`rc.2` 均没有 `uiConversation.openView(...)`，因此 Plugins 详情页的「打开工作台」按钮不渲染；当前源码提供后，矩阵会以该公开签名报告可用；其他插件能力不受影响 | `dsh/standalone-glue.js` 里仍有 `conversationViews.openView(` |
| `phantom-client-inject` | `dsh.client.inject` 里的 `@deepseek-ai/dsh-client-runtime` 在 0.1.7-rc.1/rc.2 的工作区包名与宿主自带 `docs/dependency-catalog.json` 里都查不到；另两个注入项两处都能查到。产物实际只 require `react`/`react-dom`，故不影响装载，只是「我依赖谁」失真 | `package.json` 里仍有该字符串 |

`npm run check:dsh-app` 与 `npm test` 都会把未命中的 inject 名字打出来（警告，不失败）。

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

**离线时矩阵不跳过、也不静默通过**：`test/dsh-compat-matrix.test.mjs` 每个基线恒定 5 个用例——有源码就核对宿主，没源码就核对**降级路径本身**（跳过原因是否可读可操作、`checkHostSeams` / `checkPlatformModules` 对缺失源码是否 fail-closed、CLI 是否把误用与「没源码」都拒绝成退出码 2）。用例数因此不随环境变化（`# tests` 计不计被 skip 的 suite 会让文档数字忽 459 忽 469，`check:test-count` 在干净 clone 上必红）。CI 用 `--require-source` 把「没源码」变成硬失败。除宿主源码外，同文件里还有一组**永远可跑**的断言：基线数据自洽、seam 形状合法、插件注册的每个槽位都在矩阵里被看守、插件自身接线契约、以及上面两条缺口绊线。

## 6. 升级 DSH 的操作步骤

1. 读宿主 changelog，判断是否落在已声明的 peer 范围内；
2. 若是新版本：在 `scripts/lib/dsh-baselines.mjs` 的 `BASELINES` 加一条（tag + version + notes），必要时同步 `package.json` 的 `peerDependencies`；
3. `npm run baselines:fetch`，`npm run check:dsh-app -- --require-source`；
4. 失败项逐条处理：宿主改了名字就改 glue 层（`dsh/standalone-glue.js` 是唯一知道宿主 props 形状的文件），不要为了让检查通过而放宽 token；
5. `npm test` + 重跑 [MANUAL-QA.md](MANUAL-QA.md) 的真实 profile 清单（矩阵证明源码契约，profile 证明运行时形状）；
6. 若删掉了一条旧基线，同步删本文表格与 `BASELINES`，并在 `ROADMAP.md` 记录兼容范围变化。

## 7. 边界：这里**不**做什么

- 不引入宿主仓库的构建或类型依赖：矩阵只做 `git show tag:file` 的文本核对 + 正则抽取，离线可跑——无源码时核对的是上面的降级路径，而不是「跳过」。
- 不复制参考项目 `dsh-context` 的代码（它是 Apache-2.0，本仓库是 MIT）；借鉴的是**工程方法**（多基线矩阵、发布流水线、覆盖率棘轮），不是内容。二者的槽位取向不冲突：同一 `conversation.view` 槽可注册多个视图，`order` 只决定标签顺序——`dsh-context` 的视图 `order` 20，本仓库的科研工作台 `order` 91，可同时安装。
- 不把「源码里存在某个字符串」当成兼容性证明。矩阵是**下限保险**，真实交互验收仍是 [MANUAL-QA.md](MANUAL-QA.md)。
