// 浏览器侧文件导出：<a download> + Blob URL。
//
// 集中一处的原因：这条链原先在 6 个模块里各自重写了一遍，其中两处在 click() 之后
// **同步** revokeObjectURL —— 部分浏览器此时还没把 Blob 读完，会直接取消这次下载
// （表现为"点了导出，什么都没发生"）。统一改为延迟回收，并且只在这里调用
// createObjectURL / revokeObjectURL，便于复查（test/download.test.js 钉住这一点）。

export const DOWNLOAD_REVOKE_DELAY_MS = 1_000

// 服务端渲染、无 DOM 的测试环境、以及宿主未提供 Blob/URL 时，导出必须安静降级。
export function canDownload() {
  return typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined'
}

export function downloadBlob(blob, filename, { revokeDelayMs = DOWNLOAD_REVOKE_DELAY_MS } = {}) {
  if (!canDownload()) return false
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  if (filename) link.download = filename
  link.click()
  // 关键：不要紧接着同步 revoke——下载还在读 Blob，回收早了会被取消。
  const revoke = () => URL.revokeObjectURL(url)
  if (revokeDelayMs > 0) setTimeout(revoke, revokeDelayMs)
  else setTimeout(revoke, 0)
  return true
}

export function downloadText(text, type, filename, options) {
  if (!canDownload()) return false
  return downloadBlob(new Blob([text], { type }), filename, options)
}

export function downloadJsonFile(text, filename, options) {
  return downloadText(text, 'application/json', filename, options)
}
