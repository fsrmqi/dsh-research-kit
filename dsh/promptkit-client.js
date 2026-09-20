import { readFileSync } from 'node:fs'
import { staticArtifactRoute } from './static-artifact-route.js'

export const PROMPTKIT_CLIENT_PATH = '/dsh-research-kit/promptkit-client'

// 方法工坊与草稿增强器首次需要时才加载，避免 PromptKit 进入首屏主包。
const client = readFileSync(new URL('../ui/promptkit.js', import.meta.url), 'utf8')

export function promptKitClientRoute() {
  return staticArtifactRoute({ path: PROMPTKIT_CLIENT_PATH, body: client, contentType: 'text/javascript; charset=utf-8' })
}
