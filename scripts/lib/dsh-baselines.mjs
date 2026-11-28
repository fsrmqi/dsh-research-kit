// 受支持 DSH 基线与宿主契约 seam 的唯一事实源。
//
// 为什么要有这个文件：`peerDependencies` 只能声明「范围」，不能证明任何东西。
// 本仓库此前用 scripts/check-dsh-app.mjs 对**单一工作树**做一次性字符串断言，且没接进 CI，
// 于是「哪些宿主接口被依赖、在哪个版本上验过」只存在于提交记录和记忆里。
// 这里把三件事收敛成一处：
//   1. BASELINES —— 声明支持哪些 DSH 发布，各自对应哪个 tag；
//   2. HOST_SEAMS —— 我们依赖的每一条宿主契约，以及它在宿主源码里的可核对位置；
//   3. PLUGIN_CONTRACTS / PLUGIN_SLOT_SOURCES —— 我们自己的接线断言，与宿主无关、永远可跑。
//
// 新增一个受支持版本 = 往 BASELINES 加一条 + 跑 `npm run baselines:fetch` + `npm test`，
// 失败信息会点名是哪条 seam 变了，而不是「某处坏了」。
//
// 基线覆盖 0.1.7 与 0.2 线已验证的 rc。更早的 0.1.5/0.1.6 线不在范围内（宿主自身的
// peer 准入会拒绝装载）。0.2.2 线的 rc.1～rc.5 均已发布；rc.5 是当前 Desktop App 与 CLI
// 随附的宿主，按 docs/COMPATIBILITY.md §6 增行（peer 范围已覆盖，无需改动）。

/** package.json 里声明的宿主版本范围；BASELINES 的每个版本都必须落在其中。 */
export const PEER_RANGE = '>=0.1.7-0 <0.1.8-0 || >=0.2.0-0 <0.2.3-0'

