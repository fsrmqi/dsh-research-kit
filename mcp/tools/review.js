import { z } from 'zod/v3'
import { detectTextAnomalies } from '../execution/anomaly-detector.js'
import { auditClaims } from '../execution/claim-auditor.js'
import { contract } from '../execution/contract.js'
import { generateDisclosureStatement, listDisclosurePolicies } from '../execution/disclosure-generator.js'
import { checkHedgingPhrases } from '../execution/hedging-phrases.js'
import { checkWritingQuality } from '../execution/writing-quality.js'
import { wrap } from '../execution/wrapper.js'

export const reviewCoreTools = [
  {
    name: 'research_review_output',
    description: 'Review a research draft in one pass: citation-claim alignment, textual anomalies, academic writing quality, and protected hedging. Use this as the default draft-review entry point; the individual research_review_* tools remain available for focused follow-up.',
    inputSchema: {
      text: z.string().min(100).describe('The draft, section, or review text to assess'),
      max_claims: z.number().int().min(1).max(50).optional().default(20).describe('Max cited claims to audit'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID for activity traceability.'),
    },
    async execute({ text, max_claims, run_id }) {
      const [claims, anomalies, writing, hedging] = await Promise.all([
        auditClaims(text, { max_claims }),
        detectTextAnomalies(text),
        checkWritingQuality(text),
        checkHedgingPhrases(text),
      ])
      return contract({
        claims: claims.data,
        anomalies: anomalies.data,
        writing: writing.data,
        hedging: hedging.data,
      }, {
        source: 'research-output-review',
        confidence: 'mixed',
        disclaimer: '汇总审阅包含 API 核验与规则检查；所有建议均需研究者人工确认。',
        run_id,
        summary: {
          claims_audited: claims.data?.claims?.length ?? claims.data?.total ?? 0,
          anomalies: anomalies.data?.summary?.contradictions ?? anomalies.data?.findings?.length ?? 0,
          quality_flags: writing.data?.summary?.total ?? writing.data?.issues?.length ?? 0,
          hedging_phrases: hedging.data?.total ?? hedging.data?.phrases?.length ?? 0,
        },
        next_actions: [
          '优先修复未找到或不支持的引用声明，再复核全文。',
          '逐条确认高风险矛盾与缺失要素，避免将模式信号直接当作结论。',
          '修改表述时保留保护性限制语；删除它们会改变声明强度。',
        ],
      })
    },
  },

  {
    name: 'research_review_claims',
    description: 'Audit all unique claim-citation pairs in a text. Verifies each cited reference exists and whether the abstract supports the specific claim. Same DOI with different claims is audited separately.',
    inputSchema: {
      text: z.string().min(20).describe('The text to audit (paper draft, review, etc.)'),
      max_claims: z.number().int().min(1).max(50).optional().default(20).describe('Max claims to audit'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID for activity traceability.'),
    },
    async execute({ text, max_claims }) {
      return auditClaims(text, { max_claims })
    },
  },
]

export const reviewFocusedTools = [
  {
    name: 'research_review_anomalies',
    description: 'Detect textual anomalies: redundant patterns, contradictions, silence zones (missing elements like limitations or sample size). Based on literature-review methodology.',
    inputSchema: {
      text: z.string().min(50).describe('The text to analyze (paper draft, review, abstract, etc.)'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID for activity traceability.'),
    },
    async execute({ text }) {
      return detectTextAnomalies(text)
    },
  },

  {
    name: 'research_review_writing',
    description: 'Check academic writing quality: flagged terms, throat-clearing openers, punctuation patterns, sentence length. Not a humanizer.',
    inputSchema: {
      text: z.string().min(100).describe('The text to check (paper draft, section, paragraph)'),
      run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/).optional().describe('Optional research run ID for activity traceability.'),
    },
    async execute({ text }) {
      return checkWritingQuality(text)
    },
  },

  {
    name: 'research_disclosure_generate',
    description: 'Generate a venue-specific AI use disclosure statement. Supports 15 journal/conference policies (Nature, ICLR, ACL, Science, NEJM, etc.).',
    inputSchema: {
      target_journal: z.string().describe('Target journal or conference name'),
      ai_use_description: z.string().describe('What AI was used for (e.g. "literature search and language editing")'),
      tool_name: z.string().optional().describe('Name of the AI tool used (e.g. "ChatGPT-4")'),
    },
    async execute({ target_journal, ai_use_description, tool_name }) {
      return generateDisclosureStatement({ target_journal, ai_use_description, tool_name })
    },
  },

  {
    name: 'research_disclosure_list_policies',
    description: 'List all supported journal/conference AI disclosure policies with their placement requirements.',
    inputSchema: {},
    async execute() {
      const policies = listDisclosurePolicies()
      return wrap({ policies }, { source: 'disclosure-generator', confidence: 'verified' })
    },
  },

  {
    name: 'research_review_hedging',
    description: 'Detect protected hedging phrases (may/might/suggests/初步/可能) that must not be silently removed during revision. Deleting them changes the paper\'s epistemic stance.',
    inputSchema: {
      text: z.string().min(20).describe('The text to check (abstract, section, revision)'),
    },
    async execute({ text }) {
      return checkHedgingPhrases(text)
    },
  },
]
