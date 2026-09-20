
import { STYLES, STYLE_NAMES } from './figure-styles/index.js'
import { wrap, err } from './wrapper.js'

function pythonString(value) {
  return `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}'`
}

function pythonLiteral(value, indent = 0) {
  const pad = ' '.repeat(indent)
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : "float('nan')"
  if (typeof value === 'string') return pythonString(value)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return `[\n${value.map(item => `${pad}  ${pythonLiteral(item, indent + 2)}`).join(',\n')}\n${pad}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (!entries.length) return '{}'
    return `{\n${entries.map(([key, item]) => `${pad}  ${pythonString(key)}: ${pythonLiteral(item, indent + 2)}`).join(',\n')}\n${pad}}`
  }
  return pythonString(String(value))
}

function isNumberArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'number' && Number.isFinite(item))
}

function validateData(styleName, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'data 必须是对象。'
  if (styleName === 'bar_paired_delta') {
    if (!Array.isArray(data.categories) || !data.categories.length) return 'bar_paired_delta 需要 categories 数组。'
    if (!isNumberArray(data.baseline) || !isNumberArray(data.method)) return 'bar_paired_delta 需要 baseline 和 method 非空数值数组。'
    if (data.baseline.length !== data.categories.length || data.method.length !== data.categories.length) return 'baseline/method 必须与 categories 等长。'
  }
  if (styleName === 'bar_grouped_hatch') {
    if (!Array.isArray(data.categories) || !data.categories.length) return 'bar_grouped_hatch 需要 categories 数组。'
    if (!data.series || typeof data.series !== 'object' || !Object.keys(data.series).length) return 'bar_grouped_hatch 需要 series 对象。'
    for (const [name, series] of Object.entries(data.series)) {
      if (!isNumberArray(series)) return `series.${name} 必须是非空数值数组。`
      if (series.length !== data.categories.length) return `series.${name} 必须与 categories 等长。`
    }
  }
  if (styleName === 'line_confidence_band') {
    if (!data.series || typeof data.series !== 'object' || !Object.keys(data.series).length) return 'line_confidence_band 需要 series 对象。'
    for (const [name, series] of Object.entries(data.series)) {
      if (!isNumberArray(series.x) || !isNumberArray(series.mean) || !isNumberArray(series.std)) return `series.${name} 需要 x/mean/std 数组。`
      if (series.x.length !== series.mean.length || series.mean.length !== series.std.length) return `series.${name} 的 x/mean/std 必须等长。`
    }
  }
  if (styleName === 'line_loss_with_inset') {
    if (!data.series || typeof data.series !== 'object' || !Object.keys(data.series).length) return `${styleName} 需要 series 对象。`
    for (const [name, series] of Object.entries(data.series)) {
      if (!isNumberArray(series.x) || !isNumberArray(series.y)) return `series.${name} 需要 x/y 数组。`
      if (series.x.length !== series.y.length) return `series.${name} 的 x/y 必须等长。`
    }
    // zoom 显式 null → Python None.get() 报错
    if (data.zoom !== undefined && data.zoom !== null) {
      if (typeof data.zoom !== 'object') return 'zoom 必须是对象或省略。'
    } else if (data.zoom === null) {
      return 'zoom 不能为 null，请省略该字段。'
    }
  }

  if (styleName === 'scatter_broken_axis') {
    if (!data.series || typeof data.series !== 'object' || !Object.keys(data.series).length) return 'scatter_broken_axis 需要 series 对象。'
    for (const [name, series] of Object.entries(data.series)) {
      if (!isNumberArray(series.x) || !isNumberArray(series.y)) return `series.${name} 需要 x/y 数组。`
      if (series.x.length !== series.y.length) return `series.${name} 的 x/y 必须等长。`
    }
    // break_x 显式 null → Python None
    if (data.break_x !== undefined && data.break_x !== null) {
      if (typeof data.break_x !== 'number') return 'break_x 必须是数字或省略。'
    } else if (data.break_x === null) {
      return 'break_x 不能为 null，请省略该字段。'
    }
  }

  if (styleName === 'radar_dual_series') {
    if (!Array.isArray(data.categories) || data.categories.length < 3) return 'radar_dual_series 至少需要 3 个 categories。'
    if (!data.series || typeof data.series !== 'object' || Object.keys(data.series).length < 1) return 'radar_dual_series 需要 series。'
    for (const [name, series] of Object.entries(data.series)) {
      if (!isNumberArray(series.values)) return `series.${name}.values 必须是非空数值数组。`
      if (series.values.length !== data.categories.length) return `series.${name}.values 必须与 categories 等长。`
    }
    // vmin/vmax 显式 null → Python None
    if (data.vmin !== undefined && data.vmin !== null) {
      if (typeof data.vmin !== 'number') return 'vmin 必须是数字或省略。'
    } else if (data.vmin === null) {
      return 'vmin 不能为 null，请省略该字段。'
    }
    if (data.vmax !== undefined && data.vmax !== null) {
      if (typeof data.vmax !== 'number') return 'vmax 必须是数字或省略。'
    } else if (data.vmax === null) {
      return 'vmax 不能为 null，请省略该字段。'
    }
  }

  if (styleName === 'forest_plot') {
    if (!Array.isArray(data.studies) || data.studies.length < 2) return 'forest_plot 需要至少 2 个 studies。'
    for (const [i, s] of data.studies.entries()) {
      if (!s.name || !Number.isFinite(Number(s.effect)) || !Number.isFinite(Number(s.ci_lower)) || !Number.isFinite(Number(s.ci_upper)))
        return `studies[${i}] 需要 name/effect/ci_lower/ci_upper。`
    }
  }
  if (styleName === 'funnel_plot') {
    if (!Array.isArray(data.studies) || data.studies.length < 3) return 'funnel_plot 需要至少 3 个 studies。'
    for (const [i, s] of data.studies.entries()) {
      if (!Number.isFinite(Number(s.effect)) || !Number.isFinite(Number(s.se)))
        return `studies[${i}] 需要 effect 和 se。`
    }
  }
  if (styleName === 'heatmap') {
    if (!Array.isArray(data.matrix) || !data.matrix.length) return 'heatmap 需要 matrix 二维数组。'
    if (!Array.isArray(data.labels) || !data.labels.length) return 'heatmap 需要 labels 数组。'
    if (data.matrix.length !== data.labels.length) return 'matrix 行数必须等于 labels 长度。'
    for (const row of data.matrix) {
      if (!Array.isArray(row) || row.length !== data.labels.length) return 'matrix 必须是方阵且每行长度等于 labels。'
    }
  }

  return null
}

function plotCode(styleName) {
  if (styleName === 'bar_paired_delta') return `
ax = fig.add_subplot(111)
categories = DATA['categories']
baseline = np.asarray(DATA['baseline'], dtype=float)
method = np.asarray(DATA['method'], dtype=float)
x = np.arange(len(categories))
bar_w = STYLE_LAYOUT['bar_width']
gap = STYLE_LAYOUT['gap']
ax.bar(x - gap / 2 - bar_w / 2, baseline, width=bar_w, color=STYLE_COLORS['baseline'], label='Baseline', zorder=2)
ax.bar(x + gap / 2 + bar_w / 2, method, width=bar_w, color=STYLE_COLORS['method'], label='Method', zorder=2)
for i in range(len(categories)):
    ratio = ((method[i] - baseline[i]) / baseline[i] * 100) if baseline[i] != 0 else (method[i] - baseline[i])
    # 负增益标注不带前导 +，baseline==0 时用绝对值且不带 % 符号
    if baseline[i] == 0:
        ax.annotate(f'{method[i]:+.1f}', xy=(x[i] + gap / 2 + bar_w / 2, method[i]), ha='center', va='bottom',
                    fontsize=9.5, fontweight='bold', color=STYLE_COLORS['delta'])
    else:
        sign = '+' if method[i] >= baseline[i] else ''
        ax.annotate(f'{sign}{ratio:.1f}%', xy=(x[i] + gap / 2 + bar_w / 2, method[i]), ha='center', va='bottom',
                    fontsize=9.5, fontweight='bold', color=STYLE_COLORS['delta'])
    ax.plot([x[i] - gap / 2 - bar_w / 2, x[i] + gap / 2 + bar_w / 2], [baseline[i], baseline[i]],
            color='black', linestyle='--', linewidth=0.8, zorder=1)
ax.set_xticks(x)
ax.set_xticklabels(categories)
for spine in ax.spines.values():
    spine.set_linewidth(STYLE_LAYOUT['spine_linewidth'])
ax.legend(loc='upper left')
`

  if (styleName === 'bar_grouped_hatch') return `
ax = fig.add_subplot(111)
categories = DATA['categories']
series = DATA['series']
x = np.arange(len(categories))
n = len(series)
bar_w = STYLE_LAYOUT['bar_total_width'] / n
palette = STYLE_COLORS.get('ablation') or list(STYLE_COLORS.values())[0]
for i, (label, values) in enumerate(series.items()):
    offset = (i - n / 2 + 0.5) * bar_w
    color = palette[i % len(palette)]
    hatch = '//' if i == n - 1 else ''
    bars = ax.bar(x + offset, values, width=bar_w, color=color, hatch=hatch, label=label,
                  edgecolor='white', linewidth=0.8, zorder=2)
    for bar, value in zip(bars, values):
        is_best = i == n - 1
        ax.text(bar.get_x() + bar.get_width() / 2, value, f'{value:.1f}', ha='center', va='bottom',
                fontsize=8.7, color='#8B0000' if is_best else '#111111',
                fontweight='bold' if is_best else 'normal')
ax.set_xticks(x)
ax.set_xticklabels(categories)
ax.grid(axis='y', color=STYLE_LAYOUT['grid_color'], linewidth=0.7, zorder=0)
ax.set_axisbelow(True)
ax.legend(loc='upper right')
`

  if (styleName === 'line_confidence_band') return `
ax = fig.add_subplot(111)
for name, series in DATA['series'].items():
    x = np.asarray(series['x'], dtype=float)
    mean = np.asarray(series['mean'], dtype=float)
    std = np.asarray(series['std'], dtype=float)
    color = series.get('color', list(STYLE_COLORS.values())[0])
    ax.fill_between(x, mean - std, mean + std, color=color, alpha=0.15)
    ax.plot(x, mean, color=color, linewidth=1.8, label=name)
for side, spine in ax.spines.items():
    spine.set_visible(side in ('left', 'bottom'))
ax.legend(framealpha=0, edgecolor='none')
`

  if (styleName === 'line_training_curve') return `
ax = fig.add_subplot(111)
all_x = np.concatenate([np.asarray(s['x'], dtype=float) for s in DATA['series'].values()])
all_y = np.concatenate([np.asarray(s['y'], dtype=float) for s in DATA['series'].values()])
for name, series in DATA['series'].items():
    ax.plot(series['x'], series['y'], color=series.get('color', '#1F77B4'), linewidth=1.5, label=name)
# line_training_curve 是折线图，不使用极坐标或 categories
# 可选的 zoom inset 若存在则添加局部放大
zoom = DATA.get('zoom', {})
if zoom and isinstance(zoom, dict):
    zx1 = float(zoom.get('x1', np.min(all_x) + np.ptp(all_x) * 0.55))
    zx2 = float(zoom.get('x2', np.max(all_x)))
    zy1 = float(zoom.get('y1', np.min(all_y)))
    zy2 = float(zoom.get('y2', np.min(all_y) + np.ptp(all_y) * 0.45))
    rect = mpatches.Rectangle((zx1, zy1), zx2 - zx1, zy2 - zy1, fill=False, linestyle='--',
                               edgecolor='#333333', linewidth=1.0, zorder=5)
    ax.add_patch(rect)
    ax_inset = fig.add_axes([0.63, 0.18, 0.27, 0.31])
    for name, series in DATA['series'].items():
        ax_inset.plot(series['x'], series['y'], color=series.get('color', '#1F77B4'), linewidth=1.2, label=name)
    ax_inset.set_xlim(zx1, zx2)
    ax_inset.set_ylim(zy1, zy2)
    for spine in ax_inset.spines.values():
        spine.set_linewidth(1.2)
    connector = ConnectionPatch(xyA=(zx2, zy2), coordsA=ax.transData, xyB=(zx1, zy2), coordsB=ax_inset.transData,
                                 color='#333333', linewidth=0.8, linestyle='--')
    fig.add_artist(connector)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.grid(True, color='#E0E0E0', linewidth=0.6, linestyle=':', zorder=0)
ax.legend(loc='upper right', frameon=True, facecolor='white', edgecolor='#DDDDDD')
`

  if (styleName === 'line_loss_with_inset') return `
ax = fig.add_subplot(111)
all_x = np.concatenate([np.asarray(s['x'], dtype=float) for s in DATA['series'].values()])
all_y = np.concatenate([np.asarray(s['y'], dtype=float) for s in DATA['series'].values()])
for name, series in DATA['series'].items():
    ax.plot(series['x'], series['y'], color=series.get('color', '#2CA02C'), linewidth=1.5, label=name)
zoom = DATA.get('zoom', {})
if zoom and isinstance(zoom, dict):
    zx1 = float(zoom.get('x1', np.min(all_x) + np.ptp(all_x) * 0.55))
    zx2 = float(zoom.get('x2', np.max(all_x)))
    zy1 = float(zoom.get('y1', np.min(all_y)))
    zy2 = float(zoom.get('y2', np.min(all_y) + np.ptp(all_y) * 0.45))
    rect = mpatches.Rectangle((zx1, zy1), zx2 - zx1, zy2 - zy1, fill=False, linestyle='--',
                               edgecolor='#333333', linewidth=1.0, zorder=5)
    ax.add_patch(rect)
    ax_inset = fig.add_axes([0.63, 0.18, 0.27, 0.31])
    for name, series in DATA['series'].items():
        ax_inset.plot(series['x'], series['y'], color=series.get('color', '#1F77B4'), linewidth=1.2, label=name)
    ax_inset.set_xlim(zx1, zx2)
    ax_inset.set_ylim(zy1, zy2)
    for spine in ax_inset.spines.values():
        spine.set_linewidth(1.2)
    connector = ConnectionPatch(xyA=(zx2, zy2), coordsA=ax.transData, xyB=(zx1, zy2), coordsB=ax_inset.transData,
                                 color='#333333', linewidth=0.8, linestyle='--')
    fig.add_artist(connector)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.grid(True, color='#E0E0E0', linewidth=0.6, linestyle=':', zorder=0)
ax.legend(loc='upper right', frameon=True, facecolor='white', edgecolor='#DDDDDD')
`

  if (styleName === 'scatter_tsne_cluster') return `
ax = fig.add_subplot(111)
for name, cluster in DATA['clusters'].items():
    x = np.asarray(cluster['x'], dtype=float)
    y = np.asarray(cluster['y'], dtype=float)
    color = cluster.get('color', '#6A4C93')
    ax.scatter(x, y, c=color, s=14, alpha=0.55, linewidths=0, rasterized=True, label=name)
    rgba = list(mcolors.to_rgba(color))
    rgba[3] = 0.28
    ax.annotate(name, xy=(float(np.mean(x)), float(np.mean(y))), ha='center', va='center', fontsize=9,
                bbox=dict(boxstyle='round,pad=0.30', facecolor=tuple(rgba), edgecolor='#2C3E50', linewidth=0.9))
for spine in ax.spines.values():
    spine.set_visible(True)
    spine.set_linewidth(0.9)
    spine.set_color('#333333')
ax.tick_params(direction='in', length=4, width=0.8)
ax.grid(True, color='#E0E0E0', linewidth=0.6, linestyle=':', zorder=0)
ax.legend(frameon=True, facecolor='white', edgecolor='#CCCCCC', markerscale=1.0)
`

  if (styleName === 'scatter_broken_axis') return `
all_x = np.concatenate([np.asarray(s['x'], dtype=float) for s in DATA['series'].values()])
break_x = DATA.get('break_x', np.median(all_x))
ax1 = fig.add_axes([0.08, 0.16, 0.58, 0.74])
ax2 = fig.add_axes([0.71, 0.16, 0.21, 0.74])
for name, series in DATA['series'].items():
    x = np.asarray(series['x'], dtype=float)
    y = np.asarray(series['y'], dtype=float)
    color = series.get('color', '#E53935')
    marker = series.get('marker', 'o')
    size = series.get('size', 30)
    left = x <= break_x
    right = ~left
    ax1.scatter(x[left], y[left], c=color, marker=marker, s=size, alpha=0.85, label=name,
                edgecolors='black', linewidths=0.8)
    ax2.scatter(x[right], y[right], c=color, marker=marker, s=size, alpha=0.85,
                edgecolors='black', linewidths=0.8)
d = 0.015
ax1.plot((1 - d, 1 + d), (-d, d), transform=ax1.transAxes, color='k', clip_on=False, lw=1.2)
ax2.plot((-d, d), (-d, d), transform=ax2.transAxes, color='k', clip_on=False, lw=1.2)
ax1.spines['top'].set_visible(False)
ax1.spines['right'].set_visible(False)
for side in ('top', 'right', 'left'):
    ax2.spines[side].set_visible(False)
ax1.tick_params(labelbottom=True)
ax2.tick_params(labelleft=False)
ax1.legend(loc='lower right', frameon=True, facecolor='white', edgecolor='#CCCCCC')
ax = ax1
`

  if (styleName === 'radar_dual_series') return `
ax = fig.add_subplot(111, projection='polar')
ax.set_theta_zero_location('N')
ax.set_theta_direction(-1)
ax.set_yticks([])
categories = DATA['categories']
N = len(categories)
series = DATA['series']
angles = np.linspace(0, 2 * np.pi, N, endpoint=False)
def close(values):
    return np.concatenate([values, values[:1]])
for radius in (0.4, 0.55, 0.7, 0.85, 1.0):
    ax.plot(close(angles), close(np.full(N, radius)), color='#CCCCCC', lw=0.8, linestyle='--')
RMIN, RMAX = 0.35, 1.0
def normalize(value, vmin, vmax):
    return RMIN + (RMAX - RMIN) * (value - vmin) / (vmax - vmin)
for i, (name, item) in enumerate(series.items()):
    values = np.asarray(item['values'], dtype=float)
    vmin = float(DATA.get('vmin', np.min(values) * 0.9))
    vmax = float(DATA.get('vmax', np.max(values) * 1.1))
    if vmax <= vmin:
        vmax = vmin + 1.0
    radii = np.asarray([normalize(value, vmin, vmax) for value in values])
    color = item.get('color', STYLE_COLORS['primary'] if i == 0 else STYLE_COLORS['secondary'])
    linewidth = 2.8 if i == 0 else 1.3
    ax.fill(close(angles), close(radii), color=color, alpha=0.18)
    ax.plot(close(angles), close(radii), color=color, lw=linewidth, label=name)
    for j in range(N):
        ax.text(angles[j], radii[j] + 0.08, f'{values[j]:.2f}', ha='center', fontsize=7.8, color=color,
                bbox=dict(boxstyle='round,pad=0.12', facecolor='white', edgecolor='none', alpha=0.85))
ax.set_xticks(angles)
ax.set_xticklabels(categories, fontsize=9)
ax.legend(loc='upper right', bbox_to_anchor=(1.25, 1.05), frameon=False)
`

  if (styleName === 'forest_plot') return `
ax = fig.add_subplot(111)
studies = DATA['studies']
null_value = DATA.get('null_value', 0)
for i, s in enumerate(studies):
    y = len(studies) - i
    ax.plot([s['ci_lower'], s['ci_upper']], [y, y], color='black', linewidth=1.0)
    ax.plot(s['effect'], y, 's', color=STYLE_COLORS['effect'], markersize=6)
effect_sizes = [s['effect'] for s in studies]
ci_lowers = [s['ci_lower'] for s in studies]
ci_uppers = [s['ci_upper'] for s in studies]
pooled = float(np.mean(effect_sizes))
pooled_se = float(np.std(effect_sizes) / np.sqrt(len(effect_sizes)))
ax.plot([pooled - 1.96 * pooled_se, pooled + 1.96 * pooled_se], [0, 0], color='black', linewidth=1.5)
ax.plot(pooled, 0, 'D', color=STYLE_COLORS['diamond'], markersize=8)
ax.axvline(null_value, color=STYLE_COLORS['nullline'], linestyle='--', linewidth=0.8)
ax.set_yticks(range(len(studies) + 1))
ax.set_yticklabels([s['name'] for s in studies[::-1]] + ['Pooled'])
ax.set_ylim(-0.5, len(studies) + 0.5)
`

  if (styleName === 'funnel_plot') return `
ax = fig.add_subplot(111)
effects = [s['effect'] for s in DATA['studies']]
ses = [s['se'] for s in DATA['studies']]
ax.scatter(ses, effects, c=STYLE_COLORS['points'], s=30, alpha=0.7)
pooled = DATA.get('pooled_effect', float(np.mean(effects)))
max_se = max(ses) * 1.1
ax.plot([0, max_se], [pooled - 1.96 * max_se, pooled], color=STYLE_COLORS['funnel'], linestyle='--', lw=1.0)
ax.plot([0, max_se], [pooled + 1.96 * max_se, pooled], color=STYLE_COLORS['funnel'], linestyle='--', lw=1.0)
ax.axvline(pooled, color=STYLE_COLORS['center'], linestyle=':', lw=0.8)
ax.set_xlabel('Standard Error')
ax.set_ylabel('Effect Size')
ax.invert_xaxis()
`

  if (styleName === 'heatmap') return `
ax = fig.add_subplot(111)
matrix = np.asarray(DATA['matrix'], dtype=float)
im = ax.imshow(matrix, cmap=STYLE_COLORS.get('cmap', 'RdBu_r'), aspect='auto', vmin=-1, vmax=1)
ax.set_xticks(range(len(DATA['labels'])))
ax.set_yticks(range(len(DATA['labels'])))
ax.set_xticklabels(DATA['labels'], rotation=45, ha='right', fontsize=9)
ax.set_yticklabels(DATA['labels'], fontsize=9)
if STYLE_LAYOUT.get('annotate', True):
    for i in range(len(DATA['labels'])):
        for j in range(len(DATA['labels'])):
            val = matrix[i][j]
            ax.text(j, i, f'{val:.2f}', ha='center', va='center',
                    color='white' if abs(val) > 0.5 else 'black', fontsize=8)
plt.colorbar(im, ax=ax, shrink=0.8)
`

  // 未覆盖的风格应报错，而不是落到 radar 模板
  throw new Error(`不支持的风格 "${styleName}"。可用风格：${Object.keys(STYLES).join(', ')}`)
}

function buildScript(styleName, styleConfig, data, options) {
  const { title, xlabel, ylabel, figsize, dpi } = options
  const figW = Number.isFinite(Number(figsize?.[0])) ? Number(figsize[0]) : 8
  const figH = Number.isFinite(Number(figsize?.[1])) ? Number(figsize[1]) : 6
  const dpiValue = Number.isFinite(Number(dpi)) ? Number(dpi) : 300
  return `\"\"\"
Generated by dsh-research-kit MCP figure-generator
Style: ${styleName} - ${styleConfig.description}
\"\"\"
import matplotlib
matplotlib.use('Agg')
import matplotlib.colors as mcolors
import matplotlib.patches as mpatches
from matplotlib.patches import ConnectionPatch
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update(${pythonLiteral(styleConfig.rcParams)})
STYLE_COLORS = ${pythonLiteral(styleConfig.colors)}
STYLE_LAYOUT = ${pythonLiteral(styleConfig.layout)}
DATA = ${pythonLiteral(data)}

fig = plt.figure(figsize=(${figW}, ${figH}))
${plotCode(styleName)}
${title ? `ax.set_title(${pythonString(title)}, fontsize=12)` : '# no title'}
${xlabel ? `ax.set_xlabel(${pythonString(xlabel)}, fontsize=11)` : '# no xlabel'}
${ylabel ? `ax.set_ylabel(${pythonString(ylabel)}, fontsize=11)` : '# no ylabel'}
fig.savefig('output_${styleName}.png', dpi=${dpiValue}, facecolor='white', bbox_inches='tight')
plt.close(fig)
print('Saved output_${styleName}.png')
`
}

function generateFigure(styleName, data, options = {}) {
  if (options.panels && Array.isArray(options.panels) && options.panels.length > 1) {
    return generateMultiFigure(options, data)
  }
  if (!STYLE_NAMES.includes(styleName)) {
    return err(`未知风格 \"${styleName}\"。可用风格：${STYLE_NAMES.join(', ')}`)
  }
  const validationError = validateData(styleName, data)
  if (validationError) return err(validationError)
  // dpi/figsize 校验也放在这里，统一走 err() 路径
  const { dpi, figsize } = options
  if (dpi !== undefined) {
    if (typeof dpi !== 'number' || !Number.isFinite(dpi) || dpi <= 0) {
      return err('dpi 必须是正数')
    }
  }
  if (figsize?.[0] !== undefined && (typeof figsize[0] !== 'number' || !Number.isFinite(figsize[0]) || figsize[0] <= 0)) {
    return err('figsize[0] 必须是正数')
  }
  if (figsize?.[1] !== undefined && (typeof figsize[1] !== 'number' || !Number.isFinite(figsize[1]) || figsize[1] <= 0)) {
    return err('figsize[1] 必须是正数')
  }
  let styleConfig = STYLES[styleName]
  if (options.apa_style) {
    styleConfig = {
      ...styleConfig,
      rcParams: {
        ...styleConfig.rcParams,
        'font.family': 'sans-serif',
        'font.sans-serif': ['Arial', 'Helvetica', 'DejaVu Sans'],
        'text.usetex': false,
        'axes.labelsize': 10,
        'axes.titlesize': 11,
        'xtick.labelsize': 9,
        'ytick.labelsize': 9,
        'legend.fontsize': 9,
        'figure.dpi': 300,
      },
      colors: {
        ...styleConfig.colors,
        palette: ['#0077BB', '#33BBEE', '#009988', '#EE7733', '#CC3311', '#EE3377', '#BBBBBB', '#000000'],
      },
    }
  }
  return wrap({
    style: styleName,
    description: styleConfig.description,
    figure_type: styleConfig.figure_type,
    script: buildScript(styleName, styleConfig, data, options),
    filename: `output_${styleName}.png`,
    instructions: options.apa_style
      ? '已按 APA 7.0 格式生成：Okabe-Ito 色盲安全调色板、sans-serif 字体、APA 字号。保存为 .py 执行生成 PNG。图表标题格式：Figure N + 描述性标题（italic） + Note.'
      : '将 script 保存为 .py 文件并在安装 matplotlib 的环境中执行；LaTeX 风格还需安装 texlive。',
  }, { source: 'figure-generator', confidence: 'verified' })
}

