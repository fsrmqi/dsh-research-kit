// 最小 DOM 桩：让分区组件能在 Node 里被 react-dom/server 渲染。
//
// 为什么需要它：SSR 不执行 useEffect，但**渲染期**仍会读到若干浏览器全局——
// 组件的惰性 useState 初始化与 useMemo 会访问 localStorage（目录存储、选择集）、
// indexedDB（证据库）、window.location.hash（图谱 URL 状态）。
//
// 边界：本桩只够「渲染一次」，不含事件系统。要断言点击后的行为，得靠真实 profile
// （见 docs/MANUAL-QA.md）。不要把它当成完整 DOM 环境。

const define = (key, value) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true, enumerable: false })
  return () => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
}

function createMemoryStorage() {
  const map = new Map()
  return {
    getItem: key => (map.has(String(key)) ? map.get(String(key)) : null),
    setItem: (key, value) => { map.set(String(key), String(value)) },
    removeItem: key => { map.delete(String(key)) },
    clear: () => map.clear(),
    key: index => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
}

export function installDomStub() {
  const localStorageStub = createMemoryStorage()
  const location = { hash: '', href: 'http://localhost/', search: '', pathname: '/', protocol: 'http:', host: 'localhost' }
  const matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })
  const getComputedStyle = () => ({ getPropertyValue: () => '' })

  const windowStub = {
    location,
    localStorage: localStorageStub,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    matchMedia,
    getComputedStyle,
    history: { replaceState: () => {}, pushState: () => {}, back: () => {} },
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    requestAnimationFrame: callback => setTimeout(callback, 0),
    cancelAnimationFrame: id => clearTimeout(id),
  }

  const documentStub = {
    documentElement: { style: {} },
    body: { classList: { toggle: () => {}, add: () => {}, remove: () => {} }, appendChild: () => {}, removeChild: () => {} },
    createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, click: () => {}, remove: () => {} }),
    createElementNS: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  }

  const restores = [
    // Node 21+ 自带只读的 navigator 全局，必须用 defineProperty 覆盖而不是赋值。
    define('window', windowStub),
    define('localStorage', localStorageStub),
    define('document', documentStub),
    define('navigator', { clipboard: { writeText: async () => {} }, userAgent: 'node' }),
    define('matchMedia', matchMedia),
    define('getComputedStyle', getComputedStyle),
    define('history', windowStub.history),
    define('location', location),
  ]

  return {
    location,
    localStorage: localStorageStub,
    restore() { for (const restore of restores.reverse()) restore() },
  }
}
