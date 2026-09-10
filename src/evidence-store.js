const PREFIX = 'dsh-research-kit.evidence.'
const MAX_QUERIES = 30
const MAX_WORKFLOWS = 30

function read(key) { try { const value = JSON.parse(window.localStorage.getItem(key) || '{}'); return value && typeof value === 'object' ? value : {} } catch { return {} } }
function write(key, value) { try { window.localStorage.setItem(key, JSON.stringify(value)) } catch {} }

export function createEvidenceStore(sessionId) {
  const key = `${PREFIX}${String(sessionId || 'unscoped')}`
  const listeners = new Set()
  const get = () => ({ queries: Array.isArray(read(key).queries) ? read(key).queries : [], workflows: Array.isArray(read(key).workflows) ? read(key).workflows : [] })
  const publish = value => { for (const listener of listeners) { try { listener(value) } catch {} } return value }
  const save = next => { write(key, next); return publish(next) }
  return {
    get,
    recordQuery({ databaseId, databaseName, mode = 'direct', sources = [] }) {
      const current = get()
      const row = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, databaseId, databaseName, mode, at: Date.now(), sources: sources.slice(0, 8).map(source => ({ id: source.id, title: source.title, url: source.url, meta: source.meta })) }
      return save({ ...current, queries: [row, ...current.queries].slice(0, MAX_QUERIES) })
    },
    recordWorkflow({ id, name, resourceIds = [] }) {
      const current = get()
      const row = { id, name, resourceIds: [...new Set(resourceIds)], at: Date.now() }
      return save({ ...current, workflows: [row, ...current.workflows.filter(item => item.id !== id)].slice(0, MAX_WORKFLOWS) })
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    clear() { return save({ queries: [], workflows: [] }) }
  }
}
