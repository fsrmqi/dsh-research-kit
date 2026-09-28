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
// 基线为什么是这两个：peer 范围是 >=0.1.7-0 <0.1.8-0，因此 0.1.7 线的两个 rc 都是
// 运行时承诺要支持的对象；更早的 0.1.5/0.1.6 线不在范围内（宿主自身的 peer 准入会拒绝装载）。

/** package.json 里声明的宿主版本范围；BASELINES 的每个版本都必须落在其中。 */
export const PEER_RANGE = '>=0.1.7-0 <0.1.8-0'

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
    notes: '0.1.7 线当前最新 rc；插件 peer 准入与 Desktop 转发按此行核对。',
  },
]

/**
 * 宿主契约 seam。
 *
 * - `file` + `tokens`：在宿主源码里必须**逐字**存在（`git show <tag>:<file>` 或工作树读取）。
 * - `optional: true`：宿主不提供时插件只是不显示对应入口，因此「缺失」不算失败，
 *   只如实报告可用性（不把可选能力写成必选依赖）。
 * - `slot`：声明该 seam 覆盖的槽位名，供「插件注册的槽位都有人看守」这条断言比对。
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
    label: 'Plugins 详情页三个槽与 subject 形状（状态区/徽章/诊断动作）',
    file: 'packages/client/ui-plugin-manager/src/client/slot-contract.ts',
    slots: ['plugins.detail.section', 'plugins.detail.badge', 'plugins.detail.actions'],
    tokens: [
      "'plugins.detail.section'",
      "'plugins.detail.badge'",
      "'plugins.detail.actions'",
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
    id: 'view-navigation',
    label: '跨页视图导航（Plugins 详情页「打开工作台」；宿主未提供时按钮整块不渲染）',
    file: 'packages/client/ui-conversation/src/client/conversation/assembly.ts',
    tokens: ['super(ctx, \'uiConversation\')', 'binding(source: SessionBinding | SessionId): ConversationBinding', 'activate(target: string): void'],
    optional: true,
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
    tokens: ["h(ResearchClaimReview, { key: 'claim-review', sessionId })"],
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
]

/**
 * 插件注册槽位的源码位置：用于「注册的槽位必须都在 HOST_SEAMS 里被看守」这条断言。
 * 正则捕获组 1 即槽位名。
 */
export const PLUGIN_SLOT_SOURCES = [
  { file: 'dsh/slot-registry.js', pattern: /slot:\s*'([^']+)'/g, label: '四个视图/输入框槽位' },
  { file: 'dsh/standalone-glue.js', pattern: /ctx\.slots\.inject\('([^']+)'/g, label: 'Plugins 页与工具卡槽位' },
  { file: 'dsh/standalone-glue.js', pattern: /name:\s*'(tool\.call\.toolview|conversation\.chat\.assistant-actions|plugins\.detail\.[a-z]+)'/g, label: '键控槽位注册' },
]

/** HOST_SEAMS 声明的全部槽位名。 */
export function declaredSlots() {
  const slots = new Set()
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
export const KNOWN_GAPS = [
  {
    id: 'cross-page-view-navigation',
    label: 'Plugins 详情页「打开工作台」按钮在 0.1.7 线上永不渲染',
    evidence:
      'dsh/standalone-glue.js 适配的是 uiConversation.openView(sessionId, view, focus)，'
      + '而 0.1.7-rc.1/rc.2 两行的实际导航面是 uiConversation.binding(source: SessionBinding | SessionId) '
      + '+ ConversationBinding.activate(target: string)（packages/client/ui-conversation/src/client/conversation/assembly.ts），'
      + '没有 openView。探测恒为 undefined，按钮整块不渲染——不是崩，是静默缺席。',
    tripwire: { file: 'dsh/standalone-glue.js', token: 'conversationViews.openView(' },
    trackedIn: 'ROADMAP.md',
  },
  {
    id: 'phantom-client-inject',
    label: 'package.json 的 dsh.client.inject 含一个宿主查无此名的模块',
    evidence:
      'dsh.client.inject 写的是其它客户端插件行的包名，宿主按依赖闭合解析。'
      + '@deepseek-ai/dsh-client-runtime 在 0.1.7-rc.1/rc.2 的工作区包名里不存在，'
      + '在宿主自带的 docs/dependency-catalog.json（@deepseek-ai/dsh@0.1.5-rc.1 的安装闭合）里同样不存在；'
      + '另两个注入项（ui-conversation / ui-tool）两处都能查到。'
      + '客户端产物实际 require 的只有 react / react-dom，因此该条目不影响装载，只是「我依赖谁」失真。',
    tripwire: { file: 'package.json', token: '"@deepseek-ai/dsh-client-runtime"' },
    trackedIn: 'docs/COMPATIBILITY.md',
  },
]
