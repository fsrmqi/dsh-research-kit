import { z } from 'zod/v3'
import { generateFigure, listFigureStyles } from '../execution/figure-generator.js'
import { wrap } from '../execution/wrapper.js'

export const figureTools = [
  {
    name: 'research_figure_generate',
    description: 'Generate a publication-quality matplotlib script using a pre-built paper style. Returns the Python script to execute.',
    inputSchema: {
      style: z.string().optional().describe('Style name (required for single figure; optional when panels is provided)'), data: z.record(z.any()).optional().describe('Data object (required for single figure; optional when panels is provided)'), title: z.string().optional().describe('Figure title'), xlabel: z.string().optional().describe('X-axis label'), ylabel: z.string().optional().describe('Y-axis label'), figsize: z.array(z.number()).length(2).optional().describe('Figure size [width, height] in inches'), dpi: z.number().int().optional().default(300).describe('Output DPI'), apa_style: z.boolean().optional().describe('Apply APA 7.0 formatting: colorblind-safe Okabe-Ito palette, sans-serif fonts, APA font sizes'),
      panels: z.array(z.object({ style: z.string(), data: z.record(z.any()), title: z.string().optional() })).optional().describe('Multi-panel mode: array of {style, data, title?} objects. When provided, ignores single style/data.'), layout: z.object({ rows: z.number().int().optional(), cols: z.number().int().optional() }).optional().describe('Subplot grid layout (default: auto)'), run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID for activity traceability.'),
    },
    async execute({ style, data, title, xlabel, ylabel, figsize, dpi, apa_style, panels, layout }) { return generateFigure(style, data, { title, xlabel, ylabel, figsize, dpi, apa_style, panels, layout }) },
  },
  { name: 'research_figure_list_styles', description: 'List all available paper figure styles with their type and color palettes.', inputSchema: {}, async execute() { return wrap({ styles: listFigureStyles() }, { source: 'figure-styles', confidence: 'verified' }) } },
]
