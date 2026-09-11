#!/usr/bin/env node
// diagram IR 渲染器 —— 单文件交互 HTML（路线动画/搜索/主题/SRC 证据/导出）+ 文件脚手架
// 设计契约见 docs-internal/research-route-visualization.md §5.2/§7.3。零依赖、确定性：同 IR 同字节输出。
// 用法:
//   node scripts/render-diagrams.mjs --html <diagram.json> [-o out.html]        # IR → 交互 HTML（或 stdin）
//   node scripts/render-diagrams.mjs --from-files <file...> [-o scaffold.json]  # 结果文件 → IR 脚手架
// 动画机制（参考 archify，MIT）：CSS keyframes + pathLength="1" 归一化；animationend 链式步进；
// prefers-reduced-motion 与读者开关降级；导出物不含播放运行时。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, basename, isAbsolute } from 'node:path'
import { readdirSync } from 'node:fs'

const STEP_MS = 620

// ---------- 公共 ----------
function countCatalog() {
  const count = dir => {
    try { return readdirSync(resolve('catalog', dir)).filter(f => f.endsWith('.json')).reduce((sum, f) => {
      const items = JSON.parse(readFileSync(resolve('catalog', dir, f), 'utf8'))
      return sum + items.length
    }, 0) } catch { return 0 }
  }
  const families = new Set()
  try {
    for (const f of readdirSync(resolve('catalog', 'workflows')).filter(f => f.endsWith('.json'))) {
      for (const item of JSON.parse(readFileSync(resolve('catalog', 'workflows', f), 'utf8'))) families.add(item.category)
    }
  } catch { /* 目录不可用时计 0 */ }
  return { workflows: count('workflows'), skills: count('skills'), databases: count('resources'), families: families.size }
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const KIND_SIZE = { workflow: [150, 44], params: [130, 40], skill: [140, 40], database: [140, 40], boundary: [170, 44], step: [120, 40], file: [170, 40], finding: [150, 44] }
const KIND_COLOR = { workflow: 'accent', params: 'muted', skill: 'teal', database: 'teal', boundary: 'amber', step: 'muted', file: 'accent', finding: 'accent' }

function wrapLabel(label, max = 12) {
  const text = String(label || '')
  const lines = []
  for (let i = 0; i < text.length; i += max) lines.push(text.slice(i, i + max))
  return lines.slice(0, 2)
}

// ---------- --from-files 脚手架 ----------
function scaffold(paths) {
  const nodes = []
  const col = 40
  paths.forEach((raw, i) => {
    const path = resolve(raw)
    if (!existsSync(path)) { process.stderr.write(`跳过不存在的文件: ${raw}\n`); return }
    const buf = readFileSync(path)
    const sha = createHash('sha256').update(buf).digest('hex')
    let hint = ''
    const text = buf.toString('utf8')
    if (/\.csv$/i.test(path) && text.includes('\n')) hint = `列: ${String(text.split('\n')[0]).split(',').slice(0, 6).join(' / ')}`
    else if (/\.json$/i.test(path)) { try { hint = `键: ${Object.keys(JSON.parse(text)).slice(0, 6).join(' / ')}` } catch { /* 非 JSON 内容，忽略 */ } }
    else if (text) hint = `前 40 字: ${text.slice(0, 40).replace(/\s+/g, ' ')}`
    nodes.push({
      id: `file-${i + 1}`, kind: 'file', label: basename(path),
      x: col + (i % 2) * 230, y: 60 + Math.floor(i / 2) * 78,
      note: hint, source: { path: raw, sha256: sha },
    })
  })
  const cols = Math.min(2, Math.max(nodes.length, 1))
  const width = 40 + cols * 230 + 90
  return {
    meta: { id: 'file-explain-scaffold', title: '结果文件解释图（脚手架）', locale: 'zh-CN', animation: 'none', canvas: { width: Math.max(width, 560), height: 60 + Math.ceil(nodes.length / 2) * 78 + 80 } },
    nodes, edges: [], routes: [],
  }
}

// ---------- --html 渲染 ----------
function edgeGeometry(ir) {
  const byId = new Map(ir.nodes.map(n => [n.id, n]))
  const sizeOf = n => { const [dw, dh] = KIND_SIZE[n.kind] || [140, 40]; return [Number(n.w) || dw, Number(n.h) || dh] }
  return ir.edges.map(edge => {
    const a = byId.get(edge.from), b = byId.get(edge.to)
    if (!a || !b) return null
    const [aw, ah] = sizeOf(a), [bw, bh] = sizeOf(b)
    const acx = a.x + aw / 2, acy = a.y + ah / 2, bcx = b.x + bw / 2, bcy = b.y + bh / 2
    const dx = bcx - acx, dy = bcy - acy
    const clamp = (cx, cy, hw, hh) => {
      if (dx === 0 && dy === 0) return [cx, cy]
      const t = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity)
      return [cx + dx * t, cy + dy * t]
    }
    const [x1, y1] = clamp(acx, acy, aw / 2, ah / 2)
    const [x2, y2] = clamp(bcx, bcy, bw / 2, bh / 2)
    return { ...edge, x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2 - Math.sign(dx) * 6), y2: Math.round(y2 - Math.sign(dy) * 6) }
  }).filter(Boolean)
}

