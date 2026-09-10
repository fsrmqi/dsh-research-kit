import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// 顶部吸顶契约：一级 = 统一容器的分区导航，二级 = 各分区自己的操作行
// （检索 / 筛选 / 模式 / 主操作）。
//
// 分层原则：吸顶只放「随时要用的操作」，不放「读一次就够的内容」。
// 分区标题与导语留在封面、随页面滚走——标题与导航里的当前分区标签重复、导语只读一次，
// 吸住要多占约 87px 并放大重复感；而检索、类型筛选、科研模式、新建资产这类控件必须常驻。
// 四个分区一律按此分层，不允许出现「一个吸、其余不吸」。
//
// 契约一旦被重构破坏，表现是「滚下去以后搜不到东西 / 要滚回顶部才能切模式」，
// 不改也不报错，因此必须钉住。

// 取某个组件调用（到行首四空格缩进的闭合 `}),` / `]),`）的源码块，
// 避免用全文件 indexOf 被同名文案（如 SCIENCE_MODE_BASE 里的「科研模式」）误导。
const callBlock = (source, name) => {
  const match = new RegExp(`h\\(${name},[\\s\\S]*?\\n {4}(?:\\}\\)|\\]\\),)`).exec(source)
  assert.ok(match, `未找到 ${name} 的调用块`)
  return match[0]
}

// 结尾兼容 `]),` 与 `]) : null,`：吸顶带可能被三元条件包裹（例如沉淀层的
// 灵感资产 / 证据库子模块切换），只要调用本身仍是 sticky:true 的 Toolbar，契约就成立。
const toolbarBlock = (source, key) => {
  const match = new RegExp(`h\\(Toolbar,\\s*\\{\\s*key:\\s*'${key}',\\s*sticky:\\s*true\\s*\\},[\\s\\S]*?\\n {4}\\](?:\\),|\\)\\s*:\\s*null,)`).exec(source)
  assert.ok(match, `未找到 key: '${key}' 的二级吸顶带调用块`)
  return match[0]
}

