// 固定并发度的批量映射：按输入顺序返回结果，最多 limit 个任务同时在跑。
// claim-auditor / literature-linker / openalex-fetcher 曾各抄一份逐字相同的实现——
// 那种「三处一起改才不会走偏」的重复，收到这里一份。
export async function mapWithConcurrency(items, limit, run) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await run(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
