import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  QUICK_ENHANCER_POSITION_KEY,
  ENHANCER_BUTTON_SIZE,
  DEPOSIT_BUTTON_SIZE,
  DEPOSIT_BUTTON_GAP,
  companionDepositPosition,
} from '../src/composer-deposit-button.js'

// 手动沉淀伴生钮：贴着 vendored QuickEnhancer 的浮动触发钮停靠。
// 位置解算是纯函数（可单测）；与增强器的接线由源码断言钉住。

const VIEWPORT = { width: 1400, height: 900 }

test('伴生钮位置：默认与增强器默认位对齐，停在正上方并共享中轴', () => {
  // vendored 默认位（右下角）：{ x: width - 86, y: height - 158 }
  const pos = companionDepositPosition(null, VIEWPORT)
  const enhancer = { x: Math.max(24, VIEWPORT.width - 86), y: Math.max(96, VIEWPORT.height - 158) }
  assert.equal(pos.x, enhancer.x + (ENHANCER_BUTTON_SIZE - DEPOSIT_BUTTON_SIZE) / 2, '共享中轴（按尺寸差对半偏移）')
  assert.equal(pos.y, enhancer.y - DEPOSIT_BUTTON_GAP - DEPOSIT_BUTTON_SIZE, '默认停在增强器正上方，间距 8px')
})

test('伴生钮位置：跟随增强器存储位；贴顶放不下时翻到正下方', () => {
  const stored = { x: 300, y: 400 }
  const pos = companionDepositPosition(stored, VIEWPORT)
  assert.equal(pos.y, 400 - DEPOSIT_BUTTON_GAP - DEPOSIT_BUTTON_SIZE, '空间充裕时正上方')
  // 增强器贴顶（y=58）时上方只剩 58-8-38=12px < 58，必须翻到正下方。
  const flipped = companionDepositPosition({ x: 300, y: 58 }, VIEWPORT)
  assert.equal(flipped.y, 58 + ENHANCER_BUTTON_SIZE + DEPOSIT_BUTTON_GAP, '贴顶时翻到正下方')
  // 保持正上方的最低锚位：above = y - 46 ≥ 58 → y ≥ 104。
  assert.equal(companionDepositPosition({ x: 300, y: 104 }, VIEWPORT).y, 58, '恰好够放正上方时贴最低钳制线')
  assert.equal(companionDepositPosition({ x: 300, y: 103 }, VIEWPORT).y, 103 + ENHANCER_BUTTON_SIZE + DEPOSIT_BUTTON_GAP, '差 1px 放不下即翻转')
})

test('伴生钮位置：越界存储位被钳回 vendored 拖拽范围，非法输入回落默认位', () => {
  // 越界值先钳到增强器自身的合法范围，再解算伴生位。
  const clamped = companionDepositPosition({ x: 99999, y: -50 }, VIEWPORT)
  assert.ok(clamped.x >= 16 && clamped.x <= VIEWPORT.width - 62 + 3, 'x 钳在增强器范围内')
  assert.ok(clamped.y >= 58, 'y 不高于视口顶钳制线')
  // 非法存储位（NaN/负值/非对象）一律回落默认位。
  for (const bad of [undefined, null, {}, { x: NaN, y: 200 }, { x: 'x', y: 200 }, 'bad']) {
    const pos = companionDepositPosition(bad, VIEWPORT)
    assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y), `非法输入 ${JSON.stringify(bad)} 不产生 NaN`)
  }
  // 零尺寸视口也不炸。
  const tiny = companionDepositPosition({ x: 100, y: 100 }, { width: 0, height: 0 })
  assert.ok(Number.isFinite(tiny.x) && Number.isFinite(tiny.y))
})

test('伴生钮接线：由增强器宿主并排渲染，位置键与 vendored 落盘键逐字一致', () => {
  const glue = readFileSync(new URL('../dsh/prompt-enhancer-glue.js', import.meta.url), 'utf8')
  assert.match(glue, /import \{ ResearchDepositButton \} from '\.\.\/src\/composer-deposit-button\.js'/)
  // 伴生钮必须是 QuickEnhancer 的兄弟节点（Fragment 并排），不得包进 vendored 组件内部。
  assert.match(glue, /React\.createElement\(ResearchDepositButton, \{ key: 'research-deposit-button' \}\)/)
  assert.match(glue, /React\.createElement\(PromptKit\.QuickEnhancer, \{/)
  const button = readFileSync(new URL('../src/composer-deposit-button.js', import.meta.url), 'utf8')
  assert.equal(QUICK_ENHANCER_POSITION_KEY, 'dsh-research-kit.promptkit.quick-action.position.v1', '位置键必须与 vendored storagePrefix + quick-action.position.v1 一致')
  assert.match(button, /window\.localStorage\.getItem\(QUICK_ENHANCER_POSITION_KEY\)/)
  // 拖拽结束与窗口变化都要重算；状态条定时器必须清理。
  assert.match(button, /window\.addEventListener\('pointerup', measure\)/)
  assert.match(button, /window\.addEventListener\('resize', measure\)/)
  assert.match(button, /clearTimeout\(statusTimer\.current\)/)
  // 点击即显式沉淀（与图谱页同一入口函数），绝不静默注入。
  assert.match(button, /depositLatestAssistantMessage\(\)/)
  assert.match(button, /role: 'status'/)
})
