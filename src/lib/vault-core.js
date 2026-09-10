// 研究灵感资产的纯逻辑（无 React / 无浏览器依赖），供视图与测试共用。

// 超长正文通常是粘贴的原始数据或完整查询结果；导入与保存时拒绝，守住隐私边界。
export const MAX_ASSET_BODY_CHARS = 8000

export function assertManageableBody(body) {
  if (String(body || '').length > MAX_ASSET_BODY_CHARS) {
    throw new Error(`资产正文超过 ${MAX_ASSET_BODY_CHARS} 字符；请只保存可复用的提示词、问题或假设，不要粘贴原始数据或完整查询结果。`)
  }
}

// 列表筛选：关键词命中标题/正文/备注/标签/项目；filter 为预设分组。
//   all=全部 to_verify=待验证 favorites=收藏 derived=派生版本
export function filterAssets(assets, { query = '', filter = 'all' } = {}) {
  const text = String(query || '').trim().toLowerCase()
  const rows = Array.isArray(assets) ? assets : []
  return rows.filter(item => {
    if (filter === 'to_verify' && !(item.verification?.status === 'pending' || item.epistemicStatus === 'to_verify')) return false
    if (filter === 'favorites' && !item.favorite) return false
    if (filter === 'derived' && !item.parentId) return false
    if (!text) return true
    return `${item.title} ${item.body} ${item.note || ''} ${(item.tags || []).join(' ')} ${item.project || ''}`.toLowerCase().includes(text)
  })
}

// 待验证队列：验证状态 pending 或认识状态待核实的资产优先推进。
export function pendingVerificationCount(assets) {
  const rows = Array.isArray(assets) ? assets : []
  return rows.filter(item => item.verification?.status === 'pending' || item.epistemicStatus === 'to_verify').length
}