/** 参与 compat 矩阵的宿主基线。version 必须与 tag 指向的 package.json 一致。 */
export const BASELINES = [
  {
    id: 'dsh-v0.1.7-rc.1',
    tag: 'dsh-v0.1.7-rc.1',
    version: '0.1.7-rc.1',
    notes: '0.1.7 线首个 rc；本仓库兼容下限。',
  },
  {
    id: 'dsh-v0.1.7-rc.2',
    tag: 'dsh-v0.1.7-rc.2',
    version: '0.1.7-rc.2',
    notes: '0.1.7 线最新 rc；插件 peer 准入与 Desktop 转发按此行核对。',
  },
  {
    id: 'dsh-v0.2.0-rc.1',
    tag: 'dsh-v0.2.0-rc.1',
    version: '0.2.0-rc.1',
    notes: '0.2 线首个 rc；确认既有槽位、工具卡阶段与 Desktop 转发仍可用。',
  },
  {
    id: 'dsh-v0.2.0-rc.2',
    tag: 'dsh-v0.2.0-rc.2',
    version: '0.2.0-rc.2',
    notes: '0.2 线最新 rc；确认既有 UI 槽位、会话事件与 Desktop 转发仍可用。',
  },
  {
    id: 'dsh-v0.2.1-rc.1',
    tag: 'dsh-v0.2.1-rc.1',
    version: '0.2.1-rc.1',
    notes: '0.2.1 线首个 rc；0.2.1 的 toolview 注入面收窄与 DraftSnapshot 草稿模型首次出现，按此行核对它们未波及本插件。',
  },
  {
    id: 'dsh-v0.2.1-rc.2',
    tag: 'dsh-v0.2.1-rc.2',
    version: '0.2.1-rc.2',
    notes: '0.2.1 线第二个 rc；确认 toolview 注入面收窄、草稿模型改 DraftSnapshot 后既有 seam 仍逐字成立。',
  },
  {
    id: 'dsh-v0.2.1-rc.3',
    tag: 'dsh-v0.2.1-rc.3',
    version: '0.2.1-rc.3',
    notes: '0.2.1 线第三个 rc；宿主新增导航入口定制、视图固定与埋点（5ff2919 / 39d2903 / 6751649 等），确认未触及本插件注册的视图与槽位契约。',
  },
  {
    id: 'dsh-v0.2.1-rc.4',
    tag: 'dsh-v0.2.1-rc.4',
    version: '0.2.1-rc.4',
    notes: '0.2.1 线第四个 rc；宿主修 ACP/MCP 诊断输出与视图 tooltip（cc4446e / 41736cd / c38265a），其中 MCP 修复对本插件的 tools-only MCP server 是净收益。',
  },
  {
    id: 'dsh-v0.2.1-rc.5',
    tag: 'dsh-v0.2.1-rc.5',
    version: '0.2.1-rc.5',
    notes: '0.2.1 线最新 rc；rc.4 之后的发布分支。0.2.2-rc.1 直接从它切出，二者是线性后继关系。',
  },
  {
    id: 'dsh-v0.2.2-rc.1',
    tag: 'dsh-v0.2.2-rc.1',
    version: '0.2.2-rc.1',
    notes: '0.2.2 线首个 rc；接在 0.2.1-rc.5 之后，主机新增的客户端面与插件 API 变化见 CHANGELOG 与 docs/COMPATIBILITY.md。',
  },
  {
    id: 'dsh-v0.2.2-rc.2',
    tag: 'dsh-v0.2.2-rc.2',
    version: '0.2.2-rc.2',
    notes: '0.2.2 线第二个 rc；rc.1→rc.2 的客户端契约改动均为新增（conversation.hero.frame / conversation.chat.markdown.fence 两个 hoc 槽、composer 文件粘贴路由与失败重试、insertQuote 可选摘要、plugin-manager Git 更新入口），本插件未使用；12 条 seam + 平台表逐字成立。',
  },
  {
    id: 'dsh-v0.2.2-rc.3',
    tag: 'dsh-v0.2.2-rc.3',
    version: '0.2.2-rc.3',
    notes: '0.2.2 线第三个 rc；rc.2→rc.3 新增 sidebar.session.action hoc 槽、workspace.picker Factory（含 workspace.picker.directoryFlow）与官方可选 bundle deepseek-chat-import，本插件未注册这些面；12 条 seam + 平台表逐字成立。',
  },
  {
    id: 'dsh-v0.2.2-rc.4',
    tag: 'dsh-v0.2.2-rc.4',
    version: '0.2.2-rc.4',
    notes: '第 4 个候选版本，现有宿主契约与客户端模块检查通过。',
  },
  {
    id: 'dsh-v0.2.2-rc.5',
    tag: 'dsh-v0.2.2-rc.5',
    version: '0.2.2-rc.5',
    notes: '第 5 个候选版本，现有宿主契约与客户端模块检查通过。',
  },
]

/**
 * 宿主契约 seam。
 *
 * - `file` + `tokens`：在宿主源码里必须**逐字**存在（`git show <tag>:<file>` 或工作树读取）。
 * - `slot` / `slots`：声明该 seam 覆盖的槽位名，供「插件注册的槽位都有人看守」这条断言比对。
 *
 * 全部 seam 都是必需：宿主移除任一条都会点名失败。插件对**较新宿主能力**的降级（例如
 * 0.2.1-rc.1 起才有的「开新会话并预填草稿」通道；`whenDraftExists` 语义 rc.3 起）由运行期功能探测承担，不写成 seam ——
 * 旧基线会把「可选」当成通过，而真正该守的是「探测到才显示入口」这条接线契约（见 PLUGIN_CONTRACTS）。
 */
