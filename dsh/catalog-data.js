import { readFileSync } from 'node:fs'
import { staticArtifactRoute } from './static-artifact-route.js'

export const CATALOG_DATA_PATH = '/dsh-research-kit/catalog-data'

const body = readFileSync(new URL('../ui/catalog-data.json', import.meta.url), 'utf8')

export function catalogDataRoute() {
  return staticArtifactRoute({ path: CATALOG_DATA_PATH, body, contentType: 'application/json; charset=utf-8' })
}
