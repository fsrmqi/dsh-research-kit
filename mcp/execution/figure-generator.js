
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
  return Array.isArray(value) && value.length > 0 && value.every(item => Number.isFinite(Number(item)))
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
  if (styleName === 'line_training_curve' || styleName === 'line_loss_with_inset') {
    if (!data.series || typeof data.series !== 'object' || !Object.keys(data.series).length) return `${styleName} 需要 series 对象。`
    for (const [name, series] of Object.entries(data.series)) {
      if (!isNumberArray(series.x) || !isNumberArray(series.y)) return `series.${name} 需要 x/y 数组。`
      if (series.x.length !== series.y.length) return `series.${name} 的 x/y 必须等长。`
    }
  }
  if (styleName === 'scatter_tsne_cluster') {
    if (!data.clusters || typeof data.clusters !== 'object' || !Object.keys(data.clusters).length) return 'scatter_tsne_cluster 需要 clusters 对象。'
    for (const [name, cluster] of Object.entries(data.clusters)) {
      if (!isNumberArray(cluster.x) || !isNumberArray(cluster.y)) return `clusters.${name} 需要 x/y 数组。`
      if (cluster.x.length !== cluster.y.length) return `clusters.${name} 的 x/y 必须等长。`
    }
  }
  if (styleName === 'scatter_broken_axis') {
    if (!data.series || typeof data.series !== 'object' || !Object.keys(data.series).length) return 'scatter_broken_axis 需要 series 对象。'
    for (const [name, series] of Object.entries(data.series)) {
      if (!isNumberArray(series.x) || !isNumberArray(series.y)) return `series.${name} 需要 x/y 数组。`
      if (series.x.length !== series.y.length) return `series.${name} 的 x/y 必须等长。`
    }
  }
  if (styleName === 'radar_dual_series') {
    if (!Array.isArray(data.categories) || data.categories.length < 3) return 'radar_dual_series 至少需要 3 个 categories。'
    if (!data.series || typeof data.series !== 'object' || Object.keys(data.series).length < 1) return 'radar_dual_series 需要 series。'
    for (const [name, series] of Object.entries(data.series)) {
      if (!isNumberArray(series.values)) return `series.${name}.values 必须是非空数值数组。`
      if (series.values.length !== data.categories.length) return `series.${name}.values 必须与 categories 等长。`
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
    ax.annotate(f'+{ratio:.1f}%', xy=(x[i] + gap / 2 + bar_w / 2, method[i]), ha='center', va='bottom',
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

  if (styleName === 'line_loss_with_inset') return `
ax = fig.add_subplot(111)
all_x = np.concatenate([np.asarray(s['x'], dtype=float) for s in DATA['series'].values()])
all_y = np.concatenate([np.asarray(s['y'], dtype=float) for s in DATA['series'].values()])
for name, series in DATA['series'].items():
    ax.plot(series['x'], series['y'], color=series.get('color', '#1F77B4'), linewidth=1.5, label=name)
zoom = DATA.get('zoom', {})
x_span = float(np.max(all_x) - np.min(all_x)) or 1.0
y_span = float(np.max(all_y) - np.min(all_y)) or 1.0
zx1 = float(zoom.get('x1', np.min(all_x) + x_span * 0.55))
zx2 = float(zoom.get('x2', np.max(all_x)))
zy1 = float(zoom.get('y1', np.min(all_y)))
zy2 = float(zoom.get('y2', np.min(all_y) + y_span * 0.45))
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
break_x = float(DATA.get('break_x', np.median(all_x)))
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

  return `
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
  if (!STYLE_NAMES.includes(styleName)) {
    return err(`未知风格 \"${styleName}\"。可用风格：${STYLE_NAMES.join(', ')}`)
  }
  const validationError = validateData(styleName, data)
  if (validationError) return err(validationError)
  const styleConfig = STYLES[styleName]
  return wrap({
    style: styleName,
    description: styleConfig.description,
    figure_type: styleConfig.figure_type,
    script: buildScript(styleName, styleConfig, data, options),
    filename: `output_${styleName}.png`,
    instructions: '将 script 保存为 .py 文件并在安装 matplotlib 的环境中执行；LaTeX 风格还需安装 texlive。',
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
