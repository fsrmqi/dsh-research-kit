import React from 'react'

export const PROMPTKIT_CLIENT_PATH = '/dsh-research-kit/promptkit-client'

let promptKitNamespace = null
let promptKitPromise = null

export function promptKitReady() {
  return Boolean(promptKitNamespace)
}

export function getPromptKit() {
  if (!promptKitNamespace) throw new Error('PromptKit 尚未加载。')
  return promptKitNamespace
}

// PromptKit 是体积最大的可选界面依赖。通过同源脚本按需加载，避免首屏解析整份工坊代码；
// 单例 Promise 同时保证控制台、输入框增强器和自动沉淀接线并发挂载时只请求一次。
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
  promptKitPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = PROMPTKIT_CLIENT_PATH
    script.async = true
    window.__DSH_RESEARCH_REACT__ = React
    const cleanup = () => {
      if (window.__DSH_RESEARCH_REACT__ === React) delete window.__DSH_RESEARCH_REACT__
      script.remove()
    }
    script.onload = () => {
      const loaded = window.__DSH_RESEARCH_PROMPTKIT__
      cleanup()
      if (!loaded) {
        promptKitPromise = null
        reject(new Error('PromptKit 工件已加载，但未导出可用命名空间。'))
        return
      }
      promptKitNamespace = loaded
      resolve(loaded)
    }
    script.onerror = () => {
      cleanup()
      promptKitPromise = null
      reject(new Error('PromptKit 工件加载失败，请刷新后重试。'))
    }
    document.head.appendChild(script)
  })
  return promptKitPromise
}
