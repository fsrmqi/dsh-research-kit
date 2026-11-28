import { normalizeResearchLedgerEvent } from './research-ledger.js'
import { evidenceVaultStore, publishEvidenceVault } from './evidence-vault-sync.js'

const PREFIX = 'dsh-research-kit.pending-search.'
const delays = [1000, 5000, 30000]

export function createSearchLedgerOutbox({ storage, write, schedule = setTimeout, cancel = clearTimeout, now = Date.now }) {
  const entries = new Map()
  const inFlight = new Map()
  const listeners = new Set()
  let timer

  const publish = () => listeners.forEach(listener => listener())
  const persist = row => {
    try {
      storage.setItem(PREFIX + row.event.id, JSON.stringify(row))
      return true
    } catch { return false }
  }
  const load = () => {
    try {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index)
        if (!key?.startsWith(PREFIX) || entries.has(key.slice(PREFIX.length))) continue
        try {
          const row = JSON.parse(storage.getItem(key))
          if (row?.event?.kind === 'search' && key === PREFIX + row.event.id) entries.set(row.event.id, row)
        } catch { /* 保留其他可读记录 */ }
      }
    } catch { /* 本机存储不可用时仍可尝试直接记账 */ }
  }
  const scheduleNext = () => {
    cancel(timer)
    const due = [...entries.values()].filter(row => !inFlight.has(row.event.id) && row.attempts < delays.length + 1)
    if (due.length) timer = schedule(flush, Math.max(0, Math.min(...due.map(row => row.retryAt)) - now()))
  }
  const attempt = row => {
    const id = row.event.id
    if (inFlight.has(id)) return inFlight.get(id)
    const task = Promise.resolve().then(() => write(row.event)).then(() => {
      entries.delete(id)
      try { storage.removeItem(PREFIX + id) } catch { /* 相同 ID 补写仍为单条记录 */ }
      return true
    }, () => {
      row.attempts++
      row.retryAt = now() + (delays[row.attempts - 1] || 0)
      row.durable = persist(row)
      return false
    }).finally(() => {
      inFlight.delete(id)
      scheduleNext()
      publish()
    })
    inFlight.set(id, task)
    return task
  }
  function flush() {
    load()
    const due = [...entries.values()].filter(row => row.attempts < delays.length + 1 && row.retryAt <= now())
    for (const row of due) attempt(row)
    scheduleNext()
    publish()
  }
  return {
    flush,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    failed(project) {
      return [...entries.values()].filter(row => row.attempts >= delays.length + 1
        && (project === undefined || row.event.project === project)).map(row => row.event)
    },
    async add(input) {
      const event = normalizeResearchLedgerEvent(input)
      const row = { event, attempts: 0, retryAt: now() }
      row.durable = persist(row)
      entries.set(event.id, row)
      const saved = await attempt(row)
      return { saved, durable: row.durable }
    },
    async retry(project) {
      const ids = this.failed(project).map(event => event.id)
      return Promise.all(ids.map(id => attempt(entries.get(id))))
    },
  }
}

export const searchLedgerOutbox = createSearchLedgerOutbox({
  storage: {
    get length() { return globalThis.localStorage.length },
    key: index => globalThis.localStorage.key(index),
    getItem: key => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
    removeItem: key => globalThis.localStorage.removeItem(key),
  },
  write: async event => {
    const store = evidenceVaultStore()
    await store.saveResearchLedgerEvent(event)
    if (store.isDegraded()) throw new Error('科研账本暂无法持久保存。')
    publishEvidenceVault()
  },
})