function renderHtml(ir) {
  const computedValues = countCatalog()
  const edges = edgeGeometry(ir)
  const irEmbedded = JSON.stringify({ ...ir, edges }).replace(/</g, '\\u003c')
  const title = escapeHtml(ir.meta?.title || '解释图')
  const lang = ir.meta?.locale === 'en' ? 'en' : 'zh-CN'
  const disclaimer = lang === 'en'
    ? 'Generated from the authored diagram IR only; the animation replays declared facts and does not imply runtime verification. Exports carry no player runtime.'
    : '本图仅由 diagram IR 声明的事实生成；动画只回放声明内容，不代表运行时已验证。导出物不含播放运行时。'
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: var(--canvas); color: var(--ink); }
body[data-theme="light"] { --canvas:#f7f6f2; --surface:#ffffff; --ink:#1f2430; --muted:#6b7280; --line:#d7d3c8; --accent:#2563eb; --teal:#0f766e; --amber:#b45309; --amberTint:#fef3c7; --tealTint:#ccfbf1; --accentTint:#dbeafe; }
body[data-theme="dark"] { --canvas:#16181d; --surface:#22262e; --ink:#e7e9ee; --muted:#9aa1ad; --line:#3a3f49; --accent:#7fa8f5; --teal:#5ec6bb; --amber:#e5a54b; --amberTint:#4a3a1c; --tealTint:#153b37; --accentTint:#1e2c47; }
header { display:flex; align-items:center; gap:12px; padding:14px 20px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
header h1 { font-size:17px; margin:0; }
header .spacer { flex:1; }
button, select, input { font:inherit; color:var(--ink); background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:6px 10px; }
button { cursor:pointer; }
button:hover { border-color:var(--accent); }
.wrap { display:flex; gap:14px; padding:16px 20px; align-items:flex-start; flex-wrap:wrap; }
.diagram-box { flex:1 1 560px; min-width:340px; overflow:auto; border:1px solid var(--line); border-radius:12px; background:var(--canvas); }
aside { flex:0 1 300px; min-width:240px; border:1px solid var(--line); border-radius:12px; background:var(--surface); padding:12px; display:none; }
aside h2 { font-size:13px; margin:0 0 8px; color:var(--muted); font-weight:600; }
aside .src { font-size:12px; word-break:break-all; border-top:1px dashed var(--line); padding-top:8px; margin-top:8px; }
footer { padding:12px 20px; color:var(--muted); font-size:12px; border-top:1px solid var(--line); }
svg text { fill:var(--ink); }
.dg-node rect { fill:var(--surface); stroke:var(--line); stroke-width:1.5; rx:9; }
.dg-node.kind-workflow rect, .dg-node.kind-finding rect, .dg-node.kind-file rect { stroke:var(--accent); }
.dg-node.kind-skill rect, .dg-node.kind-database rect { stroke:var(--teal); fill:var(--tealTint); }
.dg-node.kind-boundary rect { stroke:var(--amber); fill:var(--amberTint); }
.dg-node.kind-params rect, .dg-node.kind-step rect { fill:var(--accentTint); }
.dg-node text { font-size:12px; }
.dg-node .src-pill { font-size:10px; fill:var(--accent); cursor:pointer; text-decoration:underline; }
.dg-edge { stroke:var(--line); stroke-width:1.6; fill:none; }
.dg-edge.lit { stroke:var(--accent); }
.dg-node.lit rect { stroke:var(--accent); stroke-width:2.2; }
.dg-node.dim, .dg-edge.dim { opacity:0.25; }
@keyframes dg-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
.dg-edge.drawing { stroke-dasharray: 1; stroke-dashoffset: 1; stroke:var(--accent); animation: dg-draw var(--dg-ms) linear forwards; }
@keyframes dg-node-in { from { opacity:.35; } to { opacity:1; } }
.dg-node.arriving { animation: dg-node-in .28s ease-out both; }
</style>
</head>
<body data-theme="light">
<header>
  <h1>${title}</h1>
  <div class="spacer"></div>
  <input id="q" type="search" placeholder="${lang === 'en' ? 'Search nodes' : '搜索节点'}" aria-label="search">
  <select id="routeSel" aria-label="route"></select>
  <button id="btnPlay">${lang === 'en' ? 'Play route' : '播放路线'}</button>
  <button id="btnTheme">${lang === 'en' ? 'Theme' : '主题'}</button>
  <button id="btnPng">PNG</button>
  <button id="btnCard">1200×630</button>
</header>
<div class="wrap">
  <div class="diagram-box"><svg id="dg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}"></svg></div>
  <aside id="srcBar"><h2>${lang === 'en' ? 'Source evidence' : '事实出处'}</h2><div id="srcBody"></div></aside>
</div>
<footer>${escapeHtml(disclaimer)}</footer>
<script>
window.__DIAGRAM__ = ${irEmbedded};
window.__METRICS__ = ${JSON.stringify(computedValues).replace(/</g, '\\u003c')};
</script>
<script>
(function () {
  'use strict';
  var IR = window.__DIAGRAM__;
  var svg = document.getElementById('dg');
  var NS = 'http://www.w3.org/2000/svg';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var currentRoute = '';
  var litCount = 0;
  function el(name, attrs, text) {
    var node = document.createElementNS(NS, name);
    for (var key in attrs || {}) node.setAttribute(key, attrs[key]);
    if (text != null) node.textContent = text;
    return node;
  }
  function computeMetrics(metric) {
    return (window.__METRICS__ || {})[metric];
  }
  function build() {
    svg.setAttribute('viewBox', '0 0 ' + IR.meta.canvas.width + ' ' + IR.meta.canvas.height);
    svg.setAttribute('width', Math.min(IR.meta.canvas.width, 1100));
    svg.setAttribute('height', Math.round(Math.min(IR.meta.canvas.width, 1100) * IR.meta.canvas.height / IR.meta.canvas.width));
    var defs = el('defs');
    var marker = el('marker', { id: 'dg-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto' });
    marker.appendChild(el('path', { d: 'M0,0 L0,6 L7,3 z', fill: 'var(--line)' }));
    defs.appendChild(marker); svg.appendChild(defs);
    IR.edges.forEach(function (e) {
      var p = el('path', { class: 'dg-edge', id: 'edge-' + e.id, d: 'M' + e.x1 + ',' + e.y1 + ' L' + e.x2 + ',' + e.y2, 'marker-end': 'url(#dg-arrow)', pathLength: '1' });
      p.dataset.edgeId = e.id; svg.appendChild(p);
      if (e.label) {
        var t = el('text', { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 - 5, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, e.label);
        t.dataset.edgeLabelFor = e.id; svg.appendChild(t);
      }
    });
    IR.nodes.forEach(function (n) {
      var w = n.w || ({ workflow:150, params:130, skill:140, database:140, boundary:170, step:120, file:170, finding:150 }[n.kind] || 140);
      var h = n.h || ({ workflow:44, boundary:44, finding:44 }[n.kind] || 40);
      var g = el('g', { class: 'dg-node kind-' + n.kind, transform: 'translate(' + n.x + ',' + n.y + ')' });
      g.dataset.nodeId = n.id;
      g.appendChild(el('rect', { width: w, height: h, rx: 9 }));
      var suffix = '';
      (IR.computed || []).forEach(function (c) { if (c.nodeId === n.id) suffix = ' ' + (computeMetrics(c.metric) != null ? '(' + metricName(c.metric) + ' ' + computeMetrics(c.metric) + ')' : ''); });
      var lines = wrap12(String(n.label) + suffix);
      lines.forEach(function (line, li) {
        g.appendChild(el('text', { x: 10, y: 17 + li * 15, 'font-size': 12 }, line));
      });
      if (n.source) {
        var pill = el('text', { class: 'src-pill', x: w - 34, y: h - 6, 'font-size': 10 }, 'SRC');
        pill.addEventListener('click', function () { showSource(n); });
        g.appendChild(pill);
      }
      svg.appendChild(g);
    });
  }
  function metricName(m) { return ({ workflows: '工作流', skills: '技能', databases: '数据源', families: '流程族' })[m] || m; }
  function wrap12(text) {
    var out = []; for (var i = 0; i < text.length && out.length < 2; i += 12) out.push(text.slice(i, i + 12));
    if (text.length > 24) out[1] = out[1].slice(0, 11) + '…';
    return out;
  }
  function showSource(n) {
    var bar = document.getElementById('srcBar'); var body = document.getElementById('srcBody');
    body.innerHTML = '';
    var p = document.createElement('div'); p.className = 'src'; p.textContent = (n.label || n.id) + ' ← ' + n.source.path + (n.source.anchor ? ' · ' + n.source.anchor : '') + (n.source.sha256 ? ' · sha256:' + String(n.source.sha256).slice(0, 12) : '');
    body.appendChild(p); bar.style.display = 'block';
  }
  function routeEdges(routeId) {
    var route = (IR.routes || []).find(function (r) { return r.id === routeId });
    if (!route) return [];
    return route.edgeIds.map(function (id) { return document.getElementById('edge-' + id) }).filter(Boolean);
  }
  function resetLit() {
    Array.prototype.forEach.call(svg.querySelectorAll('.dg-edge.lit, .dg-edge.drawing'), function (e) { e.classList.remove('lit', 'drawing'); e.style.removeProperty('--dg-ms'); e.style.removeProperty('animation-delay'); });
    Array.prototype.forEach.call(svg.querySelectorAll('.dg-node.lit, .dg-node.arriving'), function (n) { n.classList.remove('lit', 'arriving'); n.style.removeProperty('animation-delay'); });
    litCount = 0;
  }
  function play(routeId, upTo) {
    resetLit();
    currentRoute = routeId || currentRoute;
    var edges = routeEdges(currentRoute);
    if (!edges.length) return;
    var limit = upTo != null ? Math.min(upTo, edges.length) : edges.length;
    if (reduced) {
      edges.slice(0, limit).forEach(function (e) { e.classList.add('lit') });
      lightNodes(currentRoute, limit, 0);
      litCount = limit; return;
    }
    edges.slice(0, limit).forEach(function (e, i) {
      e.style.setProperty('--dg-ms', STEP_MS + 'ms');
      e.style.animationDelay = (i * STEP_MS) + 'ms';
      e.classList.add('drawing');
      e.addEventListener('animationend', function () { e.classList.remove('drawing'); e.classList.add('lit'); }, { once: true });
    });
    lightNodes(currentRoute, limit, STEP_MS);
    litCount = limit;
    syncHash();
  }
  function lightNodes(routeId, limit, baseDelay) {
    var route = (IR.routes || []).find(function (r) { return r.id === routeId }); if (!route) return;
    var byEdge = new Map(IR.edges.map(function (e) { return [e.id, e] }));
    var litNodes = new Set();
    route.edgeIds.slice(0, limit).forEach(function (id, i) {
      var e = byEdge.get(id); if (!e) return;
      [e.from, e.to].forEach(function (nid) {
        if (litNodes.has(nid)) return; litNodes.add(nid);
        var g = svg.querySelector('[data-node-id="' + nid + '"]'); if (!g) return;
        if (reduced) { g.classList.add('lit'); return; }
        g.style.animationDelay = (baseDelay + i * STEP_MS) + 'ms';
        g.classList.add('arriving');
        g.addEventListener('animationend', function () { g.classList.add('lit'); g.classList.remove('arriving'); }, { once: true });
      });
    });
  }
  function syncHash() {
    var parts = [];
    if (currentRoute) parts.push('#route=' + encodeURIComponent(currentRoute));
    if (litCount) parts.push('&step=' + litCount);
    history.replaceState(null, '', location.pathname + location.search + parts.join(''));
  }
  function applySearch(text) {
    var hit = new Set();
    IR.nodes.forEach(function (n) { if (!text || String(n.label).indexOf(text) >= 0 || String(n.note || '').indexOf(text) >= 0) hit.add(n.id); });
    var near = new Set();
    IR.edges.forEach(function (e) { if (hit.has(e.from) && hit.has(e.to)) near.add(e.id); });
    Array.prototype.forEach.call(svg.querySelectorAll('.dg-node'), function (g) { g.classList.toggle('dim', text && !hit.has(g.dataset.nodeId)); });
    Array.prototype.forEach.call(svg.querySelectorAll('.dg-edge'), function (p) { p.classList.toggle('dim', text && !near.has(p.dataset.edgeId)); });
  }
  document.getElementById('btnTheme').addEventListener('click', function () {
    var body = document.body;
    body.dataset.theme = body.dataset.theme === 'dark' ? 'light' : 'dark';
  });
  document.getElementById('q').addEventListener('input', function (event) { applySearch(event.target.value.trim()); });
  var sel = document.getElementById('routeSel');
  (IR.routes || []).forEach(function (r) {
    var opt = document.createElement('option'); opt.value = r.id; opt.textContent = r.label || r.id; sel.appendChild(opt);
  });
  sel.addEventListener('change', function () { play(sel.value); });
  document.getElementById('btnPlay').addEventListener('click', function () { play(sel.value || (IR.routes || [])[0] && IR.routes[0].id); });
  document.getElementById('btnPng').addEventListener('click', function () { exportPng(); });
  document.getElementById('btnCard').addEventListener('click', function () { exportCard(); });
  function svgString() {
    var clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', NS);
    var bg = getComputedStyle(document.body).getPropertyValue('--canvas').trim();
    var rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%'); rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  }
  function drawToCanvas(width, height, drawExtra) {
    return new Promise(function (done, reject) {
      var image = new Image();
      var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString());
      image.onload = function () {
        var canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--canvas').trim();
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, image.width, image.height);
        if (drawExtra) drawExtra(ctx, width, height);
        canvas.toBlob(function (blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (IR.meta.id || 'diagram') + (width === 1200 ? '-share-card' : '') + '.png';
          a.click(); done();
        }, 'image/png');
      };
      image.onerror = reject; image.src = url;
    });
  }
  function exportPng() { drawToCanvas(svg.clientWidth || IR.meta.canvas.width, svg.clientHeight || IR.meta.canvas.height).catch(function () { alert('PNG 导出失败；可改用浏览器截图。') }); }
  function exportCard() {
    drawToCanvas(1200, 630, function (ctx, w, h) {
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--ink').trim();
      ctx.font = '600 26px system-ui';
      ctx.fillText(IR.meta.title || '', 40, 52);
      ctx.font = '12px system-ui';
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim();
      ctx.fillText('dsh-research-kit · 动画只回放声明事实，需人工核验', 40, h - 28);
    }).catch(function () { alert('分享卡导出失败。') });
  }
  var hashMatch = /#route=([^&]+)(?:&step=(\\d+))?/.exec(location.hash || '');
  if (hashMatch) {
    sel.value = decodeURIComponent(hashMatch[1]);
    play(sel.value, hashMatch[2] ? Number(hashMatch[2]) : undefined);
  }
  build();
})();
</script>
</body>
</html>`
}

// ---------- main ----------
function main() {
  const args = process.argv.slice(2)
  const mode = args[0]
  const outFile = (() => { const i = args.indexOf('-o'); return i >= 0 ? args[i + 1] : null })()
  if (mode === '--from-files') {
    const paths = args.slice(1).filter(a => a !== '-o' && a !== outFile)
    if (!paths.length) { process.stderr.write('用法: --from-files <file...> [-o out.json]\n'); process.exitCode = 2; return }
    const ir = scaffold(paths)
    const json = JSON.stringify(ir, null, 2) + '\n'
    if (outFile) writeFileSync(outFile, json); else process.stdout.write(json)
    process.stderr.write(`脚手架: ${ir.nodes.length} 个文件节点（确定性；语义留给你来补全，findings 必须挂 source）\n`)
    return
  }
  if (mode === '--html') {
    const file = args[1] && args[1] !== '-o' ? args[1] : null
    const ir = JSON.parse(file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8'))
    const html = renderHtml(ir)
    if (outFile) writeFileSync(outFile, html); else process.stdout.write(html)
    process.stderr.write(`交互 HTML 已生成（${ir.nodes?.length || 0} 节点 / ${ir.edges?.length || 0} 边 / ${(ir.routes || []).length} 路线）\n`)
    return
  }
  process.stderr.write('用法:\n  render-diagrams.mjs --html <diagram.json> [-o out.html]\n  render-diagrams.mjs --from-files <file...> [-o out.json]\n')
  process.exitCode = 2
}

main()
