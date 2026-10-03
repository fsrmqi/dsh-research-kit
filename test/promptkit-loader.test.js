import test from 'node:test'
import assert from 'node:assert/strict'

// PromptKit 工件的加载契约：宿主把 /dsh-research-kit/promptkit-client 这条路由挂住时，
// 既不能无限「加载中」，也不能只试一条传输就放弃。这里用假浏览器 + 手动定时器
// 确定性地复现「脚本永不回包」，断言超时后会自动改走 fetch，并在两条都失败时给出可定位的错误。

const MARKER_CODE = 'window.__DSH_RESEARCH_PROMPTKIT__ = { marker: "via-fetch" }'

function fakeResponse({ ok = true, status = 200, body = MARKER_CODE } = {}) {
  return { ok, status, text: async () => body }
}

/** 安装假 window/document/fetch；返回句柄用于手动推进定时器与切换行为。 */
function installFakeBrowser(options = {}) {
  const state = {
    script: options.script ?? 'hang',   // 'hang' | 'load' | 'error'
    fetch: options.fetch ?? 'ok',       // 'ok' | 'hang' | 'http500' | 'empty'
    fetchCalls: 0,
    timers: [],
    scripts: [],
  }
  const previous = new Map()
  const setGlobal = (key, value) => {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const windowStub = {
    __DSH_RESEARCH_REACT__: undefined,
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; state.timers.push(timer); return timer },
    clearTimeout: timer => { if (timer) timer.cleared = true },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  const documentStub = {
    createElement: () => {
      const element = { tagName: 'script', removed: false, remove() { this.removed = true } }
      state.scripts.push(element)
      return element
    },
    head: {
      appendChild: element => {
        element.appended = true
        queueMicrotask(() => {
          if (state.script === 'load') element.onload?.()
          else if (state.script === 'error') element.onerror?.()
        })
        return element
      },
    },
  }
  const fetchStub = () => {
    state.fetchCalls += 1
    if (state.fetch === 'hang') return new Promise(() => {})
    if (state.fetch === 'http500') return Promise.resolve(fakeResponse({ ok: false, status: 500 }))
    if (state.fetch === 'empty') return Promise.resolve(fakeResponse({ body: '' }))
    return Promise.resolve(fakeResponse())
  }
  setGlobal('window', windowStub)
  setGlobal('document', documentStub)
  setGlobal('fetch', fetchStub)
  return {
    state,
    /** 触发所有尚未清除的定时器（模拟时间流逝到超时）。 */
    fireTimers() {
      for (const timer of state.timers) {
        if (timer.cleared) continue
        timer.cleared = true
        timer.fn()
      }
    },
    restore() {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    },
  }
}

// 模块内有单例状态：每个用例用不同的查询串拿到一份全新模块实例。
let caseId = 0
const freshLoader = () => import(`../src/promptkit-loader.js?case=${caseId += 1}`)

test('脚本形态被挂起：超时后自动改走 fetch 传输并成功加载', async t => {
  const browser = installFakeBrowser({ script: 'hang', fetch: 'ok' })
  t.after(() => browser.restore())
  const loader = await freshLoader()
  const pending = loader.loadPromptKit()
  assert.equal(loader.PROMPTKIT_LOAD_TIMEOUT_MS, 6000)
  await Promise.resolve()                                  // 让脚本元素挂到 head 上
  assert.equal(browser.state.scripts.length, 1, '先试脚本形态')
  browser.fireTimers()                                     // 脚本超时
  const kit = await pending
  assert.equal(kit.marker, 'via-fetch', '超时后必须由 fetch 形态兜底')
  assert.equal(loader.promptKitReady(), true)
  assert.equal(browser.state.fetchCalls, 1)
  assert.equal(browser.state.scripts[0].removed, true, '超时的脚本元素必须清理')
})

test('两条传输都挂起：报错列出各自原因，且失败后可以重试', async t => {
  const browser = installFakeBrowser({ script: 'hang', fetch: 'hang' })
  t.after(() => browser.restore())
  const loader = await freshLoader()
  const failing = loader.loadPromptKit()
  await Promise.resolve()
  browser.fireTimers()                                     // 脚本超时 -> 切 fetch
  await Promise.resolve()
  browser.fireTimers()                                     // fetch 超时 -> 整体失败
  await assert.rejects(failing, error => {
    assert.match(error.message, /script: <script> 形态/)
    assert.match(error.message, /fetch: fetch 形态/)
    return true
  })
  assert.equal(loader.promptKitReady(), false)
  // 失败必须清掉单例：重试时重新发起，而不是复用已 rejected 的 Promise。
  browser.state.script = 'load'
  browser.state.fetch = 'ok'
  browser.state.timers.length = 0
  const retried = loader.loadPromptKit()
  browser.fireTimers()
  const kit = await retried
  assert.equal(typeof kit, 'object')
  assert.equal(loader.promptKitReady(), true)
})

test('脚本形态正常时只请求一次，且不触碰 fetch 传输', async t => {
  const browser = installFakeBrowser({ script: 'hang', fetch: 'ok' })
  t.after(() => browser.restore())
  const loader = await freshLoader()
  const first = loader.loadPromptKit()
  await Promise.resolve()
  // 模拟脚本成功回包：工件自己写全局，loader 的 onload 读取它。
  globalThis.window.__DSH_RESEARCH_PROMPTKIT__ = { marker: 'via-script' }
  browser.state.scripts[0].onload?.()
  const kit = await first
  assert.equal(kit.marker, 'via-script')
  assert.equal(browser.state.fetchCalls, 0, '脚本成功时不得再走 fetch')
  // 单例：并发/后续调用复用同一命名空间，不再新建脚本。
  assert.equal(await loader.loadPromptKit(), kit)
  assert.equal(browser.state.scripts.length, 1)
})

test('脚本 onerror 且 fetch 返回非 2xx：错误信息包含状态码，且不再静默停在加载中', async t => {
  const browser = installFakeBrowser({ script: 'error', fetch: 'http500' })
  t.after(() => browser.restore())
  const loader = await freshLoader()
  await assert.rejects(loader.loadPromptKit(), /fetch 形态 HTTP 500/)
})
