import path from 'node:path'
import os from 'node:os'

const DEFAULT_DATA_HOME = path.join(os.homedir(), '.dsh-research-kit')
const configuredHome = String(process.env.DSH_RESEARCH_KIT_HOME || '').trim()
export const DATA_HOME = configuredHome ? path.resolve(configuredHome) : DEFAULT_DATA_HOME

function dataPath(...segments) {
  return path.join(DATA_HOME, ...segments)
}

export { dataPath }

// 调用轨迹只有一个真源文件：写入方 `mcp/execution/call-logger.js` 与读取方
// `dsh/agent-activity.js` 都从这里取路径。两侧的读取策略本就不同（写入方要覆盖轮转文件，
// 读取方要按文件尾部有界读取并按闭区间过滤），但「轨迹落在哪」必须是同一个答案。
export const CALL_LOG_FILE = dataPath('logs', 'calls.jsonl')
