import { readFileSync } from 'node:fs'
import { staticArtifactRoute } from './static-artifact-route.js'

export const ARCHIFY_TEMPLATE_PATH = '/dsh-research-kit/archify-template'

// 模板只在用户弹出完整回放窗口时使用；保留在服务端，避免 774KB HTML 进入主 JS。
const template = readFileSync(new URL('../vendor/archify/template.html', import.meta.url), 'utf8')

export function archifyTemplateRoute() {
  return staticArtifactRoute({ path: ARCHIFY_TEMPLATE_PATH, body: template, contentType: 'text/html; charset=utf-8' })
}
