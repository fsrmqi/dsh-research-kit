export function readSessionEvents(sessions, sessionId, limit = 48) {
  try {
    const entries = sessions?.binding?.(String(sessionId))?.eventSource?.getSnapshot?.()?.entries
    if (!Array.isArray(entries)) return []
    return entries.slice(-limit).map(entry => entry?.event ?? entry).filter(Boolean)
  } catch { return [] }
}
