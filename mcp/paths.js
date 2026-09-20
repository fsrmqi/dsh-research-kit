import path from 'node:path'
import os from 'node:os'

const DEFAULT_DATA_HOME = path.join(os.homedir(), '.dsh-research-kit')
const configuredHome = String(process.env.DSH_RESEARCH_KIT_HOME || '').trim()
export const DATA_HOME = configuredHome ? path.resolve(configuredHome) : DEFAULT_DATA_HOME

function dataPath(...segments) {
  return path.join(DATA_HOME, ...segments)
}

export { dataPath }
