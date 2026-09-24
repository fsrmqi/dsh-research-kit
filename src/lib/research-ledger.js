const KINDS = new Set(['search', 'screening', 'artifact'])
const DECISIONS = new Set(['include', 'exclude', 'pending'])

const clean = (value, limit = 500) => String(value || '').trim().slice(0, limit)

export function normalizeResearchLedgerEvent(input = {}) {
  const kind = clean(input.kind, 30)
  if (!KINDS.has(kind)) throw new Error('未知的科研账本事件类型。')
  const at = Number(input.at) || Date.now()
  const base = {
    id: clean(input.id, 100) || `ledger-${at.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    project: clean(input.project, 100),
    runId: clean(input.runId, 100),
    question: clean(input.question, 500),
    at,
    actor: clean(input.actor, 30) || 'researcher',
  }
  if (kind === 'search') {
    const database = clean(input.database, 120)
    const query = clean(input.query, 2000)
    if (!database || !query) throw new Error('检索记录必须包含数据库和检索式。')
    return { ...base, database, query, mode: clean(input.mode, 30),
      resultCount: Math.max(0, Number(input.resultCount) || 0),
      sourceIds: [...new Set((Array.isArray(input.sourceIds) ? input.sourceIds : []).map(value => clean(value, 300)).filter(Boolean))].slice(0, 500),
      snapshotId: clean(input.snapshotId, 200),
      deduplicatedCount: Math.max(0, Number(input.deduplicatedCount) || 0) }
  }
  if (kind === 'screening') {
    const evidenceId = clean(input.evidenceId, 100)
    const decision = clean(input.decision, 30)
    if (!evidenceId || !DECISIONS.has(decision)) throw new Error('筛选记录必须包含证据和有效的决定。')
    const reason = clean(input.reason, 2000)
    if (decision === 'exclude' && !reason) throw new Error('排除证据须记录理由。')
    return { ...base, evidenceId, decision, reason, source: clean(input.source, 30) || 'manual' }
  }
  const title = clean(input.title, 300)
  if (!title) throw new Error('研究产出须填写名称。')
  // 用户手填执行引用只能说明「声称有执行记录」；不能冒充已由系统核验的工具结果。
  return { ...base, title, state: input.state === 'verified-execution' && input.executionVerified === true ? 'verified-execution' : 'draft',
    datasetId: clean(input.datasetId, 300), codeVersion: clean(input.codeVersion, 300),
    parameters: clean(input.parameters, 2000), environment: clean(input.environment, 1000),
    output: clean(input.output, 1000), executionRef: clean(input.executionRef, 500) }
}

export function researchLedgerSummary(events = []) {
  const decisions = [...latestResearchScreening(events).values()]
  return {
    searches: events.filter(item => item.kind === 'search').length,
    included: decisions.filter(item => item.decision === 'include').length,
    excluded: decisions.filter(item => item.decision === 'exclude').length,
    pending: decisions.filter(item => item.decision === 'pending').length,
    artifacts: events.filter(item => item.kind === 'artifact').length,
  }
}

export function latestResearchScreening(events = []) {
  const latest = new Map()
  for (const event of events) {
    if (event.kind !== 'screening') continue
    const previous = latest.get(event.evidenceId)
    if (!previous || event.at > previous.at) latest.set(event.evidenceId, event)
  }
  return latest
}
