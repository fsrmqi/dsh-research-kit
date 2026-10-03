#!/usr/bin/env node
// 合成数据的纯逻辑门禁；不将本机毫秒数解释为真实宿主的端到端耗时。
import { performance } from 'node:perf_hooks'
import { searchCatalog } from '../src/catalog.js'
import { buildEvidenceGraph } from '../src/lib/evidence-graph-core.js'
const percentile = (rows, p) => rows.slice().sort((a, b) => a - b)[Math.min(rows.length - 1, Math.ceil(rows.length * p) - 1)]
const searches = []
const queries = ['文献综述', 'rna seq', '数据分析', 'PubMed', '不存在的资源']
for (let index = 0; index < 330; index++) {
  const start = performance.now(); searchCatalog({ query: queries[index % queries.length] })
  if (index >= 30) searches.push(performance.now() - start)
}
const queryRows = Array.from({ length: 50 }, (_, index) => ({ id: `q-${index}`, sources: Array.from({ length: 20 }, (_, source) => ({ id: `s-${index}-${source}`, url: `https://example.org/${index}/${source}` })) }))
const measurements = []
for (const count of [1000, 5000, 20000]) {
  const evidence = Array.from({ length: count }, (_, index) => ({ id: `e-${index}`, title: '合成证据', url: `https://example.org/${Math.floor(index % 1000 / 20)}/${index % 20}` }))
  const times = []
  for (let run = 0; run < 5; run++) { const start = performance.now(); const graph = buildEvidenceGraph({ queries: queryRows, savedEvidence: evidence }); times.push(performance.now() - start); if (graph.nodes.length !== count + 1050) throw new Error('图谱节点数错误') }
  measurements.push({ evidence: count, medianMs: Number(percentile(times, .5).toFixed(2)) })
}
const searchP95 = percentile(searches, .95)
console.log(JSON.stringify({ kind: 'synthetic-product-performance', node: process.versions.node, searchP95Ms: Number(searchP95.toFixed(3)), graph: measurements }, null, 2))
// 宽松门槛吸收 CI 机器差异，同时阻止重新引入全量嵌套扫描；不能代替浏览器回归。
if (searchP95 > 20 || measurements.at(-1).medianMs > 180) { console.error('性能门禁未通过：目录搜索 P95 ≤20ms，2 万证据建图中位数 ≤180ms。'); process.exitCode = 1 }
