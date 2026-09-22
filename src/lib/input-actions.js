/** Helpers for DSH composer writes without losing concurrent user edits. */

/** Whether the host can insert text while preserving the rest of the draft. */
export function supportsSafeInsert(inputActions) {
  return typeof inputActions?.captureInsertion === 'function'
    && typeof inputActions?.insertText === 'function'
}

/** Whether any composer write is possible. */
export function canWriteDraft(inputActions) {
  return supportsSafeInsert(inputActions) || typeof inputActions?.setDraft === 'function'
}

/**
 * Insert at the captured caret when the host supports it; otherwise replace the
 * whole draft. `stale` means the async result should not silently overwrite the
 * user's newer draft.
 */
export function writeDraftText(inputActions, text, { mode = 'insert' } = {}) {
  const value = String(text ?? '')
  if (mode !== 'replace' && supportsSafeInsert(inputActions)) {
    const inserted = inputActions.insertText(value, inputActions.captureInsertion())
    if (inserted === true) return { ok: true, inserted: true }
    if (inserted === false) return { ok: false, inserted: false, stale: true }
  }
  if (typeof inputActions?.setDraft !== 'function') return { ok: false }
  inputActions.setDraft(value)
  return { ok: true, inserted: false, fallback: mode !== 'replace' }
}
