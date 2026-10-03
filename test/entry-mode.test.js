import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 入口形态偏好：默认内联（输入框图标钮），可在 Plugins 详情页切成悬浮伴生钮。
// 它是本机偏好而不是插件配置——改完即时生效，不必重启 profile 重载插件。
// 这里用最小 localStorage 桩，验证「默认值 / 脏数据回落 / 持久化 / 广播与退订」。

function installStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      localStorage: {
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)) },
        removeItem: key => { store.delete(key) },
      },
    },
  })
  return {
    store,
    restore() {
      if (previous) Object.defineProperty(globalThis, 'window', previous)
      else delete globalThis.window
    },
  }
}

test('入口形态偏好：默认内联、脏数据回落、写入可持久并广播', async t => {
  const browser = installStorage()
  t.after(() => browser.restore())
  const mod = await import('../src/entry-mode.js')
  assert.equal(mod.ENTRY_MODE_KEY, 'dsh-research-kit.entry-mode.v1')
  assert.deepEqual(mod.ENTRY_MODE_OPTIONS.map(option => option.value), ['inline', 'floating'])
  assert.equal(mod.readEntryMode(), 'inline', '缺省必须是内联形态')
  for (const bad of [null, undefined, '', 'FLOATING', 'off', '悬浮', '{"mode":"floating"}']) {
    assert.equal(mod.normalizeEntryMode(bad), 'inline', `脏数据 ${JSON.stringify(bad)} 必须回落到内联`)
  }
  const seen = []
  const off = mod.subscribeEntryMode(mode => seen.push(mode))
  assert.equal(mod.writeEntryMode('floating'), 'floating')
  assert.equal(browser.store.get(mod.ENTRY_MODE_KEY), 'floating', '必须落到本机存储')
  assert.equal(mod.readEntryMode(), 'floating', '重挂载后读回同一形态（免重启生效）')
  assert.equal(mod.writeEntryMode('nonsense'), 'inline', '非法值按内联落盘')
  assert.deepEqual(seen, ['floating', 'inline'], '写入即广播，输入框那一侧同一次渲染就换过来')
  off()
  mod.writeEntryMode('floating')
  assert.deepEqual(seen, ['floating', 'inline'], '退订后不再收到通知')
})

test('入口形态接线：槽位按偏好二选一，设置项挂在 Plugins 详情页状态区', () => {
  const glue = readFileSync(new URL('../dsh/prompt-enhancer-glue.js', import.meta.url), 'utf8')
  assert.match(glue, /const mode = useEntryMode\(\)/)
  assert.match(glue, /const floating = mode === ENTRY_MODE_FLOATING/)
  // 悬浮形态交回工件自带的启动钮（不传 inline 那一组属性）；内联形态才传。
  assert.match(glue, /const launcherProps = floating\s*\?\s*\{\}\s*:\s*\{ launcher: 'inline'/)
  assert.match(glue, /\.\.\.launcherProps/)
  // 设置项在 Plugins 详情页的「运行状态」区里，与既有配置预设同一处。
  const status = readFileSync(new URL('../src/plugin-status.js', import.meta.url), 'utf8')
  assert.match(status, /import \{ EntryModeSetting \} from '\.\/entry-mode\.js'/)
  assert.match(status, /h\(EntryModeSetting, \{ key: 'entry-mode' \}\)/)
  // 构建产物必须带上整条链路（模块入序错误只有运行期才炸）。
  const bundle = readFileSync(new URL('../ui/client.js', import.meta.url), 'utf8')
  for (const symbol of ['dsh-research-kit.entry-mode.v1', 'ENTRY_MODE_FLOATING', 'EntryModeSetting']) {
    assert.ok(bundle.includes(symbol), `构建产物必须包含 ${symbol}`)
  }
})

test('入口形态设置项：两个标签与各自说明逐字成契约', async t => {
  const browser = installStorage()
  t.after(() => browser.restore())
  const mod = await import('../src/entry-mode.js?hints=1')
  assert.deepEqual(mod.ENTRY_MODE_OPTIONS.map(option => option.label), ['输入框图标钮', '悬浮伴生钮'])
  assert.match(mod.ENTRY_MODE_HINTS.inline, /图标钮/)
  assert.match(mod.ENTRY_MODE_HINTS.inline, /操作区/, '内联形态要说明手动沉淀仍在消息操作区')
  assert.match(mod.ENTRY_MODE_HINTS.floating, /伴生圆钮/)
  assert.match(mod.ENTRY_MODE_HINTS.floating, /拖拽/)
})
