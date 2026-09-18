
// 高阶聚合工具的统一输出契约（ROADMAP P1-2）：
// 每个聚合入口的 data 顶层都携带 summary / next_actions / warnings / artifacts / run_id，
// 调用方（Agent 或 UI）无需了解工具内部结构即可读取下一步。
// 约束：契约层只做字段归一，不做任何 I/O；普通工具继续用 wrap()，不受影响。

function contract(data, {
  source,
  confidence = 'unverified',
  disclaimer,
  summary,
  next_actions,
  warnings,
  artifacts,
  run_id,
} = {}) {
  return {
    data: {
      ...(run_id ? { run_id } : {}),
      ...(summary !== undefined ? { summary } : {}),
      ...(Array.isArray(next_actions) ? { next_actions } : {}),
      ...(Array.isArray(warnings) && warnings.length ? { warnings } : {}),
      ...(Array.isArray(artifacts) && artifacts.length ? { artifacts } : {}),
      ...data,
    },
    meta: {
      source: String(source || 'dsh-research-kit'),
      retrieved_at: new Date().toISOString(),
      confidence,
      ...(disclaimer ? { disclaimer } : {}),
    },
  }
}

export { contract }
