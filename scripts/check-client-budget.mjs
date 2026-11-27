#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const CLIENT_RAW_MAX = 720_000
const CLIENT_GZIP_MAX = 230_000
const CATALOG_RAW_MAX = 280_000
const PROMPTKIT_RAW_MAX = 580_000

const client = readFileSync(new URL('../ui/client.js', import.meta.url))
const catalog = readFileSync(new URL('../ui/catalog-data.json', import.meta.url))
const promptKit = readFileSync(new URL('../ui/promptkit.js', import.meta.url))
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const buildStats = /^const RESEARCH_KIT_BUILD_STATS = (\{[^\r\n]+\})$/m.exec(client.toString('utf8'))
const clientVersion = buildStats ? JSON.parse(buildStats[1]).version : ''
const measurements = {
  clientRaw: client.length,
  clientGzip: gzipSync(client).length,
  catalogRaw: catalog.length,
  promptKitRaw: promptKit.length,
}

const failures = [
  clientVersion !== packageVersion && `客户端版本 ${clientVersion || '缺失'} 与 package.json 的 ${packageVersion} 不一致，请运行 npm run build。`,
  measurements.clientRaw > CLIENT_RAW_MAX && `client.js 原始体积 ${measurements.clientRaw} > ${CLIENT_RAW_MAX}`,
  measurements.clientGzip > CLIENT_GZIP_MAX && `client.js gzip 体积 ${measurements.clientGzip} > ${CLIENT_GZIP_MAX}`,
  measurements.catalogRaw > CATALOG_RAW_MAX && `catalog-data.json 体积 ${measurements.catalogRaw} > ${CATALOG_RAW_MAX}`,
  measurements.promptKitRaw > PROMPTKIT_RAW_MAX && `promptkit.js 体积 ${measurements.promptKitRaw} > ${PROMPTKIT_RAW_MAX}`,
].filter(Boolean)

if (failures.length) {
  for (const failure of failures) console.error(`✗ ${failure}`)
  process.exitCode = 1
} else {
  console.log(`客户端预算通过：client ${measurements.clientRaw} B / gzip ${measurements.clientGzip} B；catalog ${measurements.catalogRaw} B；promptkit ${measurements.promptKitRaw} B`)
}
