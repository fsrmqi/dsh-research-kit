
import { wrap, err } from './wrapper.js'

const VENUE_POLICIES = {
  nature: {
    aliases: ['nature', 'nature portfolio', 'nature publishing group', 'nature communications', 'nature medicine'],
    required: true,
    placement: 'Methods section (or suitable alternative if no Methods)',
    policy_summary: 'LLMs do not satisfy authorship criteria. LLM use must be documented in the Methods section. AI-assisted copy editing of human-generated text does not need to be declared.',
    prohibited: 'AI as author; AI-generated images for publication (with limited exceptions); AI-generated content without human accountability.',
    template: 'During the preparation of this work the author(s) used [TOOL NAME] in order to [PURPOSE]. After using this tool/service, the author(s) reviewed and edited the content as needed and take(s) full responsibility for the content of the published article.',
    source: 'https://www.nature.com/nature-portfolio/editorial-policies/ai',
  },
  iclr: {
    aliases: ['iclr', 'international conference on learning representations'],
    required: true,
    placement: 'Paper body (acknowledgements or methods section)',
    policy_summary: 'Authors must disclose the use of LLMs/AI tools. LLMs do not count as authorship.',
    prohibited: 'AI as author; LLM-generated text without disclosure.',
    template: 'We acknowledge the use of [TOOL NAME] for [PURPOSE] in the preparation of this manuscript. All content was reviewed and verified by the authors, who take full responsibility for the work.',
    source: 'https://iclr.cc/Conferences/2025/CallForPapers',
  },
  neurips: {
    aliases: ['neurips', 'nips', 'neural information processing systems'],
    required: true,
    placement: 'Paper body or acknowledgements',
    policy_summary: 'Authors must document the use of LLMs. LLMs do not satisfy authorship criteria. NeurIPS requires a checklist item on LLM usage.',
    prohibited: 'AI as author; LLM-generated content presented as original human work without disclosure.',
    template: 'We used [TOOL NAME] to [PURPOSE] while preparing this manuscript. The authors reviewed and edited all output and take full responsibility for the content.',
    source: 'https://neurips.cc/publicethics/llm-usage-guidelines',
  },
  acl: {
    aliases: ['acl', 'association for computational linguistics', 'emnlp', 'arr'],
    required: true,
    placement: 'Acknowledgements section',
    policy_summary: 'Use of generative AI to create content must be disclosed in the Acknowledgements. Language-only assistance (paraphrasing/polishing) does NOT require disclosure. AI-suggested new ideas DO require disclosure.',
    prohibited: 'AI as author; using AI to rephrase existing work as one\'s own without attribution (plagiarism).',
    template: 'Section [N] was written with inputs from [TOOL NAME]. All output was checked for accuracy and carries appropriate citations.',
    source: 'https://www.aclweb.org/adminwiki/index.php/ACL_Policy_on_Publication_Ethics',
  },
  science: {
    aliases: ['science', 'science magazine', 'aaas'],
    required: true,
    placement: 'Acknowledgements, Methods, or Supplementary Materials',
    policy_summary: 'AI-assisted writing tools may only be used to improve readability and style. AI cannot be an author. Use must be disclosed in the manuscript or acknowledgements.',
    prohibited: 'AI-generated images/figures without disclosure; AI as author; AI-generated text without human review.',
    template: 'The authors used [TOOL NAME] to improve the readability and language of the manuscript. All scientific content, data interpretation, and conclusions are the work of the authors.',
    source: 'https://www.science.org/content/page/science-journals-editorial-policies',
  },
  icmje: {
    aliases: ['icmje', 'international committee of medical journal editors'],
    required: true,
    placement: 'Cover letter AND Methods/Contributors section',
    policy_summary: 'AI use must be disclosed in the cover letter and in the manuscript. AI cannot be an author. Authors are responsible for all content.',
    prohibited: 'AI as author; AI-generated content without human review and accountability.',
    template: 'Artificial intelligence technology (specifically [TOOL NAME]) was used to assist with [PURPOSE]. The authors reviewed and edited all AI-assisted content and take full responsibility for the integrity and accuracy of the work.',
    source: 'https://www.icmje.org/recommendations/browse/roles-and-responsibilities/authorships-and-contributorship.html',
  },
  plos: {
    aliases: ['plos', 'plos one', 'plos journals'],
    required: true,
    placement: 'Methods section AND Funding Statement / Financial Disclosure',
    policy_summary: 'PLOS requires disclosure of AI use in the Methods section. AI-generated content must be fact-checked. AI cannot be an author.',
    prohibited: 'AI as author; AI-generated data or figures presented as original research data.',
    template: '[TOOL NAME] was used to [PURPOSE]. The authors confirmed the accuracy of all AI-assisted content and take full responsibility for the work.',
    source: 'https://plos.org/policies/#editorial-policy',
  },
  lancet: {
    aliases: ['lancet', 'the lancet'],
    required: true,
    placement: 'Methods section AND Contributors statement',
    policy_summary: 'The Lancet requires disclosure of AI use. AI cannot be listed as a contributor. Authors must verify all AI-generated content.',
    prohibited: 'AI as contributor; AI-generated text without verification.',
    template: 'AI technology ([TOOL NAME]) was used to assist with [PURPOSE]. All content was reviewed and verified by the authors, who take full responsibility.',
    source: 'https://www.thelancet.com/lancet/information-for-authors',
  },
  ieee: {
    aliases: ['ieee', 'ieee transactions', 'ieee journals'],
    required: true,
    placement: 'Acknowledgements section or Methods',
    policy_summary: 'IEEE requires disclosure of AI-generated text. AI cannot be an author. AI-generated text must be clearly documented.',
    prohibited: 'AI as author; AI-generated text without disclosure.',
    template: 'The authors used [TOOL NAME] to assist with [PURPOSE]. All AI-generated content was reviewed, edited, and verified by the authors.',
    source: 'https://journals.ieeeauthorcenter.ieee.org/become-an-ieee-journal-author/publishing-ethics/guidelines-and-policies/submission-and-peer-review-policies/',
  },
  elsevier: {
    aliases: ['elsevier', 'cell', 'els'],
    required: true,
    placement: 'Methods section or Acknowledgements',
    policy_summary: 'Elsevier requires disclosure of AI use in the writing process. Authors must use AI responsibly and verify all output.',
    prohibited: 'AI as author; AI-generated figures; AI-generated references without verification.',
    template: 'During the preparation of this work the author(s) used [TOOL NAME] in order to [PURPOSE]. After using this tool/service, the author(s) reviewed and edited the content as needed and take(s) full responsibility for the content of the published article.',
    source: 'https://www.elsevier.com/about/policies-and-standards/publishing-ethics',
  },
  springer: {
    aliases: ['springer', 'springer nature', 'springerlink'],
    required: true,
    placement: 'Methods section',
    policy_summary: 'Same as Nature Portfolio. LLMs do not satisfy authorship criteria. LLM use must be documented in the Methods section.',
    prohibited: 'AI as author; AI-generated images.',
    template: 'During the preparation of this work the author(s) used [TOOL NAME] in order to [PURPOSE]. After using this tool/service, the author(s) reviewed and edited the content as needed and take(s) full responsibility for the content of the published article.',
    source: 'https://www.springernature.com/gp/policies/book-publishing-policies/ai',
  },
  frontiers: {
    aliases: ['frontiers', 'frontiers journals'],
    required: true,
    placement: 'Methods section AND Acknowledgements',
    policy_summary: 'Frontiers requires disclosure of AI tools in the manuscript. AI cannot be listed as author or reviewer.',
    prohibited: 'AI as author or reviewer; AI-generated data.',
    template: 'The authors declare the use of [TOOL NAME] for [PURPOSE] during the preparation of this manuscript. All content was verified by the authors.',
    source: 'https://www.frontiersin.org/guidelines/author-guidelines',
  },
  bmj: {
    aliases: ['bmj', 'the bmj', 'british medical journal'],
    required: true,
    placement: 'Contributor section AND Methods (for research AI use)',
    policy_summary: 'BMJ requires declaration of AI use: what technology, why it was used, and how. Authors should provide input/output/review summary for editorial review.',
    prohibited: 'AI as author; inadequate declaration (grounds for rejection).',
    template: '[TOOL NAME] was used for [PURPOSE]. The authors reviewed the AI output, made necessary corrections, and take full responsibility for the final content.',
    source: 'https://authors.bmj.com/policies/ai-use/',
  },
  jama: {
    aliases: ['jama', 'journal of the american medical association', 'jama network'],
    required: true,
    placement: 'Methods section AND Acknowledgements',
    policy_summary: 'JAMA requires disclosure of AI use. AI cannot be an author. Authors must report AI use in the acknowledgment and methods.',
    prohibited: 'AI as author; AI-generated content without human review.',
    template: 'The authors used [TOOL NAME] for [PURPOSE]. All content generated with AI assistance was reviewed and edited by the authors, who take full responsibility for the accuracy and integrity of the work.',
    source: 'https://jamanetwork.com/journals/jama/pages/instructions-for-authors',
  },
  nejm: {
    aliases: ['nejm', 'new england journal of medicine', 'the new england journal of medicine'],
    required: true,
    placement: 'Methods section AND Acknowledgements or Contributorship form',
    policy_summary: 'NEJM requires disclosure of AI use. AI cannot be an author. AI-generated text must be disclosed in the methods and contributorship form.',
    prohibited: 'AI as author; AI-generated content without disclosure and review.',
    template: 'Artificial intelligence ([TOOL NAME]) was used to assist with [PURPOSE]. The authors take full responsibility for the content of this manuscript.',
    source: 'https://www.nejm.org/author-center',
  },
}

