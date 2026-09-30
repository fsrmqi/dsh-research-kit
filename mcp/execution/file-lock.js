import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

// 独占文件锁：`open(file, 'wx')` 抢锁，陈旧锁用 rename 接管。
//
// 三处调用方（checkpoint-manager / claim-ledger / evidence-store）此前各写一份，规则已经漂移：
// 只有 checkpoint-manager 用了 rename 接管，并在注释里解释了为什么不能用 stat→unlink→open
// （那中间的窗口足够让另一个等待者插进来拿到新锁）；另两处仍是 unlink。这里统一到 rename 路径，
// 并在接管后立即删除改名产物，避免 `.stale-*` 在数据目录里堆积。
//
// 超时、陈旧判定、空锁宽限期、报错文案仍由调用方传入——它们的数值各不相同，是有意保留的契约，
// 不在共享层替调用方改写。放在 execution/ 而不是 state/：`state/` 已依赖 `execution/`
// （claim-ledger、research-context-pack 等），反向依赖没有先例。
const EMPTY_LOCK_GRACE_MS = 2_000
const backoffMs = attempt => Math.min(20 + attempt * 10, 80)

export async function acquireFileLock(file, { timeoutMs, staleMs, emptyGraceMs = EMPTY_LOCK_GRACE_MS, busyMessage } = {}) {
  await mkdir(path.dirname(file), { recursive: true })
  const startedAt = Date.now()
  for (let attempt = 0; Date.now() - startedAt < timeoutMs; attempt++) {
    try {
      return await open(file, 'wx')
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        const info = await stat(file)
        // 空锁文件（进程在 open 与 writeFile 之间崩溃）用较短的宽限期，有内容的锁用完整 stale timeout。
        const isStale = info.size === 0
          ? Date.now() - info.mtimeMs > emptyGraceMs
          : Date.now() - info.mtimeMs > staleMs
        if (isStale) {
          // 只有 rename 成功的进程成为接管者，避免 stat→unlink→open 之间另一个等待者插入并拿到新锁。
          const takenOver = `${file}.stale-${process.pid}-${Date.now().toString(36)}`
          await rename(file, takenOver)
          await unlink(takenOver).catch(() => {})
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, backoffMs(attempt)))
    }
  }
  throw new Error(busyMessage || '文件正被其他进程写入，请稍后重试。')
}