export const HOST_SEAMS = [
  {
    id: 'conversation-view',
    label: '对话区视图槽（统一工作台挂载点）',
    file: 'packages/client/ui-conversation/src/client/contract/views.ts',
    slot: 'conversation.view',
    tokens: ["'conversation.view'"],
  },
  {
    id: 'conversation-input-slots',
    label: '输入框左侧/右侧/浮层槽（快捷入口与选择器）',
    file: 'packages/client/ui-conversation/src/client/contract/slots.ts',
    slots: ['conversation.input.left', 'conversation.input.right', 'conversation.input.overlay'],
    tokens: ["'conversation.input.left'", "'conversation.input.right'", "'conversation.input.overlay'"],
  },
  {
    id: 'chat-assistant-actions',
    label: '回答动作行槽（审阅并沉淀）',
    file: 'packages/client/ui-chat/src/client/contract/slots.ts',
    slot: 'conversation.chat.assistant-actions',
    tokens: ["'conversation.chat.assistant-actions'"],
  },
  {
    id: 'tool-call-toolview',
    label: '工具调用详情槽（research_* 工具卡）',
    file: 'packages/client/ui-tool/src/client/contract/slots.ts',
    slots: ['tool.call.toolview'],
    tokens: ["'tool.call.toolview'", "phase: 'preparing'", "phase: 'start'", "phase: 'result'"],
  },
  {
    id: 'plugin-detail-slots',
    label: 'Plugins 详情与行配置槽（状态区/徽章/诊断动作/预设）',
    file: 'packages/client/ui-plugin-manager/src/client/slot-contract.ts',
    slots: ['plugins.detail.section', 'plugins.detail.badge', 'plugins.detail.actions', 'plugins.row.config'],
    tokens: [
      "'plugins.detail.section'",
      "'plugins.detail.badge'",
      "'plugins.detail.actions'",
      "'plugins.row.config'",
      'readonly mutate: ConfigForm<Record<string, unknown>>',
      'owner: PluginDetailProps',
      "kind: 'bundle'",
      'readonly name: string',
    ],
  },
  {
    id: 'input-contract',
    label: '输入框写入契约（setDraft / submit / 光标插入）',
    file: 'packages/client/ui-conversation/src/client/contract/input.ts',
    tokens: ['captureInsertion()', 'insertText(text: string, span: TokenSpan)', 'setDraft(text: string)'],
  },
  {
    id: 'agent-events',
    label: 'agent/created 与 agent/disposed 事件（会话模型路由缓存）',
    file: 'packages/core/agent/src/runtime-types.ts',
    tokens: ["'agent/created'", "'agent/disposed'"],
  },
  {
    id: 'desktop-app-origin',
    label: 'Desktop App 的 dsh-app:// 源与 profile 目录',
    file: 'apps/desktop/README.md',
    tokens: ['dsh-app://app/', '$DSH_HOME/profiles/desktop', 'Plugins page'],
  },
  {
    id: 'desktop-plugin-api-forward',
    label: 'Desktop 主进程的插件 API 转发',
    file: 'apps/desktop/src/main.ts',
    tokens: ["url.hostname === 'app'", 'return forwardWebRequest(request, hostUrl, hostCookie)'],
  },
  {
    id: 'desktop-request-forward',
    label: 'Desktop 文档层的请求转发（插件路由在 App 内可达）',
    file: 'apps/desktop/src/web-document.ts',
    tokens: [
      "origin !== 'dsh-app://app'",
      'target.pathname = source.pathname',
      'target.search = source.search',
      'body: request.body',
    ],
  },
  {
    // 2026-10-30 起「回到会话」改用宿主的会话导航面（此前探测的 uiConversation.openView
    // 在全部已发布基线上都不存在，已删除该探测与对应已知缺口）：
    // 先 uiWorkspace.openSession 切回当前会话，再 uiConversation.binding(id).activate(view)。
    id: 'workspace-session-navigation',
    label: '会话导航服务（Plugins 详情页「回到会话」：主区切回当前会话）',
    file: 'packages/client/ui-workspace/src/client/navigation.ts',
    tokens: ["super(ctx, 'uiWorkspace')", 'openSession(target: SessionTarget): void'],
  },
  {
    id: 'conversation-view-activation',
    label: '会话内视图激活（把工作台目标加入活跃集；不负责选中标签）',
    file: 'packages/client/ui-conversation/src/client/conversation/assembly.ts',
    tokens: [
      "super(ctx, 'uiConversation')",
      'binding(source: SessionBinding | SessionId): ConversationBinding',
      'activate(target: string): void',
    ],
  },
]

/**
 * 与本插件自身源码的接线断言（不依赖宿主，任何环境都能跑）。
 * 这些是「插件改坏了但测试没覆盖」的那类契约：路由字符串、跨层传递的 key。
 */
