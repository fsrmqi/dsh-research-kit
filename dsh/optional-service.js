// 可选能力探测：宿主服务不保证在每个 DSH 版本 / 每种装配里都存在。
//
// 与兼容矩阵（docs/COMPATIBILITY.md）共用同一套规则：
//   1. 可选服务只能从这里取，**绝不写进 dsh.client.inject**。inject 里缺一个名字会让宿主
//      拒绝装载整个插件（客户端侧尤其致命——用户看到的是插件不见了）；可选能力缺失
//      只该让某个功能降级，界面按「未知 / 未连接」如实呈现。
//   2. `ctx.get` 本身可能在旧宿主上不存在，也可能对未知名字抛错：两种都退化为「不可用」，
//      绝不让探测反过来打断插件装载。
//   3. 探测只回答「装配事实」：挂载 ≠ 某个具体数据源可用，与 dsh/host-capabilities.js
//      的门槛一致，不改写目录标注。
//
// 本文件属于宿主半区，不进浏览器产物。
export const OPTIONAL_SERVICES = [
  { name: 'tools', label: '工具注册表（MCP 与内建工具）' },
  { name: 'shell', label: 'Shell 执行' },
  { name: 'fs', label: '文件系统' },
]

/** 取一个可选服务；不存在 / 名字非法 / ctx.get 抛错 → null（不可用）。 */
export function resolveOptionalService(ctx, name) {
  if (typeof name !== 'string' || !name) return null
  try {
    const get = ctx?.get
    if (typeof get !== 'function') return null
    const service = get.call(ctx, name)
    // 非对象（含 true / 'yes' 之类的占位值）一律当作不可用：消费方需要的是能调方法的服务。
    return service && typeof service === 'object' ? service : null
  } catch {
    return null
  }
}

/** 按清单一次性探测，返回 { services, available }：services 可直接喂给路由，available 供上报。 */
export function resolveOptionalServices(ctx, services = OPTIONAL_SERVICES) {
  const resolved = {}
  const available = {}
  for (const entry of services) {
    const name = typeof entry === 'string' ? entry : entry?.name
    if (!name) continue
    const service = resolveOptionalService(ctx, name)
    resolved[name] = service
    available[name] = service !== null
  }
  return { services: resolved, available }
}

/** 给界面/日志用的可读清单：只描述事实，不含任何服务对象（避免误把实例写进日志）。 */
export function describeOptionalServices(available = {}, services = OPTIONAL_SERVICES) {
  return services.map(entry => ({
    name: entry.name,
    label: entry.label,
    available: available[entry.name] === true,
  }))
}
