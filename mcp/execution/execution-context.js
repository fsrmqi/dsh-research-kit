import { AsyncLocalStorage } from 'node:async_hooks'

const executionContext = new AsyncLocalStorage()
const DEFAULT_TOOL_TIMEOUT_MS = 60_000

function configuredToolTimeoutMs(env = process.env) {
  const value = Number(env.DSH_RESEARCH_KIT_TOOL_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 10 * 60_000) : DEFAULT_TOOL_TIMEOUT_MS
}

function runWithExecutionContext(extra, run) {
  const timeoutSignal = AbortSignal.timeout(configuredToolTimeoutMs())
  const signals = [extra?.signal, timeoutSignal].filter(Boolean)
  const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals)
  return executionContext.run({ signal }, run)
}

function currentExecutionSignal() {
  return executionContext.getStore()?.signal
}

export { configuredToolTimeoutMs, currentExecutionSignal, runWithExecutionContext }