test('一级吸顶：分区导航常驻，并把实测高度写入 CSS 变量', () => {
  const source = read('src/research-console.js')
  assert.match(source, /className:\s*'rk-console-nav'/, '统一容器缺少分区导航锚点 .rk-console-nav')
  assert.match(
    source,
    /className:\s*'rk-console-nav',\s*\n\s*style:\s*\{\s*\n\s*position:\s*'sticky',\s*top:\s*0/,
    '分区导航未吸顶（应为 position:sticky + top:0，相对宿主 scrollBody 解算）'
  )
  // 一级导航高度是二级吸顶的偏移量来源，必须实测而非猜值。
  assert.match(source, /setProperty\('--rk-console-nav-h'/, '未把导航实测高度写入 --rk-console-nav-h')
  // 必须显式观察 border-box：默认的 content-box 对内边距/边框变化不敏感，
  // 会漏掉「说明块换行把导航撑高」这类变化，二级吸顶就会停在旧位置。
  assert.match(source, /observe\(nav,\s*\{\s*box:\s*'border-box'\s*\}\)/, '未按 border-box 观察导航，内边距变化不会触发重算')
  assert.match(source, /ResizeObserver/, '未监听导航尺寸变化：窗口变窄换行后二级吸顶会错位')
  assert.match(source, /removeProperty\('--rk-console-nav-h'\)/, '卸载时未清理偏移量变量，会污染独立挂载场景')
})

test('二级吸顶：操作行的偏移取实测变量，且不得退回视口固定写法', () => {
  const theme = read('src/theme.js')
  const rule = /\.rk-sticky-toolbar\s*\{([^}]*)\}/.exec(theme)
  assert.ok(rule, '缺少 .rk-sticky-toolbar 规则')
  const body = rule[1]
  assert.match(body, /position:\s*sticky/, '操作行未吸顶')
  assert.match(body, /top:\s*var\(--rk-console-nav-h/, '二级吸顶偏移未引用导航实测高度')
  assert.match(body, /background:\s*var\(--rk-canvas\)/, '二级吸顶带无背景，滚动内容会透出')
  // 垂直节奏由内边距承接：外边距区域不绘制背景，吸顶后会漏出滚动内容。
  assert.match(body, /padding:\s*\d+px\s+0\s+\d+px/, '吸顶带未用内边距承接原外边距的垂直节奏')
  assert.match(body, /margin:\s*0/, '吸顶带仍保留外边距')
  assert.doesNotMatch(body, /position:\s*fixed/, '二级吸顶不得改回视口固定定位')
  assert.doesNotMatch(body, /top:\s*\d+px/, '二级吸顶偏移不得写死像素')
})

test('四个分区都接入二级吸顶，吸顶态由 Toolbar 统一挂锚点', () => {
  for (const file of ['research-workbench.js', 'research-vault.js', 'research-evidence-graph.js']) {
    const source = read(`src/${file}`)
    assert.match(source, /h\(Toolbar,\s*\{\s*key:\s*'[a-z]+',\s*sticky:\s*true\s*\}/, `${file} 的操作行未接入二级吸顶`)
  }
  const ui = read('src/ui.js')
  assert.match(ui, /sticky\s*=\s*false/, 'Toolbar 未提供 sticky 开关')
  assert.match(ui, /className:\s*sticky\s*\?\s*'rk-sticky-toolbar'/, 'Toolbar 未在吸顶态挂上锚点类名')
  assert.match(ui, /margin:\s*sticky\s*\?\s*0\s*:\s*'18px 0 14px'/, 'Toolbar 吸顶态未让出外边距')
})

test('方法工坊接入二级吸顶：先解除 vendored 左列的死 sticky，再让筛选块吸顶', () => {
  // vendor 把筛选块与整个方法列表放进同一列 <aside>，并给这一列写了
  // `position: sticky; top: 14px`。但左列是栅格中最高的项（实测 910px，高于视口），
  // align-items: start 下它的包含块与自身等高、没有滑动余量 —— 那条规则是死代码：
  // 实测滚 700px 后左列 top=-355（1:1 跟随滚走），检索框彻底消失。
  // 这里先钉住 vendor 的写法（漂移检测），再钉住宿主的两条解绑规则。
  const vendor = read('vendor/promptkit-embed.js')
  assert.match(
    vendor,
    /h\('aside',\s*\{\s*key:\s*'methods',\s*style:\s*\{\s*position:\s*'sticky'/,
    'vendor 左列的 sticky 写法已变，请复核宿主解绑规则是否仍然必要'
  )
  assert.match(vendor, /h\('div',\s*\{\s*key:\s*'filter'/, 'vendor 的筛选块结构已变，:first-child 选择器需复核')

  const theme = read('src/theme.js')
  assert.match(
    theme,
    /\.rk-studio-host aside\s*\{\s*position:\s*static\s*!important/,
    '未解除 vendored 左列的死 sticky，子级筛选块不会吸顶'
  )
  const rule = /\.rk-studio-host aside > div:first-child\s*\{([^}]*)\}/.exec(theme)
  assert.ok(rule, '缺少方法工坊筛选块的吸顶规则')
  const body = rule[1]
  assert.match(body, /position:\s*sticky\s*!important/, '方法工坊筛选块未吸顶')
  assert.match(body, /top:\s*var\(--rk-console-nav-h/, '方法工坊筛选块未复用导航实测高度，会压到分区导航底下')
  assert.match(body, /background:\s*var\(--rk-canvas\)/, '方法工坊吸顶带无背景，滚动的方法列表会透出')
  assert.match(body, /padding:\s*\d+px\s+0\s+\d+px\s*!important/, '未用内边距承接垂直节奏')
  assert.match(body, /margin-bottom:\s*0\s*!important/, '未清零 vendored 内联的 margin-bottom，吸顶带会漏出缝隙')
  // 层级必须与另两个分区的吸顶带同级，且低于一级导航。
  const stickyZ = Number(/\.rk-sticky-toolbar\s*\{[^}]*z-index:\s*(\d+)/.exec(theme)[1])
  const methodsZ = Number(/z-index:\s*(\d+)/.exec(body)[1])
  assert.equal(methodsZ, stickyZ, '方法工坊吸顶带与另两个分区的层级不一致')
})

test('分层原则：分区级常驻操作下沉到吸顶带，封面只留标题、导语与低频动作', () => {
  // 「科研模式」原先挂在分区封面右侧，随页面滚走（实测滚 800px 后 top=-555），
  // 每次确认或切换预设都得先滚回顶部；同理「新建资产」是灵感库最高频的主操作。
  // 两者都是常驻控件，必须落在二级吸顶带内。
  // 而导出/恢复备份是一次性维护动作，留在封面即可，不该占用常驻高度。
  const cases = [
    { file: 'research-workbench.js', toolbar: 'toolbar', marker: "'科研模式',", headKeeps: null },
    { file: 'research-vault.js', toolbar: 'filters', marker: "'新建资产'", headKeeps: '导出备份' },
  ]
  for (const { file, toolbar, marker, headKeeps } of cases) {
    const source = read(`src/${file}`)
    const head = callBlock(source, 'PageHead')
    assert.equal(head.includes(marker), false, `${file} 的常驻控件仍留在封面，会随页面滚走`)
    if (headKeeps) {
      assert.ok(head.includes(headKeeps), `${file} 的低频动作被误移出封面`)
    } else {
      assert.doesNotMatch(head, /actions:\s*\[/, `${file} 的分区封面仍渲染操作，操作应全部下沉到吸顶带`)
    }
    assert.ok(toolbarBlock(source, toolbar).includes(marker), `${file} 的常驻控件未放进二级吸顶带`)
  }
})

test('层级：二级吸顶必须低于一级导航，避免盖住分区切换', () => {
  const theme = read('src/theme.js')
  const stickyZ = Number(/\.rk-sticky-toolbar\s*\{[^}]*z-index:\s*(\d+)/.exec(theme)[1])
  const consoleSource = read('src/research-console.js')
  const navZ = Number(/rk-console-nav'[\s\S]{0,200}?zIndex:\s*(\d+)/.exec(consoleSource)[1])
  assert.ok(Number.isFinite(stickyZ) && Number.isFinite(navZ), '未找到吸顶层级定义')
  assert.ok(stickyZ < navZ, `二级吸顶 z-index(${stickyZ}) 必须低于一级导航(${navZ})`)
})

test('构建产物确实带上了二级吸顶的锚点与规则', () => {
  const client = read('ui/client.js')
  assert.ok(client.includes('rk-sticky-toolbar'), '构建产物缺少 .rk-sticky-toolbar 锚点')
  assert.ok(client.includes('--rk-console-nav-h'), '构建产物缺少偏移量变量')
  assert.ok(client.includes('.rk-studio-host aside'), '构建产物缺少方法工坊吸顶带的解绑规则')
  assert.equal(client.includes('formerLabel'), false, '构建产物仍残留已移除的 formerLabel 契约字段')
})
