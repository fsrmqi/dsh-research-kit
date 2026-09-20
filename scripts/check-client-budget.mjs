#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const CLIENT_RAW_MAX = 800_000
const CLIENT_GZIP_MAX = 250_000
const CATALOG_RAW_MAX = 900_000
const PROMPTKIT_RAW_MAX = 700_000

const client = readFileSync(new URL('../ui/client.js', import.meta.url))
const catalog = readFileSync(new URL('../ui/catalog-data.json', import.meta.url))
const promptKit = readFileSync(new URL('../ui/promptkit.js', import.meta.url))
const measurements = {
  clientRaw: client.length,
  clientGzip: gzipSync(client).length,
  catalogRaw: catalog.length,
  promptKitRaw: promptKit.length,
}

const failures = [
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
