// projectKey 是兼容旧文件和 MCP project 参数的不可变存储键；name 只是可改的显示名。
// 可逆编码避免把不同 Unicode 项目名压成同一短 hash。
export function workspaceIdForProject(projectKey) {
  const key = String(projectKey || '').trim()
  if (!key) return 'workspace:unassigned'
  try { return `workspace:${encodeURIComponent(key)}` }
  catch {
    // 旧数据可能含孤立 surrogate；UTF-16 逐码元编码仍可无损区分不同项目键。
    let hex = ''
    for (let index = 0; index < key.length; index++) hex += key.charCodeAt(index).toString(16).padStart(4, '0')
    return `workspace:u16:${hex}`
  }
}

export function normalizeWorkspaceName(value) {
  const name = String(value || '').trim()
  if (!name || name.length > 100 || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || name === '.' || name === '..') {
    throw new Error('课题名称须为 1–100 字，且不能包含路径或控制字符。')
  }
  return name
}

export function workspaceForProject(projectKey, record = null) {
  const key = String(projectKey || '').trim()
  if (!key) return null
  return {
    id: workspaceIdForProject(key), projectKey: key,
    name: String(record?.name || key), archived: record?.archived === true,
    origin: record?.origin || 'legacy', createdAt: Number(record?.createdAt) || 0,
    updatedAt: Number(record?.updatedAt) || 0,
  }
}
