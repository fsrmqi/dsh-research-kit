// 文献互操作只处理引用元数据；不导入摘要、附件或全文。
export function normalizeBibliography(input = {}) {
  const trim = (value, max = 200) => String(value || '').trim().slice(0, max)
  return { authors: (Array.isArray(input.authors) ? input.authors : []).map(value => trim(value, 120)).filter(Boolean).slice(0, 100),
    year: trim(input.year, 12), journal: trim(input.journal), volume: trim(input.volume, 40), issue: trim(input.issue, 40), pages: trim(input.pages, 60) }
}

function bibliographyFieldsToEntry(fields, authors = []) {
  const doi = String(fields.doi || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim()
  const url = String(fields.url || '').trim()
  const identifier = doi || fields.pmid || fields.arxiv || ''
  const title = String(fields.title || '').trim()
  if (!title || (!identifier && !/^https?:\/\//i.test(url))) throw new Error('文献缺少标题或可追溯的 DOI／链接。')
  return { title, url: url || (doi ? `https://doi.org/${doi}` : ''), identifier,
    identifierKind: doi ? 'doi' : fields.pmid ? 'pmid' : fields.arxiv ? 'arxiv' : 'none',
    sourceDatabase: '文献导入', status: 'unverified',
    bibliography: normalizeBibliography({ authors, year: fields.year, journal: fields.journal, volume: fields.volume, issue: fields.number, pages: fields.pages }) }
}

function parseBibtexRecords(text) {
  const records = []; const warnings = []
  let at = 0
  const space = () => { while (at < text.length && /[\s,]/.test(text[at])) at++ }
  while (at < text.length) {
    at = text.indexOf('@', at)
    if (at < 0) break
    const start = at
    const head = /^@([a-z]+)\s*([{(])\s*/i.exec(text.slice(at))
    if (!head) { at++; continue }
    const type = head[1].toLowerCase(); const endChar = head[2] === '{' ? '}' : ')'
    at += head[0].length
    if (['comment', 'preamble', 'string'].includes(type)) {
      let depth = 1; let quoted = false
      while (at < text.length && depth) {
        const char = text[at++]
        if (char === '\\') { at++; continue }
        if (char === '"') quoted = !quoted
        if (!quoted && char === head[2]) depth++
        if (!quoted && char === endChar) depth--
      }
      if (depth) warnings.push('未闭合的 BibTeX 注释或宏定义已跳过。')
      continue
    }
    const keyEnd = text.indexOf(',', at)
    if (keyEnd < 0) { warnings.push('不完整的 BibTeX 条目已跳过。'); break }
    const key = text.slice(at, keyEnd).trim(); at = keyEnd + 1
    const fields = {}; let invalid = false
    while (at < text.length) {
      space()
      if (text[at] === endChar) { at++; break }
      const field = /^([a-z][\w-]*)\s*=\s*/i.exec(text.slice(at))
      if (!field) { invalid = true; at++; break }
      at += field[0].length
      let value = ''
      if (text[at] === '{' || text[at] === '"') {
        const open = text[at++]; let depth = open === '{' ? 1 : 0; let closed = false
        while (at < text.length) {
          const char = text[at++]
          if (char === '\\' && at < text.length) { value += char + text[at++]; continue }
          if (open === '{' && char === '{') depth++
          if (open === '{' && char === '}') { depth--; if (depth === 0) { closed = true; break } }
          // 非闭括号不得减少深度。
          if (open === '"' && char === '"') { closed = true; break }
          value += char
        }
        if (!closed) invalid = true
      } else {
        const match = /^[^,}\n)]+/.exec(text.slice(at))
        value = match?.[0]?.trim() || ''; at += match?.[0]?.length || 0
        if (!/^\d+$/.test(value)) invalid = true // 宏与 # 拼接不猜测、不伪造。
      }
      fields[field[1].toLowerCase()] = value.replace(/\\([{}"\\])/g, '$1').trim()
      space()
      if (text[at] === '#') { invalid = true; break }
    }
    if (!['comment', 'preamble', 'string'].includes(type)) {
      if (invalid) warnings.push(`BibTeX ${key || start} 含不完整字段或不支持的宏，已跳过。`)
      else records.push({ fields, authors: (fields.author || '').split(/\s+and\s+/i) })
    }
    if (records.length > 1000) throw new Error('一次最多导入 1000 条引用，请拆分文件。')
  }
  return { records, warnings }
}

export function parseBibliography(text, format = 'auto') {
  const source = String(text || '')
  if (new TextEncoder().encode(source).byteLength > 2_000_000) throw new Error('引用文件超过 2 MB，请拆分导入。')
  const resolved = format === 'auto' ? (/^\s*(?:%[^\n]*(?:\n|$)\s*)*@/.test(source) ? 'bibtex' : 'ris') : format
  let records = []; let warnings = []
  if (resolved === 'bibtex') ({ records, warnings } = parseBibtexRecords(source))
  else if (resolved === 'ris') {
    let fields = null; let authors = []
    for (const line of source.split(/\r?\n/)) {
      const match = /^([A-Z0-9]{2})\s+-\s?(.*)$/.exec(line)
      if (!match) continue
      const [, tag, value] = match
      if (tag === 'TY') { if (fields) warnings.push('未闭合 RIS 条目已跳过。'); fields = {}; authors = [] }
      else if (tag === 'ER' && fields) { records.push({ fields, authors }); fields = null }
      else if (fields) {
        if (['AU', 'A1'].includes(tag)) authors.push(value)
        const key = ({ TI: 'title', T1: 'title', DO: 'doi', UR: 'url', PY: 'year', Y1: 'year', JO: 'journal', JF: 'journal', T2: 'journal', VL: 'volume', IS: 'number', SP: 'pages', EP: 'endPage' })[tag]
        if (key && !fields[key]) fields[key] = value
      }
      if (records.length > 1000) throw new Error('一次最多导入 1000 条引用，请拆分文件。')
    }
    if (fields) warnings.push('未闭合 RIS 条目已跳过。')
  } else throw new Error('请选择 BibTeX 或 RIS 格式。')
  const entries = []; const seen = new Set()
  for (const [index, record] of records.entries()) {
    try {
      if (record.fields.endPage) record.fields.pages = `${record.fields.pages || ''}-${record.fields.endPage}`
      record.fields.year = (record.fields.year || '').split('/')[0]
      const entry = bibliographyFieldsToEntry(record.fields, record.authors)
      const key = `${entry.identifierKind}:${entry.identifier || entry.url}`.toLowerCase()
      if (seen.has(key)) { warnings.push(`第 ${index + 1} 条引用重复，已跳过。`); continue }
      seen.add(key); entries.push(entry)
    } catch (error) { warnings.push(`第 ${index + 1} 条：${error.message}`) }
  }
  if (!records.length) warnings.push('未识别到完整引用；支持常规 BibTeX 字段或 TY–ER 结构的 RIS。')
  return { entries, warnings, format: resolved }
}

export function serializeBibliography(entries = [], format = 'bibtex') {
  const line = value => String(value || '').replace(/[\r\n]+/g, ' ').trim()
  const bib = value => line(value).replace(/\\/g, '\\\\').replace(/[{}]/g, char => `\\${char}`)
  return entries.map((entry, index) => {
    const meta = normalizeBibliography(entry.bibliography)
    const fields = { title: entry.title, author: meta.authors.join(' and '), year: meta.year, journal: meta.journal,
      volume: meta.volume, number: meta.issue, pages: meta.pages, url: entry.url,
      doi: entry.identifierKind === 'doi' ? entry.identifier : '' }
    if (format === 'ris') return ['TY  - JOUR', `TI  - ${line(entry.title)}`, ...meta.authors.map(author => `AU  - ${line(author)}`),
      ...Object.entries({ PY: meta.year, JO: meta.journal, VL: meta.volume, IS: meta.issue, SP: meta.pages, DO: fields.doi, UR: fields.url }).filter(([, value]) => value).map(([tag, value]) => `${tag}  - ${line(value)}`), 'ER  -', ''].join('\n')
    if (format !== 'bibtex') throw new Error('未知引用导出格式。')
    return `@article{research${index + 1},\n${Object.entries(fields).filter(([, value]) => value).map(([key, value]) => `  ${key} = {${bib(value)}}`).join(',\n')}\n}\n`
  }).join('\n')
}