function findVenue(target) {
  const normalized = String(target || '').trim().toLowerCase()
  for (const [key, policy] of Object.entries(VENUE_POLICIES)) {
    if (key === normalized || policy.aliases.includes(normalized)) return { key, ...policy }
    for (const alias of policy.aliases) {
      if (normalized.includes(alias) || alias.includes(normalized)) return { key, ...policy }
    }
  }
  return null
}

function generateDisclosure({ target_journal, ai_use_description, tool_name, paper_structure }) {
  const venue = findVenue(target_journal)
  if (!venue) {
    return {
      status: 'UNKNOWN_VENUE',
      message: `期刊/会议 "${target_journal}" 不在政策数据库中。请查阅该期刊的官网 AI 政策并提供政策文本，以便生成合规的披露声明。`,
      database_venues: Object.keys(VENUE_POLICIES),
    }
  }

  const tool = String(tool_name || '[TOOL NAME]')
  const purpose = String(ai_use_description || '[PURPOSE]')
  const statement = venue.template
    .replace('[TOOL NAME]', tool)
    .replace(/\[PURPOSE\]/g, purpose)

  return {
    venue: venue.key,
    status: 'REQUIRED',
    placement: venue.placement,
    disclosure_statement: statement,
    policy_summary: venue.policy_summary,
    prohibited_uses: venue.prohibited,
    source_url: venue.source,
    reminder: '投稿前请访问期刊官网确认 AI 政策是否有更新。政策可能会变化。',
  }
}

function generateDisclosureStatement(input) {
  try {
    const result = generateDisclosure(input)
    return wrap(result, {
      source: 'disclosure-generator',
      confidence: 'cached',
      disclaimer: 'AI 政策可能更新，投稿前请核实期刊最新政策。生成的声明为草稿，需作者确认。',
    })
  } catch (e) {
    return err(`生成披露声明失败：${e.message}`)
  }
}

function listDisclosurePolicies() {
  return Object.entries(VENUE_POLICIES).map(([key, policy]) => ({
    venue: key,
    required: policy.required,
    placement: policy.placement,
    aliases: policy.aliases,
  }))
}

export { generateDisclosureStatement, listDisclosurePolicies }
