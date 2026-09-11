import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  RESEARCH_CONSOLE_SECTIONS,
  DEFAULT_CONSOLE_SECTION,
  normalizeConsoleSection,
  findConsoleSection,
} from '../src/lib/console-sections.js'

// 合并三个独立视图后，「分区契约」是唯一保证不丢功能、不叠功能的依据：
// 每个分区必须声明名称、定位、核心用途、职责边界与数据归属，且导航与实现一一对应。

test('分区契约：四个分区 id 唯一，且顺序遵循科研闭环', () => {
  assert.equal(RESEARCH_CONSOLE_SECTIONS.length, 4)
  const ids = RESEARCH_CONSOLE_SECTIONS.map(section => section.id)
  assert.deepEqual(ids, ['catalog', 'methods', 'vault', 'evidence'], '分区顺序应遵循「发现 → 构造 → 沉淀 → 证据」')
  assert.equal(new Set(ids).size, ids.length, '分区 id 必须唯一')
})

test('分区契约：名称 / 定位 / 核心用途 / 职责边界 / 数据归属五要素齐全', () => {
  for (const section of RESEARCH_CONSOLE_SECTIONS) {
    for (const field of ['label', 'position', 'purpose', 'boundary', 'ownership']) {
      assert.equal(typeof section[field], 'string', `分区 ${section.id} 缺少字段 ${field}`)
      assert.ok(section[field].trim().length >= 4, `分区 ${section.id} 的 ${field} 过于简略，无法界定职责`)
    }
    // 边界必须显式表达「不做什么」，否则合并后容易出现功能重叠。
    assert.match(section.boundary, /不/, `分区 ${section.id} 的职责边界未声明否定项`)
  }
  // 数据归属互斥：同一份存储不得被两个分区同时认领。
  const owned = RESEARCH_CONSOLE_SECTIONS.map(section => section.ownership)
  assert.equal(new Set(owned).size, owned.length, '分区数据归属不得重叠')
})

test('导航不渲染迁移提示徽标：不残留「原「旧标签」」', () => {
  // 合并过渡期的「原「研究方法工坊」」徽标已按反馈移除：三个分区的旧位置映射
  // 在合并后已稳定，徽标只是常驻噪声，且会随窗口变窄换行、反过来改变导航高度
  // （而导航高度是二级吸顶的偏移量来源）。契约数据里也不应再留 formerLabel 死字段。
  const consoleSource = readFileSync(new URL('../src/research-console.js', import.meta.url), 'utf8')
  assert.doesNotMatch(consoleSource, /原「/, '统一容器仍在渲染「原「旧标签」」徽标')
  for (const section of RESEARCH_CONSOLE_SECTIONS) {
    assert.equal('formerLabel' in section, false, `分区 ${section.id} 仍保留已无消费方的 formerLabel 字段`)
  }
})

test('分区取值容错：未知或不可用输入一律回落默认分区', () => {
  assert.equal(normalizeConsoleSection('vault'), 'vault')
  assert.equal(normalizeConsoleSection('methods'), 'methods')
  assert.equal(normalizeConsoleSection('不存在'), DEFAULT_CONSOLE_SECTION)
  assert.equal(normalizeConsoleSection(''), DEFAULT_CONSOLE_SECTION)
  assert.equal(normalizeConsoleSection(undefined), DEFAULT_CONSOLE_SECTION)
  assert.equal(normalizeConsoleSection(null), DEFAULT_CONSOLE_SECTION)
  assert.equal(findConsoleSection('nope').id, RESEARCH_CONSOLE_SECTIONS[0].id)
})

test('导航与实现一一对应：每个分区都挂载了组件，不存在空分区', () => {
  const source = readFileSync(new URL('../src/research-console.js', import.meta.url), 'utf8')
  const views = [...source.matchAll(/^\s{2}([a-z]+):\s*(?:props\s*=>|\(\)\s*=>)/gm)].map(match => match[1])
  assert.deepEqual(views.sort(), RESEARCH_CONSOLE_SECTIONS.map(section => section.id).sort())
  // 四个分区各自的实现组件都必须被引用到。
  for (const component of ['ResearchWorkbench', 'ResearchPromptStudioHost', 'ResearchVaultHost', 'ResearchEvidenceGraphHost']) {
    assert.ok(source.includes(component), `统一容器未挂载分区组件：${component}`)
  }
})

