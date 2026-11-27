import {
  evidenceAssessmentFingerprint, normalizeAgentEvidenceResult, planAgentEvidenceBatch,
} from './agent-evidence-batch.js'
import { persistEvidenceEntryToFile, publishEvidenceVault } from './evidence-vault-sync.js'

// 执行证据库 Agent 批量初判：分批请求当前会话模型，快照防并发覆盖，结果与人工评估分开保存。
export async function executeAgentEvidenceAssessment({
  entries,
  sessionId,
  includeHuman = false,
  store,
  signal,
  onProgress,
  onStats,
}) {
  const plan = planAgentEvidenceBatch(entries, { includeHuman })
  const remainingIds = new Set(plan.eligible.map(row => row.id))
  if (!plan.eligible.length) {
    return {
      empty: true,
      completed: 0,
      skippedChanged: 0,
      skippedHuman: plan.skippedHuman,
      failed: 0,
      aborted: false,
      remainingIds: [],
      message: '当前范围没有待 Agent 判断的证据；可勾选「包含人工处理过的」重新判断。',
    }
  }
  if (!sessionId) {
    throw new Error('当前会话不可用，无法调用 Agent 模型。')
  }

  let stats = {
    total: plan.eligible.length,
    completed: 0,
    skipped: 0,
    failed: 0,
    batch: 0,
    batches: plan.batches.length,
    phase: '准备请求',
    last: '',
  }
  const emitStats = patch => {
    stats = { ...stats, ...patch }
    onStats?.(stats)
  }
  emitStats({})

  let completed = 0
  let skippedChanged = 0
  try {
    for (const batch of plan.batches) {
      if (signal?.aborted) break
      const batchNumber = plan.batches.indexOf(batch) + 1
      onProgress?.(`第 ${batchNumber}/${plan.batches.length} 批：请求 ${batch.length} 条`)
      emitStats({ batch: batchNumber, phase: `正在请求第 ${batchNumber} 批（${batch.length} 条）`, last: '' })
      const response = await fetch(`/dsh-research-kit/evidence-agent-assess?session_id=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries: batch }),
        signal,
      })
      const raw = await response.text()
      let body
      try {
        body = JSON.parse(raw || '{}')
      } catch {
        throw new Error(`Agent 服务返回了空或无效响应（HTTP ${response.status}）。请重试；若持续出现，请检查当前会话模型路由。`)
      }
      if (!response.ok) throw new Error(body.next_action || body.error || `Agent 请求失败：HTTP ${response.status}`)
      if (!body?.ok || !Array.isArray(body.assessments)) throw new Error('Agent 服务未返回完整的结构化判断。请重试。')
      const results = normalizeAgentEvidenceResult(body, batch.map(row => row.id), { model: body.model })
      emitStats({ phase: `第 ${batchNumber} 批返回，正在逐条写回` })
      for (const result of results) {
        if (signal?.aborted) break
        const original = batch.find(row => row.id === result.id)
        const current = (await store.getMany([result.id]))[0]
        if (!current || evidenceAssessmentFingerprint(current) !== evidenceAssessmentFingerprint(original)) {
          remainingIds.delete(result.id)
          skippedChanged++
          emitStats({ skipped: skippedChanged, last: `${original.title}：跳过（条目已变化或删除）` })
          continue
        }
        const history = current.agentAssessment
          ? [...(current.agentAssessmentHistory || []), current.agentAssessment].slice(-5)
          : current.agentAssessmentHistory || []
        const saved = await store.save(
          { ...current, agentAssessment: result, agentAssessmentHistory: history, updatedAt: Date.now() },
          { onDuplicate: 'update' },
        )
        if (!await persistEvidenceEntryToFile(saved.entry)) {
          throw new Error(`「${original.title}」的 Agent 结果仅保存在当前浏览器，文件同步失败；请重试以避免丢失。`)
        }
        remainingIds.delete(result.id)
        completed++
        emitStats({ completed, last: `${original.title}：已完成` })
        publishEvidenceVault()
      }
    }
    const aborted = Boolean(signal?.aborted)
    return {
      empty: false,
      completed,
      skippedChanged,
      skippedHuman: plan.skippedHuman,
      failed: 0,
      aborted,
      remainingIds: [...remainingIds],
      message: `${aborted ? '已取消；' : 'Agent 判断完成：'}更新 ${completed} 条${skippedChanged ? `，跳过运行期间变化的 ${skippedChanged} 条` : ''}${plan.skippedHuman ? `，跳过人工处理过的 ${plan.skippedHuman} 条` : ''}。结果仅基于元数据与笔记，不等于来源核验。`,
    }
  } catch (error) {
    const failed = plan.eligible.length - completed - skippedChanged
    const aborted = Boolean(signal?.aborted)
    emitStats({ failed, phase: aborted ? '已取消' : '请求失败', last: error?.message || String(error) })
    const wrapped = new Error(`${aborted ? '已取消' : error?.message || error}；已完成 ${completed} 条，未处理 ${failed} 条。`)
    wrapped.remainingIds = [...remainingIds]
    wrapped.completed = completed
    wrapped.failed = failed
    throw wrapped
  }
}
