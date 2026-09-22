import Schema from '@deepseek-ai/schemastery'

/** Live host-side settings; every consumer reads a reference at request time. */
export const Config = Schema.object({
  memoryServer: Schema.string().default('memory-center').extra('volatile', true),
  memoryTimeoutMs: Schema.number().default(15_000).extra('volatile', true),
  databaseTimeoutMs: Schema.number().default(15_000).extra('volatile', true),
  databaseRequestsPerMinute: Schema.number().default(12).extra('volatile', true),
  allowAgentFallback: Schema.boolean().default(true).extra('volatile', true),
})

/** Read either a volatile reference or a plain test fixture without type guessing. */
export function readConfigValue(value, fallback) {
  const resolved = value && typeof value.get === 'function' ? value.get() : value
  return resolved ?? fallback
}