test('方法工坊装配当前对话与草稿写入，不装配记忆和跨会话摘要', () => {
  const glue = readFileSync(new URL('../dsh/prompt-studio-glue.js', import.meta.url), 'utf8')
  assert.match(glue, /const messages = React\.useMemo/, '方法工坊未从当前会话构造 messages')
  assert.match(glue, /const composer = React\.useMemo/, '方法工坊未构造 composer')
  assert.match(glue, /composer,\s*\n\s*messages,/, 'PromptStudio 未收到 composer 与 messages')
  assert.doesNotMatch(glue, /getRecentSessions|searchMemory/, '方法工坊不应读取跨会话或项目记忆')
  assert.doesNotMatch(glue, /researchPromptStudioApply/, '旧的独立 slot 注册函数仍存在')
})

test('方法工坊契约不再承诺未挂载的方法关系图谱', () => {
  const methods = RESEARCH_CONSOLE_SECTIONS.find(section => section.id === 'methods')
  assert.ok(methods)
  assert.doesNotMatch(methods.purpose, /关系图谱/)
  assert.match(methods.boundary, /不检索项目记忆|不.*最近会话/)
})

test('分区嵌入契约：自带页面外壳的分区必须以 embedded 模式渲染', () => {
  // 容器自身已渲染 Page + GlobalStyle。分区若再渲染一次，产物里会出现嵌套 main.rk-page，
  // Page 的 min-height:100vh 会叠加，内容被挤出可视区并滚到标签栏背后
  // —— 该缺陷由真实 DSH profile 烟测（F2）发现，纯逻辑测试无法覆盖渲染层，故在此以源码断言守护。
  const consoleSource = readFileSync(new URL('../src/research-console.js', import.meta.url), 'utf8')
  for (const id of ['catalog', 'vault', 'evidence']) {
    const line = consoleSource.split('\n').find(row => new RegExp(`^\\s{2}${id}:`).test(row))
    assert.ok(line, `未找到分区映射：${id}`)
    assert.match(line, /embedded:\s*true/, `分区 ${id} 未以 embedded 模式渲染，会与容器形成嵌套页面外壳`)
  }
  // vault 内的证据库要将勾选来源写入当前会话输入框，必须拿到控制台收到的宿主动作。
  // 漏传时 UI 只会静默退化成禁用的「写入 Prompt」按钮，直到真实 profile 才容易暴露。
  const vaultLine = consoleSource.split('\n').find(row => /^\s{2}vault:/.test(row))
  assert.match(vaultLine, /inputActions:\s*props\.inputActions/, 'vault 分区未向 ResearchVaultHost 透传 inputActions，证据无法写入 Prompt')
  // 宿主必须把 embedded 透传给实际组件，否则上面的开关不生效。
  const vaultSource = readFileSync(new URL('../src/research-vault.js', import.meta.url), 'utf8')
  assert.match(vaultSource, /function ResearchVaultHost\(\{\s*embedded/, 'ResearchVaultHost 未接收 embedded')
  // 只断言 ResearchVault 的 props 对象里出现 embedded，不锚定属性顺序或对象结尾——
  // 原先写作 /researchAssetProvider,\s*embedded\s*\}/，多传一个 inputActions 就误报失败。
  assert.match(vaultSource, /h\(ResearchVault,\s*\{[^}]*\bembedded\b/, 'ResearchVaultHost 未把 embedded 透传给 ResearchVault')
})

test('分区宽度一致：方法工坊解绑 vendored 组件的阅读宽度上限', () => {
  // 「资源与工作流 / 研究资产库」的 embedded 根是普通块级容器，宽度铺满父级；
  // 而方法工坊复用 vendored PromptStudio，其根 <main> 内联了
  // `width: min(1240px, max(100%, calc(100vw - 280px)))` + `margin: 0 auto`——
  // 那是「独立插件页 + 为宿主侧栏预留 280px」场景的写法，嵌入统一容器后父容器
  // 已是扣除侧栏的可视区，再叠一次上限会让该分区收成居中窄栏（宽屏留白明显）。
  // vendor 为 SHA 锁定的参考实现不可改，故在宿主包装 + author 级 !important 规则解绑，
  // 在此以源码断言守护，避免后续重构把这条覆盖静默删掉。
  const vendor = readFileSync(new URL('../vendor/promptkit-embed.js', import.meta.url), 'utf8')
  assert.match(
    vendor,
    /width:\s*'min\(1240px, max\(100%, calc\(100vw - 280px\)\)\)'/,
    'vendor 的宽度上限写法已变，请复核宿主覆盖规则是否仍然必要'
  )

  const glue = readFileSync(new URL('../dsh/prompt-studio-glue.js', import.meta.url), 'utf8')
  assert.match(glue, /className:\s*'rk-studio-host'/, '方法工坊宿主未提供宽度解绑锚点 .rk-studio-host')

  const theme = readFileSync(new URL('../src/theme.js', import.meta.url), 'utf8')
  assert.match(theme, /\.rk-studio-host > main\s*\{[^}]*width:\s*100%\s*!important/, '缺少宽度解绑规则（width:100% !important）')
  assert.match(theme, /\.rk-studio-host > main\s*\{[^}]*max-width:\s*none\s*!important/, '缺少 max-width 重置规则')
  assert.match(theme, /\.rk-studio-host > main\s*\{[^}]*margin:\s*0\s*!important/, '缺少居中边距重置规则（margin:0 !important）')
  // overflow 也必须解绑：S.page 的 overflow:auto 会让 vendored <main> 成为内层滚动盒，
  // 把它内部所有 position:sticky 的参照系锁死在自身（不再滚动的盒子）上 —— 实测表现是
  // 方法工坊的吸顶筛选块 1:1 跟随滚动、完全失效。漂移检测同一份 vendor 源码。
  assert.match(vendor, /page:\s*\{[^}]*overflow:\s*'auto'/, 'vendor 的 overflow 写法已变，请复核宿主解绑规则是否仍然必要')
  assert.match(theme, /\.rk-studio-host > main\s*\{[^}]*overflow:\s*visible\s*!important/, '缺少 overflow 解绑规则，vendored 组件内的 sticky 会失效')

  // 水平内边距不得硬编码：四个分区共用同一枚流式令牌 --rk-gutter，
  // 令牌随窗口宽度收缩，窄屏由媒体查询锁定下限，避免窄窗口下挤出内容。
  const gutter = /--rk-gutter:\s*clamp\(\s*(\d+)px\s*,\s*([\d.]+)vw\s*,\s*(\d+)px\s*\)/.exec(theme)
  assert.ok(gutter, '未找到流式内边距令牌 --rk-gutter（应形如 clamp(16px, 3vw, 34px)）')
  const minGutter = +gutter[1], vwGutter = +gutter[2], maxGutter = +gutter[3]
  assert.ok(vwGutter > 0, '内边距令牌缺少视口比例项，无法随窗口自适应')
  assert.ok(minGutter < maxGutter, '内边距令牌上下限相同，失去流式收缩能力')
  assert.ok(theme.includes('padding: 20px var(--rk-gutter) 48px !important'), '方法工坊分区未使用流式内边距令牌')
  assert.ok(theme.includes(':root { --rk-gutter: 16px }'), '窄屏未锁定内边距下限')
  assert.equal(maxGutter, 34, '内边距上限应保持既有视觉刻度 34px')

  // 四个分区与容器导航条必须同刻度，否则铺满后仍会看出左缘错位。
  const EXPECTED_GUTTER_PADDING = '20px var(--rk-gutter) 48px'
  for (const file of ['research-workbench.js', 'research-vault.js', 'research-evidence-graph.js']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    const pad = /className:\s*'rk-page'[^}]*padding:\s*'([^']+)'/.exec(source)
    assert.ok(pad, `${file} 未找到 embedded 分区的内边距刻度`)
    assert.equal(pad[1], EXPECTED_GUTTER_PADDING, `${file} 的内边距未与统一容器同刻度`)
  }
  const consoleSource = readFileSync(new URL('../src/research-console.js', import.meta.url), 'utf8')
  assert.ok(consoleSource.includes('20px var(--rk-gutter) 14px'), '分区导航条内边距未引用同一枚令牌')
})
