import React from 'react'

export const PROMPTKIT_CLIENT_PATH = '/dsh-research-kit/promptkit-client'

// 宿主（尤其桌面 App 经 dsh-app:// 协议转发）对这条路由可能既不回包也不报错：
// <script> 的 load / error 都永远不触发，入口就会无限停在「加载中」而看不见任何失败。
// 因此两条传输各自带硬超时：<script> 挂起后换 fetch 再试一次（不同的浏览器取数路径），
// 两条都失败才报错，且错误里带上各自的原因——便于区分「路由没通」与「传输被挂起」。
export const PROMPTKIT_LOAD_TIMEOUT_MS = 6000
export const PROMPTKIT_FETCH_TIMEOUT_MS = 6000

let promptKitNamespace = null
let promptKitPromise = null

export function promptKitReady() {
  return Boolean(promptKitNamespace)
}

export function getPromptKit() {
  if (!promptKitNamespace) throw new Error('PromptKit 尚未加载。')
  return promptKitNamespace
}

// 传输一：同源经典脚本。宿主按需分发工件，避免首屏解析整份工坊代码。
function loadViaScript() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = PROMPTKIT_CLIENT_PATH
    script.async = true
    window.__DSH_RESEARCH_REACT__ = React
    let settled = false
    const cleanup = () => {
      if (window.__DSH_RESEARCH_REACT__ === React) delete window.__DSH_RESEARCH_REACT__
      script.remove()
    }
    const fail = error => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      cleanup()
      reject(error)
    }
    const timer = window.setTimeout(() => {
      fail(new Error(`<script> 形态 ${PROMPTKIT_LOAD_TIMEOUT_MS / 1000}s 内未返回（宿主可能挂住了这条路由）`))
    }, PROMPTKIT_LOAD_TIMEOUT_MS)
    script.onload = () => {
      if (settled) return
      const loaded = window.__DSH_RESEARCH_PROMPTKIT__
      if (!loaded) {
        fail(new Error('工件已取回，但未导出可用命名空间'))
        return
      }
      settled = true
      window.clearTimeout(timer)
      cleanup()
      resolve(loaded)
    }
    script.onerror = () => fail(new Error('脚本请求失败（onerror）'))
    document.head.appendChild(script)
  })
}

// 传输二：fetch 取回文本后就地求值。
// 工件是同源、我们自己的构建产物，运行期只依赖 window.__DSH_RESEARCH_REACT__；
// 若宿主配置了禁止 eval 的 CSP，这里会失败并如实报错（不再静默停在加载中）。
// 注意：脚本形态若在超时后才姗姗到达，工件会再执行一次并覆盖全局命名空间——
// 组件用的是本模块已解析的那一份，因此只是多一次幂等初始化，不会错乱。
function loadViaFetch() {
  return new Promise((resolve, reject) => {
    if (typeof fetch !== 'function') {
      reject(new Error('当前环境没有 fetch'))
      return
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      try { controller?.abort() } catch { /* 取消失败不影响判定 */ }
      reject(new Error(`fetch 形态 ${PROMPTKIT_FETCH_TIMEOUT_MS / 1000}s 内未返回`))
    }, PROMPTKIT_FETCH_TIMEOUT_MS)
    Promise.resolve()
      .then(() => fetch(PROMPTKIT_CLIENT_PATH, { credentials: 'same-origin', ...(controller ? { signal: controller.signal } : {}) }))
      .then(response => {
        if (!response.ok) throw new Error(`fetch 形态 HTTP ${response.status}`)
        return response.text()
      })
      .then(code => {
        if (settled) return
        if (!code) throw new Error('fetch 形态返回空响应')
        window.__DSH_RESEARCH_REACT__ = React
        try {
          // eslint-disable-next-line no-new-func
          new Function(code)()
        } finally {
          if (window.__DSH_RESEARCH_REACT__ === React) delete window.__DSH_RESEARCH_REACT__
        }
        const loaded = window.__DSH_RESEARCH_PROMPTKIT__
        if (!loaded) throw new Error('工件已求值，但未导出可用命名空间')
        settled = true
        window.clearTimeout(timer)
        resolve(loaded)
      })
      .catch(error => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
  })
}

// PromptKit 是体积最大的可选界面依赖。单例 Promise 保证控制台、输入框增强器与
// 方法工坊接线并发挂载时只请求一次（跨传输也只走一轮）。
export function loadPromptKit() {
  if (promptKitNamespace) return Promise.resolve(promptKitNamespace)
  if (promptKitPromise) return promptKitPromise
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('当前环境无法加载 PromptKit 浏览器工件。'))
  }
  const existing = window.__DSH_RESEARCH_PROMPTKIT__
  if (existing) {
    promptKitNamespace = existing
    return Promise.resolve(existing)
  }
  promptKitPromise = (async () => {
    const failures = []
    for (const [label, transport] of [['script', loadViaScript], ['fetch', loadViaFetch]]) {
      try {
        return await transport()
      } catch (error) {
        failures.push(`${label}: ${error?.message || error}`)
      }
    }
    throw new Error(`PromptKit 工件加载失败（${PROMPTKIT_CLIENT_PATH}）—— ${failures.join('；')}`)
  })().then(loaded => {
    promptKitNamespace = loaded
    return loaded
  }, error => {
    // 失败必须清掉单例：用户在入口按钮上点「重试」时重新走两条传输。
    promptKitPromise = null
    throw error
  })
  return promptKitPromise
}
