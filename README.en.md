# DSH Research Kit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/fsrmqi/dsh-research-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/fsrmqi/dsh-research-kit/actions/workflows/ci.yml)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-blue.svg)](https://github.com/topics/dsh-plugin)
[![Node: >=22.6](https://img.shields.io/badge/node-%3E%3D22.6-green.svg)](https://nodejs.org)
[![Listed on DSH Hub](https://img.shields.io/badge/DSH%20plugin-listed-2ea44f.svg?labelColor=3d4451)](https://dshhub.org/plugins/fsrmqi/dsh-research-kit)

[English](README.en.md) · [简体中文](README.md)

> A catalog and launcher for research workflows in DeepSeek Harness: 317 human-reviewed workflows, 86 skill entries, 122 scientific data sources.

It turns recurring research tasks — peer review, writing an introduction, literature synthesis, planning a statistical analysis — into **parameterized, editable prompts that you review before sending**. The plugin only assembles the task and hands it back to your session; execution stays with your own DSH agent.

---

## Prerequisite: what is DSH?

This project is a plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (CLI name `dsh`), an open-source local agent harness by DeepSeek built around one idea: *Everything is a Plugin* — models, tools, UI and storage are all replaceable plugins.

**Without DSH, this plugin cannot run.** It ships no model and starts no service; it only adds research entry points to the DSH session UI.

| What you need | Where to get it |
| --- | --- |
| DSH itself | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) · [official site](https://deepseek.com/harness) |
| Plugin ecosystem | [GitHub topic: dsh-plugin](https://github.com/topics/dsh-plugin) |
| Node.js | `>= 22.6` |

> DSH is currently a **Developer Preview** and will iterate quickly, possibly with breaking changes. The `conversation.view` slot and the `inputActions` contract evolve with DSH versions — after upgrading DSH, re-run the [manual QA checklist](docs/MANUAL-QA.md).

## The problem it solves

Generic chat input suits ad-hoc questions, not recurring research tasks with defined steps, material requirements and quality boundaries. Reviewing a paper, writing an introduction, running a literature synthesis or planning an analysis all need four things:

1. **Explicit** input materials and output scope;
2. **Auditable** steps instead of one vague instruction;
3. **Human review before send** — you see, edit and confirm the task description;
4. **Hard rules** against fabricated citations, data and conclusions.

Research Kit turns those four into reusable assets.

## How it works

```text
Research capability catalog (525 entries)
  → pick a workflow
  → fill parameters, reference materials via @file
  → review and edit the final prompt
  → write to composer, or send to the current session
  → executed by the current DSH session's agent and its configured tools
```

![Architecture: the plugin only assembles prompts; execution stays with the DSH host](docs/assets/architecture.svg)

Deliberate trade-offs:

- **No model calls, no stored keys.** Execution belongs entirely to the current session;
- **No file-upload reimplementation.** Materials use DSH's native `@file` mentions;
- **No pretending to have retrieved anything.** Database entries state their access prerequisites honestly and fall back to Agent/MCP explicitly.

## Capabilities

**🧪 317 human-reviewed research workflows**
Across twenty-four workflow families — paper & manuscript, literature research, data analysis, genomics, clinical research, neuroscience, ecology, astronomy & space and more — maintained as per-family shards under `catalog/workflows/`. Each is a parameterized, editable prompt template with built-in anti-fabrication boundaries (never invent citations, data, page numbers or authorial intent) and explicit "draft pending human verification" framing.

**🧩 86 skill entries: 23 guidance modules + 63 capability entries**
Guidance modules work as prompt guidance — scientific writing, statistics review, citation hygiene, evidence synthesis, reproducibility, review ethics & confidentiality, data integrity, uncertainty communication, plus method modules for experimental design, hypothesis generation, scientific brainstorming, critical thinking, statistical power, systematic literature review, scientific visualization, uncertainty & units, clinical report drafts, venue compliance, peer-review comments, and grant writing, and three domain modules: agricultural experiment design, crop genomics & breeding evidence, and bioinformatics workflow governance — toggled at launch to fold into the workflow prompt. Capability entries are catalogued under an honest "requires host capability" status — bulk RNA-seq, Nextflow, Benchling/DNAnexus integrations, literature API search, docx/pdf production and other execution-side skills — stating the required toolchain, credentials and data-egress boundaries with a pre-use checklist; they inject no prompt fragment and execute nothing themselves.

**🔬 122 scientific data sources, 11 of them queryable in-plugin**
Literature, clinical, genetics, omics, protein/chemistry — plus astronomy & space, biodiversity, climate & environment, geospatial. Public APIs return candidate records with links and stable identifiers; rate-limited, licensed or parameter-heavy sources fall back explicitly to the DSH agent / MCP.

**✍️ Fully visible and editable before send**
Parameter substitution updates the preview live. After manual edits, later parameter changes never silently rewrite the body, and a "restore generated prompt" action is one click away. Missing required parameters block sending.

**🧭 One view, four sections**
A single `conversation.view` tab, sectioned along the research loop. The section bar stays pinned and shows each section's purpose and responsibility boundary:

| Section | Layer | Purpose |
| --- | --- | --- |
| Resources & Workflows | Discover | Catalog search, parameterized assembly, direct database lookup |
| Method Workshop | Construct | Method cards + variable fill-in → editable prompt; extract a draft from the current conversation |
| Research Vault | Deposit | Asset CRUD, version diff, verification tracking; an **Evidence Vault** sub-module saves source metadata and notes per item, project-isolated and de-duplicated |
| Evidence Graph | Evidence | Traceable relations among this session's resources, workflows, query sources, assets, saved evidence and auto-deposited research knowledge; optional "auto deposition" accumulates knowledge as the research conversation grows |

![The research loop across four sections: discover, construct, deposit, evidence](docs/assets/research-loop.svg)

**⏱ Assembly replay: see how the prompt was put together**
After you launch a workflow, the workbench replays the **actual assembly facts** from `composeWorkflow` segment by segment — workflow → parameters → attached skills → database boundaries → human verification — and every segment can be located as an anchor in the generated prompt text, so the replay and the prose corroborate each other. A compact replay is embedded in the detail pane; "Open replay window" launches the standalone archify interactive viewer (four visual presets, chapter narrative, semantic lens, radar overview). The replay shows **assembly actions that already happened** — it predicts no execution result and means no tool was run. Under `prefers-reduced-motion` it degrades to a static view.

<details>
<summary><strong>More capabilities</strong> (click to expand)</summary>

- **Science mode presets** — one-click bundles: **General research, Literature & papers, Bioinformatics, Crop breeding, Clinical & population research, Data analysis & visualization**. Each attaches a matching skill set and research discipline (pipeline versioning and QC traceability, agricultural trials and G×E boundaries, privacy and bias, statistical prerequisites and chart interpretability, and so on). Presets are guidance bundles, not capability switches — nothing auto-executes.
- **Composer quick entry** — "Resources / Workflows" buttons on the composer toolbar open an overlay picker without leaving the chat; a selected workflow goes through a preview dialog and writes the draft. **It never auto-sends.**
- **Draft enhancer** — one click beside the composer: a lightweight tier (zero-token structuring) and a semantic tier (reuses the current session model, streams, five-dimension diagnosis, cancellable), with three strength levels; enhanced drafts can be undone and compared against the original.
- **Favorites & history** — one-click star on any entry; successful write/send/copy is recorded locally (ID, name, first-line summary, timestamp; 20 entries max).
- **Evidence vault** — save individual results from public database lookups, each carrying a stable identifier (DOI / PMID / NCT / arXiv) and source link, defaulting to "unverified"; project-isolated de-duplication, JSON export/import and hard delete. **Only source metadata and notes you write are stored — no full text, no query terms. Nothing is saved automatically except by the explicitly enabled auto deposition below, which tags every entry and keeps it "unverified".**
- **Evidence graph** — traces relations among this session's resources, workflows, query sources, assets and **saved evidence**; evidence nodes carry only source database / stable identifier / verification status, **never notes or query terms**; arrows show relation direction, with anchors chosen from the two endpoints' actual positions rather than a fixed "always left-to-right". Deterministic layered layout with Ctrl / ⌘ wheel zoom, drag panning and reset, a minimap for quick navigation, and four range modes (focus / upstream / downstream / two-point path); you can copy a link that carries view state only, and export desensitized SVG / HTML snapshots (the metadata scope is stated before each export).
- **Auto deposition (off by default)** — once enabled on the graph page, every completed assistant reply is parsed locally into research questions, entities (gene / protein / trait / organism…), findings, hypotheses, methods and cited sources (both Chinese and English phrasing), plus their relations (e.g. "gene —may affect→ trait ←research subject— organism"). Findings/hypotheses/questions/methods land in the asset vault ("to verify"), cited sources land in the evidence vault ("unverified", tagged), and knowledge nodes/relations appear in the graph with traceable source-message excerpts; identical content merges, conflicting conclusions are kept side by side, everything starts as "to verify", and turning it off keeps everything already saved. With the switch off, "Deposit latest reply" on the graph page still lets you explicitly deposit the most recent assistant reply of the current session. Knowledge carries a `project` field; the graph can filter nodes by project and by "this session / persisted", and knowledge can be exported / restored as JSON backups.
- **Research-result explainer diagrams** — a built-in "research result explainer diagram" workflow turns findings into diagram IR, which `scripts/render-diagrams.mjs --html` renders **deterministically** into single-file interactive HTML (shareable and opens offline); `--from-files` scaffolds IR from files produced in a session. `scripts/validate-diagrams.mjs` gives machine-readable rule diagnostics and is part of `npm run check` (no IR files ship in the repo, so it takes effect when an IR is produced or reviewed).
- **Multiple prompt exits** — beyond write-to-composer and send, "Copy prompt" works even when host actions are missing.
- **Launch-time validation** — field-level errors (red border + message) inside the preview dialog; missing required parameters never write the draft.
- **Manageable resource picks** — the overlay footer lists selected resources as removable chips.
- **Manual-edit protection** — editing the prompt by hand switches to an explicit manual state with a one-click restore; the detail pane always belongs to the current filter result.
- **Host-action degradation** — when `setDraft`/`submit` are absent, buttons disable with an explanation and the view does not crash.
- **Dark theme & narrow screens** — follows the system and DSH theme; single column below 880px; native `aria-*` attributes and focus rings.

</details>

## Installation

Requires Node `>= 22.6` and a DSH web profile providing four slots: `conversation.view`, `conversation.input.left`, `conversation.input.overlay` and `conversation.input.right` (the unified view, the composer's left entry, the overlay picker, and the draft enhancer on the composer's right).

**Local directory (currently recommended; not published to npm)**

```bash
git clone https://github.com/fsrmqi/dsh-research-kit.git
dsh plugin --profile web add ./dsh-research-kit
```

**GitHub (pin a commit for reproducible installs)**

```bash
dsh plugin --profile web add github:fsrmqi/dsh-research-kit#<commit-sha>
```

**tarball (offline / audit)**

```bash
npm pack && dsh plugin --profile web add ./dsh-research-kit-0.1.0.tgz
```

> The build artifact `ui/client.js` is committed, so a clone installs without building.

After installing, refresh the browser and open the "Research Workbench" view, or use the "Resources / Workflows" entry beside the composer. Uninstalling or closing the view leaves no duplicate registrations behind.

**Common pitfall**: `dsh plugin` calls the `pnpm` on your PATH, and its store-layout major version must match the target profile's record — otherwise the command fails with `ERR_PNPM_UNEXPECTED_STORE`. See [manual QA §1](docs/MANUAL-QA.md) for how to compare.

## Usage

Two entrances, one set of catalog assets.

**Option A: the unified Research Workbench view**

1. Open the Research Workbench in a session — it lands on "Resources & Workflows"; search or filter the 525 catalog entries;
2. Select a workflow and review its purpose, required materials and limitations;
3. Fill in parameters; for file-dependent workflows, reference files via `@文件` in the DSH composer first;
4. Toggle skill guidance as needed — the preview updates live; expand the **assembly replay** in the detail pane to verify segment by segment how the prompt was assembled;
5. "Write to composer" keeps the draft editable, or "Send to session" submits it.

**Option B: composer quick entry**

1. Click "Workflows" or "Resources" on the composer toolbar to open an overlay above the input card;
2. The Workflows panel filters by discipline and opens a preview dialog where you fill parameters and inspect the prompt, then "Use workflow" writes it to the draft;
3. The Resources panel toggles databases and skills; checked skills fold in as guidance fragments and databases as research notes for the next workflow you launch;
4. After writing, attach materials with DSH's native paperclip or `@文件`, then send yourself — the quick entry **only writes the draft, never auto-sends**.

DSH performs the actual send; this plugin creates no model routes, stores no keys, and never reads file contents.

## Catalog contents

Workflows are maintained as per-family shards under `catalog/workflows/` (one JSON shard per category, aggregated in fixed order by `index.js`):

| Category (shard) | Count |
| --- | --- |
| Paper & manuscript (paper-manuscript) | 17 |
| Literature research (literature) | 16 |
| Data analysis (data-analysis) | 18 |
| Study design (research-design) | 5 |
| Bioinformatics (bioinformatics) | 18 |
| Genomics (genomics) | 14 |
| Clinical research (clinical) | 19 |
| Crop breeding (crop-breeding) | 8 |
| Visualization (visual) | 13 |
| Science communication (science-communication) | 10 |
| Grant proposals (grants) | 10 |
| Proteomics & structural biology (proteomics) | 13 |
| Cell biology (cell-biology) | 9 |
| Chemistry (chemistry) | 18 |
| Drug discovery (drug-discovery) | 15 |
| Materials science (materials) | 12 |
| Neuroscience (neuroscience) | 12 |
| Ecology (ecology) | 14 |
| Physics (physics) | 14 |
| Astronomy & space science (astronomy) | 11 |
| Social science (social-science) | 12 |
| Mathematics (mathematics) | 12 |
| Machine learning (machine-learning) | 15 |
| Engineering (engineering) | 12 |

Plus 86 skills (`catalog/skills/`: core 20 / crop-breeding 2 / bioinformatics 1 / host-capabilities 63) and 122 database entries (`catalog/resources/`: crop-breeding 7 / literature 19 / genomics 8 / omics 7 / general-science 81). Full definitions live in [`catalog/`](catalog/); the data contract is in [architecture §4](docs/ARCHITECTURE.md).

## Privacy & security

| Access | Purpose | Notes |
| --- | --- | --- |
| Current session composer | Writes or submits the final prompt only when you click "Write/Send" | No Enter interception, no auto-send, never touches other sessions' history |
| `@file` mentions | Only nudges you toward DSH's native mention menu | Never reads, uploads or parses file contents |
| Browser storage | Favorites, history, method cards and research-vault assets (`localStorage`) | No parameter values, full prompts or file contents; clearing browser data clears them |
| Browser IndexedDB | Evidence entries: source metadata and notes you wrote yourself | Written **only after you confirm each save**; no full text, query terms or raw responses; per-project isolation, export / import / permanent delete. The evidence graph shows only their source / identifier / verification status, never the notes |
| Current-page memory | Per-session evidence index (started workflows and direct-query source summaries) | Used only to update the evidence graph across views; cleared on refresh or page close, and never stores query terms, raw files or full results |
| Network | Direct public-database lookup (only when you trigger it) | Requests go through DSH's controlled web service; the plugin holds no API keys |

**Zero telemetry.** Nothing is collected or uploaded. Every workflow output is framed as a **draft pending human verification** and does not replace the researcher, reviewer or ethics approval.

Security boundaries and vulnerability reporting: see [SECURITY.md](SECURITY.md).

### Database queries

Database detail pages can query a first batch of public sources directly: PubMed, Crossref, OpenAlex, Semantic Scholar, Europe PMC, ClinicalTrials.gov, openFDA, UniProt, PubChem, GBIF and iNaturalist. These 11 entries are marked `available-in-plugin` in the catalog, and their detail page reads "queryable directly by the plugin". Candidate results show source links and stable identifiers and can be written into the composer, or you can explicitly click "Let the agent verify and continue" — that button invokes the current DSH session's agent, which then uses the web/MCP/file tools it already has to complete a multi-step search.

The remaining 111 sources are marked `requires-mcp` or `reference-only`, state the MCP, subscription, API key or data-use agreement they require, and offer the same controlled agent fallback. Catalog labels and the query implementation are cross-checked by `npm run check` in both directions (an adapter must be labelled, and a label must have an adapter), so the capability shown in the UI cannot drift from what is actually implemented. **The plugin never fabricates a search result.**

## Compatibility & status

Current version `0.1.0` (not yet published to npm). Development status and next steps: [ROADMAP.md](ROADMAP.md).

Verified so far: catalog contract validation (525 entries, 525 unique IDs, shards identical to the aggregated entries), 219 regression tests in 24 files (including 6 render-level degradation assertions for missing host actions), two rounds of real DSH web-profile smoke testing (fast lane F1–F4, release gate R1 and observation items O1–O3 all passed), and on-site acceptance of evidence-vault-to-prompt writing (W1–W3: the button is enabled once entries are selected, nothing is injected when nothing is selected, and the write lands in the composer without auto-sending, with the announced count matching) and of saved evidence in the graph (G1–G4: evidence nodes carry only source / identifier / verification status, link to their source database, and edges anchor by actual direction).

> Real-profile acceptance cannot be replaced by unit tests — `test/dsh-slots.test.js` does execute the real build artifact, but the slots service is simulated. Re-run the [manual QA checklist](docs/MANUAL-QA.md) after upgrading DSH.

## Development

```bash
npm run build   # generate ui/client.js (committed; do not hand-edit)
npm run check   # catalog contract validation + syntax checks
npm test        # pure-logic, contract and render-level regression tests (219 / 24 files)
npm run test:browser  # real-Chromium interaction regression (run `npx playwright install chromium` first)
```

After touching `catalog/`, `src/` or `dsh/`, run `npm run build && npm run check && npm test`; CI verifies the committed bundle matches the sources (any diff fails the build).

## Documentation

| Document | Contents |
| --- | --- |
| [docs/README.md](docs/README.md) | **Documentation index and recommended reading order** |
| [Architecture & data contracts](docs/ARCHITECTURE.md) | Module responsibilities, data flow, DSH host boundaries, catalog schema |
| [Development guide](docs/DEVELOPMENT.md) | Local setup, implementation order, test strategy, delivery checklist |
| [Manual QA checklist](docs/MANUAL-QA.md) | Why unit tests are not enough, step-by-step acceptance, failure triage tree |
| [Method Workshop embedding](docs/METHOD-WORKSHOP.md) | Vendored artifact governance, namespace discipline, builder integration |
| [Scope & boundaries](docs/PRODUCT.md) | Problem statement, product boundaries, quality and safety principles |

> The in-depth documents are currently **Chinese-only**. English readers can follow the architecture and QA checklists structurally; the code and catalog are the authoritative reference.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). To add a workflow, append a JSON object to the matching `catalog/workflows/<category>.json` shard following the existing entries and run `npm run check && npm test`; the contract validator enforces placeholder consistency, anti-fabrication boundaries and shard/entry agreement.

## License

[MIT](LICENSE).

Third-party attribution and licensing for bundled vendored artifacts: see [NOTICE](NOTICE).