export const PLUGIN_CONTRACTS = [
  {
    id: 'claim-host-routes',
    label: 'Claim 审阅的宿主路由注册',
    file: 'index.js',
    tokens: [
      'webServer.register(claimReviewRoute({ logger }))',
      'webServer.register(claimAgentReviewRoute({ llm: ctx.llm, routes, logger }))',
    ],
  },
  {
    id: 'claim-app-session',
    label: 'Claim App 的会话传递',
    file: 'src/research-vault.js',
    tokens: ["h(ResearchClaimReview, { key: 'claim-review', sessionId, focusClaimId: focus?.claimId || ''"],
  },
  {
    id: 'claim-app-request',
    label: 'Claim App 的请求路径与会话参数',
    file: 'src/research-claim-review.js',
    tokens: [
      "'/dsh-research-kit/claim-review'",
      "'/dsh-research-kit/claim-agent-review'",
      'session_id=${encodeURIComponent(sessionId)}',
    ],
  },
  {
    id: 'host-navigation-wiring',
    label: '「回到会话」与「在新会话开始」的宿主服务软探测',
    file: 'dsh/standalone-glue.js',
    tokens: [
      "ctx.get?.('uiWorkspace')",
      "ctx.get?.('uiConversation')",
      // 草稿初始化通道在 `conversation` 服务上：探成 uiConversation 会让入口在任何宿主上都不渲染。
      "ctx.get?.('conversation')",
      'returnToConversation({ ...hostNavigation, view: RESEARCH_KIT_CONSOLE_VIEW })',
      'launchResearchSession(hostNavigation, input)',
      'supportsSessionLaunch(hostNavigation)',
    ],
  },
  {
    id: 'workbench-new-session-entry',
    label: '工作台「在新会话开始」入口按宿主能力降级',
    file: 'src/research-workbench.js',
    tokens: [
      "typeof launchSession === 'function'",
      "recordUse('draft', { runSessionId: '' })",
    ],
  },
  {
    id: 'model-route-selection',
    label: '会话模型路由优先读 0.2.2 的 durable 模型选择，旧宿主退回 options',
    file: 'index.js',
    tokens: [
      'readAgentSelection(agents.get(sessionId))',
      'agent?.model?.current',
      'routes.track(sessionId, agent)',
    ],
  },
]

/**
 * 插件注册槽位的源码位置：用于「注册的槽位必须都在 HOST_SEAMS 里被看守」这条断言。
 * 正则捕获组 1 即槽位名；**单双引号都认**——显式句式（本表）与目录兜底句式
 * （dsh-compat.mjs 的 SLOT_SCAN_PATTERNS）口径必须一致，否则显式表里的文件一改引号风格，
 * 槽位收集就会静默减少（兜底句式不会跑这些文件）。
 */
export const PLUGIN_SLOT_SOURCES = [
  { file: 'dsh/slot-registry.js', pattern: /slot:\s*['"]([^'"]+)['"]/g, label: '四个视图/输入框槽位' },
  { file: 'dsh/standalone-glue.js', pattern: /ctx\.slots\.inject\(\s*['"]([^'"]+)['"]/g, label: 'Plugins 页与工具卡槽位' },
  { file: 'dsh/standalone-glue.js', pattern: /name:\s*['"](tool\.call\.toolview|conversation\.chat\.assistant-actions|plugins\.detail\.[a-z]+)['"]/g, label: '键控槽位注册' },
]

/** 必需宿主契约及有独立降级路径的可选槽位。 */
export function declaredSlots() {
  const slots = new Set(['conversation.session.panel.section', 'main', 'sidebar.panellist'])
  for (const seam of HOST_SEAMS) {
    if (seam.slot) slots.add(seam.slot)
    for (const slot of seam.slots || []) slots.add(slot)
  }
  return slots
}

/**
 * 已知缺口：宿主接口存在、但本插件的接线对不上，于是某个入口永远不会出现。
 *
 * 这类问题**字符串 seam 检查查不出来**——seam 全绿而功能是死的。所以每条缺口配一个
 * `tripwire`：断言「插件里仍然写着那段对不上的代码」。一旦有人修好了，绊线测试会失败，
 * 提醒把这条缺口从本清单、docs/COMPATIBILITY.md 与 ROADMAP 里一起删掉；
 * 不修则永远有一条测试在说「这里还欠着」。
 */
export const KNOWN_GAPS = []
