// 文件 Claim 台账是审核状态的唯一来源；IndexedDB 只保留可离线读取的投影。
import { workspaceIdForProject } from './research-workspaces.js'
const UNIFIED_CLAIM_API = '/dsh-research-kit/claim-review'
const unifiedClaimInFlight = new Map()

export async function requestResearchClaims(project, body, signal) {
  const response = await fetch(body ? UNIFIED_CLAIM_API : `${UNIFIED_CLAIM_API}?project=${encodeURIComponent(project)}`, {
    method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify({ ...body, project }) : undefined,
    signal: signal || AbortSignal.timeout(10000),
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`)
  return result
}

export function projectClaimProjection(claim, project) {
  const ids = claim.evidence_ids || []
  const links = (claim.links || []).filter(link => ids.includes(link.evidenceId))
  const resolvedProject = claim.workspace_id === 'workspace:unassigned' ? '' : claim.project || project
  return { ...claim, project: resolvedProject, workspaceId: workspaceIdForProject(resolvedProject),
    links: [...links, ...ids.filter(id => !links.some(link => link.evidenceId === id)).map(evidenceId => ({ evidenceId, stance: 'unassessed' }))],
    createdAt: Date.parse(claim.created_at) || 0, updatedAt: Date.parse(claim.updated_at) || 0,
    reviewSource: 'file-ledger' }
}

export function synchronizeResearchClaims(store, project = '') {
  const key = String(project || 'default')
  if (unifiedClaimInFlight.has(key)) return unifiedClaimInFlight.get(key)
  const task = (async () => {
    const local = (await store.listResearchClaims()).filter(row => (row.project || 'default') === key)
    const pending = local.filter(claim => claim.reviewSource !== 'file-ledger')
    for (let at = 0; at < pending.length; at += 10) {
      await requestResearchClaims(key || 'default', { action: 'import_local', claims: pending.slice(at, at + 10) })
    }
    let offset = 0; const rows = []; let first
    do {
      const response = await fetch(`${UNIFIED_CLAIM_API}?project=${encodeURIComponent(key || 'default')}&offset=${offset}`, { signal: AbortSignal.timeout(10000) })
      const result = await response.json()
      if (!response.ok || !result.ok || !Array.isArray(result.claims)) throw new Error(result.error || '读取 Claim 台账失败。')
      first ||= result
      rows.push(...result.claims.map(claim => projectClaimProjection(claim, key)))
      if (result.next_offset == null) break
      if (!Number.isInteger(result.next_offset) || result.next_offset <= offset) throw new Error('Claim 分页响应无效。')
      offset = result.next_offset
    } while (true)
    await store.cacheResearchClaims(rows)
    return { claims: rows, evidence: first.evidence || [], evidence_limit_reached: first.evidence_limit_reached }
  })().finally(() => unifiedClaimInFlight.delete(key))
  unifiedClaimInFlight.set(key, task)
  return task
}

export async function synchronizeClaimScopes(store, project) {
  const projects = typeof project === 'string' ? [project || 'default'] : [...new Set(['default',
    ...(await store.listProjects()),
    ...(await store.listResearchClaims()).map(row => row.project || 'default'),
  ])]
  if (typeof project !== 'string') {
    const response = await fetch(`${UNIFIED_CLAIM_API}?projects=1`, { signal: AbortSignal.timeout(10000) })
    const result = await response.json()
    if (!response.ok || !result.ok) throw new Error(result.error || '无法读取 Claim 课题列表。')
    for (const name of result.projects || []) if (!projects.includes(name)) projects.push(name)
  }
  const results = []
  for (const scope of projects) results.push(...(await synchronizeResearchClaims(store, scope)).claims)
  return results
}