function generateMultiFigure(options, sharedData) {
  const panels = options.panels
  for (const [i, panel] of panels.entries()) {
    if (!STYLE_NAMES.includes(panel.style)) {
      return err(`Panel ${i}: 未知风格 "${panel.style}"。可用：${STYLE_NAMES.join(', ')}`)
    }
    const validationError = validateData(panel.style, panel.data)
    if (validationError) return err(`Panel ${i}: ${validationError}`)
  }

  const cols = options.layout?.cols || Math.min(panels.length, 2)
  const rows = options.layout?.rows || Math.ceil(panels.length / cols)
  const figW = options.figsize?.[0] || cols * 5
  const figH = options.figsize?.[1] || rows * 4
  const dpiValue = Number.isFinite(Number(options.dpi)) ? Number(options.dpi) : 300

  const firstStyle = STYLES[panels[0].style]
  let rc = { ...firstStyle.rcParams }
  if (options.apa_style) {
    rc = {
      ...rc,
      'font.family': 'sans-serif',
      'font.sans-serif': ['Arial', 'Helvetica', 'DejaVu Sans'],
      'text.usetex': false,
      'axes.labelsize': 10,
      'axes.titlesize': 11,
      'xtick.labelsize': 9,
      'ytick.labelsize': 9,
      'legend.fontsize': 9,
    }
  }

  const panelBlocks = panels.map((panel, i) => {
    const styleConfig = STYLES[panel.style]
    const subplotType = styleConfig.figure_type === 'radar' ? `, projection='polar'` : ''
    const panelCode = plotCode(panel.style)
    const title = panel.title ? `\nax.set_title(${pythonString(panel.title)}, fontsize=11)\n` : ''
    return `
# ── Panel ${i + 1}: ${panel.style} ──
DATA = ${pythonLiteral(panel.data)}
STYLE_COLORS = ${pythonLiteral(styleConfig.colors)}
STYLE_LAYOUT = ${pythonLiteral(styleConfig.layout)}
ax = fig.add_subplot(${rows}, ${cols}, ${i + 1}${subplotType})
${panelCode}${title}`
  }).join('\n')

  const script = `\"\"\"
Generated by dsh-research-kit MCP figure-generator (multi-panel)
Panels: ${panels.map(p => p.style).join(' + ')}
\"\"\"
import matplotlib
matplotlib.use('Agg')
import matplotlib.colors as mcolors
import matplotlib.patches as mpatches
from matplotlib.patches import ConnectionPatch
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update(${pythonLiteral(rc)})

fig = plt.figure(figsize=(${figW}, ${figH}))

${panelBlocks}

fig.tight_layout()
fig.savefig('output_multi_panel.png', dpi=${dpiValue}, facecolor='white', bbox_inches='tight')
plt.close(fig)
print('Saved output_multi_panel.png')
`

  return wrap({
    style: panels.map(p => p.style).join(' + '),
    figure_type: 'multi-panel',
    panel_count: panels.length,
    layout: `${rows}x${cols}`,
    script,
    filename: 'output_multi_panel.png',
    instructions: '多面板图表。保存 script 为 .py 并在有 matplotlib 的环境中执行。每个面板可独立指定风格和数据。',
  }, { source: 'figure-generator', confidence: 'verified' })
}

function listFigureStyles() {
  return Object.entries(STYLES).map(([name, config]) => ({
    name,
    description: config.description,
    figure_type: config.figure_type,
    colors: config.colors,
  }))
}

export { generateFigure, listFigureStyles }
