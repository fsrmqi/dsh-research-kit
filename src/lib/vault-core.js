// 研究灵感资产的纯逻辑（无 React / 无浏览器依赖），供视图与测试共用。
import { visibleDepositionTags } from './deposition-taxonomy.js'

// 超长正文通常是粘贴的原始数据或完整查询结果；导入与保存时拒绝，守住隐私边界。
export const MAX_ASSET_BODY_CHARS = 8000

export function assertManageableBody(body) {
  if (String(body || '').length > MAX_ASSET_BODY_CHARS) {
    throw new Error(`资产正文超过 ${MAX_ASSET_BODY_CHARS} 字符；请只保存可复用的提示词、问题或假设，不要粘贴原始数据或完整查询结果。`)
  }
}

// 外部/持久化数据里的资产列表可能混入 null 与原始值（导入、旧版本写入、手工改过的存储）；
// 入口先收敛为「对象数组」，筛选与计数对任何输入都保持 total。
function vaultAssetRows(assets) {
  return (Array.isArray(assets) ? assets : []).filter(item => item && typeof item === 'object')
}

// 列表筛选：关键词命中标题/正文/备注/标签/项目；filter 为预设分组。
//   all=全部 to_verify=待验证 favorites=收藏 derived=派生版本
export function filterAssets(assets, { query = '', filter = 'all' } = {}) {
  const text = String(query || '').trim().toLowerCase()
  return vaultAssetRows(assets).filter(item => {
    if (filter === 'to_verify' && !(item.verification?.status === 'pending' || item.epistemicStatus === 'to_verify')) return false
    if (filter === 'favorites' && !item.favorite) return false
    if (filter === 'derived' && !item.parentId) return false
    if (!text) return true
    return `${item.title} ${item.body} ${item.note || ''} ${visibleDepositionTags(item).join(' ')} ${item.project || ''}`.toLowerCase().includes(text)
  })
}

// 待验证队列：验证状态 pending 或认识状态待核实的资产优先推进。
export function pendingVerificationCount(assets) {
  return vaultAssetRows(assets).filter(item => item.verification?.status === 'pending' || item.epistemicStatus === 'to_verify').length
}
