
function wrap(data, { source, confidence = 'unverified', disclaimer } = {}) {
  return {
    data,
    meta: {
      source: String(source || 'dsh-research-kit'),
      retrieved_at: new Date().toISOString(),
      confidence,
      ...(disclaimer ? { disclaimer } : {}),
    },
  }
}

function err(message, code = 'TOOL_ERROR') {
  return { error: true, code, message: String(message) }
}

export { wrap, err }
