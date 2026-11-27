import { normalizeDoi } from './identifiers.js'

const REFERENCE_HEADING = /^(?:#{1,6}\s+)?(?:参考文献|references|bibliography)\s*[:：]?\s*#*$/i
const REFERENCE_ENTRY = /^(?:\[(\d+)\]|(\d+)[.、)](?!\d))\s*(.*)$/
const NUMERIC_CITATION = /\[(\d+(?:\s*[-–—]\s*\d+)?(?:\s*[,，;；]\s*\d+(?:\s*[-–—]\s*\d+)?)*)\](?!\s*\()/g
const DOI = /\b10\.\d{4,9}\/(?:[-._;/:a-z0-9]|\([-._;/:a-z0-9]+\))+/gi

export function auditNumberedReferences(text) {
  let fence = ''
  const lines = text.split(/\r?\n/).map(line => {
    const marker = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1]
    if (!fence && marker) {
      fence = marker
      return ''
    }
    if (fence) {
      if (line.trim() === marker && marker.startsWith(fence)) fence = ''
      return ''
    }
    return line.replace(/`[^`]*`/g, '')
  })
  const heading = lines.findIndex(line => REFERENCE_HEADING.test(line.trim()))
  const results = { status: 'not_applicable', findings: [] }
  if (heading < 0) return results

  const entries = []
  for (let index = heading + 1; index < lines.length; index++) {
    const line = lines[index].trim()
    if (/^#{1,6}\s+/.test(line)) break
    const entry = line.match(REFERENCE_ENTRY)
    if (entry) {
      entries.push({ number: Number(entry[1] ?? entry[2]), line: index + 1, text: entry[3] })
    } else if (entries.length) {
      entries.at(-1).text += ' ' + line
    }
  }
  if (!entries.length) return results

  results.status = 'checked'
  const numbers = new Set(entries.map(entry => entry.number))
  const firstByDoi = new Map()
  for (const entry of entries) {
    const dois = new Set([...entry.text.matchAll(DOI)].map(([value]) => normalizeDoi(value)?.value))
    for (const doi of dois) {
      if (!doi) continue
      const first = firstByDoi.get(doi)
      if (!first) firstByDoi.set(doi, entry)
      else {
        results.findings.push({ rule: 'duplicate_doi', doi, line: entry.line, reference: entry.number, first_line: first.line, first_reference: first.number })
      }
    }
  }

  lines.slice(0, heading).forEach((line, index) => {
    for (const [citation, group] of line.matchAll(NUMERIC_CITATION)) {
      for (const value of group.split(/[,，;；]/)) {
        const [from, to = from] = value.split(/[-–—]/).map(Number)
        if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from) continue
        const expectedCount = to - from + 1
        const availableCount = from === to
          ? Number(numbers.has(from))
          : numbers.values().filter(number => number >= from && number <= to).reduce(count => count + 1, 0)
        if (availableCount < expectedCount) {
          results.findings.push({ rule: 'missing_reference', line: index + 1, citation, from, to })
        }
      }
    }
  })
  return results
}
