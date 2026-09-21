const REQUEST_TIMEOUT_MS = 15_000
const MAX_RETRIES = 2
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const CIRCUIT_FAILURES = 3
const CIRCUIT_OPEN_MS = 30_000
const MAX_RETRY_DELAY_MS = 10_000

const circuits = new Map()

const contactEmail = String(process.env.DSH_RESEARCH_KIT_CONTACT_EMAIL || '').trim()
export const USER_AGENT = contactEmail
  ? `dsh-research-kit/0.2.0 (+https://github.com/fsrmqi/dsh-research-kit; mailto:${contactEmail})`
  : 'dsh-research-kit/0.2.0 (+https://github.com/fsrmqi/dsh-research-kit)'

function circuitKey(url) {
  try {
    return new URL(url).host
  } catch {
    return String(url)
  }
}

function assertCircuitClosed(key) {
  const circuit = circuits.get(key)
  if (circuit?.openUntil) {
    if (Date.now() < circuit.openUntil) {
      const error = new Error(`外部服务 ${key} 暂时不可用（熔断冷却中），请稍后重试。`)
      error.code = 'CIRCUIT_OPEN'
      throw error
    }
    circuit.openUntil = 0
    circuits.set(key, circuit)
  }
}

function recordCircuitResult(key, ok) {
  const now = Date.now()
  const circuit = circuits.get(key) || { failures: 0, openUntil: 0 }
  if (ok) {
    circuit.failures = 0
    circuit.openUntil = 0
  } else {
    circuit.failures += 1
    if (circuit.failures >= CIRCUIT_FAILURES) {
      circuit.openUntil = now + CIRCUIT_OPEN_MS
      circuit.failures = 0
    }
  }
  circuits.set(key, circuit)
}

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get?.('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
    }
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) {
      return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_DELAY_MS)
    }
  }
  const exponential = 500 * 2 ** attempt
  const jitter = exponential * 0.2 * (Math.random() * 2 - 1)
  return Math.min(Math.max(exponential + jitter, 0), MAX_RETRY_DELAY_MS)
}

async function fetchWithRetry(url, {
  accept = 'application/json',
  timeoutMs = REQUEST_TIMEOUT_MS,
  retries = MAX_RETRIES,
  fetchImpl = fetch,
  headers = {},
} = {}) {
  const key = circuitKey(url)
  assertCircuitClosed(key)

  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response
    try {
      response = await fetchImpl(url, {
        headers: { Accept: accept, 'User-Agent': USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      lastError = error
      if (attempt === retries) break
      await new Promise(resolve => setTimeout(resolve, retryDelayMs(null, attempt)))
      continue
    }

    if (response.ok) {
      recordCircuitResult(key, true)
      return response
    }

    if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) {
      if (RETRYABLE_STATUS.has(response.status)) recordCircuitResult(key, false)
      const error = new Error(`外部服务返回 HTTP ${response.status}`)
      error.code = `HTTP_${response.status}`
      throw error
    }

    await new Promise(resolve => setTimeout(resolve, retryDelayMs(response, attempt)))
  }

  recordCircuitResult(key, false)
  if (lastError) {
    lastError.code ||= 'FETCH_FAILED'
    throw lastError
  }
  throw new Error('外部服务请求失败。')
}

async function fetchJsonWithRetry(url, options = {}) {
  const response = await fetchWithRetry(url, { ...options, accept: options.accept || 'application/json' })
  return response.json()
}

async function fetchTextWithRetry(url, options = {}) {
  const response = await fetchWithRetry(url, { ...options, accept: options.accept || 'text/plain' })
  return response.text()
}

function crossrefUrl(url, email = contactEmail) {
  const mailto = String(email || '').trim()
  if (!mailto) return url
  try {
    const parsed = new URL(url)
    if (parsed.host !== 'api.crossref.org') return url
    parsed.searchParams.set('mailto', mailto)
    return parsed.toString()
  } catch {
    return url
  }
}

export { fetchWithRetry, fetchJsonWithRetry, fetchTextWithRetry, crossrefUrl }
