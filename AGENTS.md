# AGENTS.md, Buena Context Engine

A briefing for any coding agent working in this repo. We're competing in the **Buena track** at Big Berlin Hack 2026, building "CLAUDE.md for buildings", a self-updating context engine for property management.

Read this file first, every session.

---

## Model lock (do not deviate)

**All extraction, routing, classification, and reasoning uses Gemini 3.1 Pro with high thinking.** Model id: `gemini-3-pro-preview` (or whatever the current 3.1 Pro alias is in `google-genai`), with `thinking_config={"thinking_level": "high"}` (or equivalent SDK flag for high reasoning).

Do not propose, suggest, or fall back to Flash, 2.5 Pro, 2.0, or any other model unless the user explicitly asks. One model, end to end. If a call fails, retry on the same model — do not silently downgrade.

## TL;DR

| | |
|---|---|
| **Track** | Buena, the Context Engine |
| **Track prize** | €2,500 cash, plus path to €10K finalist prize |
| **Submission deadline** | Sunday 14:00 |
| **Required submission** | 2 min Loom, public GitHub repo with README |
| **Partner techs (3 required)** | Gemini (core), Tavily (enrichment), Pioneer/GLiNER2 (router, optional/stretch). Plus Entire and Aikido as side challenges. |
| **Team** | Mahir (AI/product), Anwar (automation), Yasin (design) |
| **Surface** | Obsidian plugin (primary), tiny web page for bulk import only. No iOS, no live web app, no Durable Objects, no Yjs. |
| **Demo property** | WEG Immanuelkirchstraße 26, 10405 Berlin (the dataset Buena gave us) |
| **Build priority** | 1. Edit flow in Obsidian (inline approve/reject, hover history, sidebar queue, status bar). 2. Bulk import (drag-and-drop archive). 3. Email-driven incremental updates. |
| **Storyline** | Homeowner onboarding: a homeowner forwards their old property manager's archive, the engine produces a clean Obsidian vault per property, then keeps it surgically up to date as new emails arrive. |

---

## Mission

Build an engine that produces a single **Context Markdown file per property**, living, self-updating, traced to its source, surgically patched without destroying human edits. The file captures **unstructured tribal knowledge** that has no place in Buena's Postgres ERP (e.g. "tenant withholding 10% rent because hot water is broken").

Buena framing: *"CLAUDE.md, but for a building, plus it writes itself."*

Ingestion is **email-first**. PDFs, scanned paper, JSON, v-files arrive as attachments. Plus one bulk-import page for day-zero ingestion of a homeowner's archive zip. The engine extracts, resolves identity, references Buena's ERP for structured lookups, and patches the right markdown file in place. Output lives in an Obsidian vault, since the Buena team are heavy Obsidian users.

---

## Ground truth from the PM (round 2 call, post-rescope)

The first PM call established the high-level constraints. The second call clarified scope and let us cut a lot of complexity:

- **ERP stays the source of truth for structured data.** Properties, buildings, units, owners, tenants live in their Postgres. We **reference them by ID** and look up live, never duplicate them in markdown.
- **The context file fills a different gap: unstructured tribal knowledge** that has no table.
- **No live collaboration.** One PM owns one property at a time. No Google-Docs-style multi-user. Drop CRDT, Yjs, awareness, Durable Objects.
- **Per-property granularity is right.** Not per-unit. "Water damage upstairs is the neighbor's problem too."
- **"Why" over "who".** Old values retained for *meaningful* changes (tenant name change). Spelling fixes don't need versioning. Loose history, not git-blame strict.
- **Bulk intake is real but limited.** One new property's archive (PDFs, Excel, paper-scanned). Not buying a whole company.
- **Patch rule, locked**: empty section + new data = auto-apply with provenance. Existing section + contradicting data = human review queue.
- **Don't reprocess on every input.** A single new email pulls context only from itself plus the resolved property, never the global archive.
- **False positives are the worst possible outcome.** Precision over recall. Route ambiguous cases to a human queue.
- **Inputs are mostly PDF**, sometimes scanned paper, sometimes Excel, sometimes JSON or v-files. Email is the trigger.
- **No PII restrictions** for the demo.

---

## Three explicit hard problems from Buena's brief

1. **Schema alignment.** "Owner" is *Eigentümer*, *MietEig*, *Kontakt*, or `owner_id` depending on the source system. Same person, different keys. The engine must resolve identity across ERPs.
2. **Surgical updates.** When a new email arrives, you can't regenerate the whole file. That destroys human edits and burns tokens. Patch the right section only.
3. **Signal vs. noise.** Even at 95% relevance, the engine still has to judge what belongs and what doesn't.

---

## About Buena (sponsor context, critical for the pitch)

Berlin-based PropTech. Series A €49.4M (mid-2025), led by GV (Google Ventures) with 20VC, Stride, Capnamic. CEO Din Bisevac (26). Co-founder Moritz von Hase. Around 30-person HQ team.

Full-stack AI-driven residential property management for the German market. 60,000+ units under management. Roughly 5,000-landlord waitlist. Revenue grew 500% in 2024. Their original strategy was AI-led M&A rollup of small German PMs (20+ acquisitions). They've since pivoted toward home ownership onboarding. The PM said either angle is fine for the demo.

Stated philosophy: "AI enhances, doesn't replace" property managers. Keep humans in the loop, always.

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  EMAIL                                                 │
│  Cloudflare Email Worker route                          │
│  Attachments fan out to R2                              │
└─────────────────┬──────────────────────────────────────┘
                  │
                  │     ┌──────────────────────────────┐
                  │     │  BULK IMPORT (day-zero)       │
                  │     │  Tiny Cloudflare Pages page   │
                  │     │  Drag-and-drop a zip archive  │
                  │     └────────────┬─────────────────┘
                  │                  │
                  ▼                  ▼
┌────────────────────────────────────────────────────────┐
│  EXTRACTION                                            │
│  • Gemini 3.1 Pro (high thinking) for ALL extraction:  │
│    plain text emails, text-layer PDFs, scanned PDFs,   │
│    vision, classification, routing — one model.        │
│  • CSV planner: NL → pandas/duckdb query, never feed   │
│    full CSVs to an LLM                                 │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  ROUTING (Gemini 3.1 Pro high thinking)                │
│  • Which property?                                     │
│  • Which section?                                      │
│  • Patch / ignore / escalate?                          │
│  Pioneer/GLiNER2 SLM is a stretch alt, not default.    │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  IDENTITY RESOLVER                                     │
│  Cross-schema clustering: Eigentümer / Kontakt /       │
│  owner_id, fuzzy name + IBAN + EH-XXX regex            │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  ERP LOOKUP ADAPTER                                    │
│  • getOwner(id), getTenant(id), getUnit(id)            │
│  • For demo: mocked from stammdaten/*.csv              │
│  • In production: queries Buena's Postgres             │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  PATCH GATE                                            │
│  • Empty section + new fact  → auto-apply              │
│  • Existing fact + same value → ignore                 │
│  • Existing fact + new value → review queue            │
│  • Confidence < threshold    → review queue            │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  R2 STORE                                              │
│  vaults/LIE-001/property.md          (rendered)        │
│  vaults/LIE-001/state.json           (structured)      │
│  vaults/LIE-001/history/             (change log)      │
│  vaults/LIE-001/attachments/         (sources)         │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  OBSIDIAN PLUGIN                                       │
│  • Pulls property.md from R2 on connect                │
│  • SSE stream from Worker for live patches             │
│  • Renders pending patches as inline callouts          │
│  • Approve / reject buttons → POST back to Worker      │
│  • Hover any fact → popover with provenance + history  │
│  • Sidebar pane: change history, pending queue         │
│  • Status bar: connection, pending count, recent patch │
└────────────────────────────────────────────────────────┘

Tavily sits to the side: lazy enrichment for public registries,
contractor reviews, permits. Pulled only when the engine wants
to add an external fact, never speculatively.
```

### Key architectural choices

- **No Durable Objects.** No live collab means no need for the WebSocket fanout layer. Plain Worker + R2 is enough. SSE for one-way patch push.
- **No Yjs / CRDT.** Single editor per file. Markdown is the canonical state on R2.
- **No multi-device demo.** PM confirmed live editing isn't important. We don't burn time on it.
- **Provenance is first-class.** Every fact in the .md links to its source (email message-id, PDF page, attachment hash, ERP lookup ID).
- **Human edits are sacred.** Human-edited sections get a marker. The patcher detects it before writing and routes the change to the review queue.
- **Scoped retrieval, not global.** Resolve property first, retrieve only that subtree.
- **Section-level versioning, not character-level.** Every accepted change writes a new entry to `history/`. Powers the hover popover.

### Concrete .md structure (per property)

```markdown
---
property_id: LIE-001
name: WEG Immanuelkirchstraße 26
address: Immanuelkirchstraße 26, 10405 Berlin
verwalter: Huber & Partner Immobilienverwaltung GmbH
last_updated: 2026-04-25
---

# WEG Immanuelkirchstraße 26

## Identity
- **Address**: Immanuelkirchstraße 26, 10405 Berlin (Prenzlauer Berg)
- **Buildings**: HAUS-12 (18 units), HAUS-14 (20 units), HAUS-16 (14 units)
- **Total units**: 52
- **Verwalter**: [[Huber & Partner Immobilienverwaltung GmbH]]
  <!-- prov: stammdaten/stammdaten.json | conf: 1.0 | actor: bootstrap -->

## Units

One property holds many units. Each unit is a sub-section under `## Units`, keyed by its EH-XXX ID. The plugin renders these as collapsible blocks. ERP-owned facts (tenant name, rent, address) are referenced by ID and resolved at render time. Only tribal-knowledge facts (open issues, notes, side-agreements) are stored inline.

### EH-014
- Tenant: {{erp.tenant(MV-0123)}}
- **Open**: withholding 10% rent due to broken hot water (since 2026-01-15)
  <!-- prov: emails/2026-01-15/EMAIL-12891.eml | conf: 0.91 | actor: gemini-flash -->
- Note from PM: tenant is patient, fix is on Hausmeister DL-001
  <!-- actor: human | edited: 2026-04-22 -->

### EH-037
- Owner-occupied: {{erp.owner(EIG-001)}}
- No open issues

### EH-008
- Tenant: {{erp.tenant(MV-0098)}}
- Subletting approved 2025-11 (Untermietvertrag in attachments/)
  <!-- prov: briefe/2025-11/BRIEF-00412.pdf | conf: 0.88 | actor: gemini-2.5-pro -->

## Bank
- WEG-Konto: DE02 1001 0010 0123 4567 89 (Postbank Berlin)
- Rücklage: DE12 1203 0000 0098 7654 32

## Owners
- {{erp.owner(EIG-001)}} (EH-037, EH-032)
  <!-- prov: erp:eigentuemer | id: EIG-001 -->

## Service providers
- Hausmeister: {{erp.dienstleister(DL-001)}}, 650 €/Monat
- Aufzugswartung: {{erp.dienstleister(DL-002)}}, 185 €/Monat

## Open issues
- Tenant in EH-014 withholding 10% rent due to broken hot water
  <!-- prov: emails/2026-01-15/EMAIL-12891.eml | conf: 0.91 | actor: gemini-flash -->
- Wartungstermin Heizung bestätigt für 06.10.2024 um 10:00
  <!-- prov: emails/2024-09/EMAIL-02443.eml | conf: 0.94 | actor: gemini-flash -->

## Last assembly decisions
- ETV 2024-04: see [[ETV-2024-04-Protokoll]]
```

ERP placeholders like `{{erp.owner(EIG-001)}}` are resolved by the plugin at render time via the ERP lookup adapter. They never store the owner's name or contact in the markdown itself, only the ID. Wikilinks make Obsidian's graph view light up with property, owners, contractors as nodes.

### R2 layout per property

```
vaults/LIE-001/
  property.md                          # rendered, the human view
  state.json                           # structured facts with provenance per section
  history/
    2026-04-25T10-14-22Z.json          # immutable change log
    2026-04-25T10-32-08Z.json
  attachments/
    EMAIL-12734.eml
    INV-04421.pdf
```

A `history/` entry contains: `section`, `oldValue`, `newValue`, `source`, `actor`, `confidence`, `decision (auto|approved|rejected)`, `timestamp`.

---

## Patch decision rule, locked

```
For each candidate fact extracted from an inbound item:
  1. Route it to a property + section + (optional) unit via Gemini 3.1 Pro (high thinking).
     (Pioneer SLM is a stretch upgrade, not a blocker.)
  2. If the property doesn't resolve confidently → human queue (escalate).
  3. If the section doesn't exist yet in the .md → auto-apply with provenance.
  4. If the section exists and the fact is new (no overlap) → auto-apply.
  5. If the section exists and the fact contradicts existing content → human queue.
  6. If the section is marked human-edited and the fact would replace human-authored text → human queue.
  7. If confidence < 0.85 regardless of the above → human queue.
```

The human queue is rendered in two places:
- **Inline in the .md as a `> [!warning] Pending patch` callout** above the affected section.
- **Sidebar pane in the plugin** listing all pending across all sections, in reverse chrono.

Approve / reject / edit buttons live on the inline callout. The sidebar mirrors them.

---

## Plugin UX details

The edit flow is the priority. The plugin is what the jury sees in the Loom. Build this first, then bulk import, then email ingestion.

### Surfaces

- **Main editor (left)**: untouched Obsidian markdown view. Reads `vault/<PropertyName>.md` from the local vault folder. Human edits land here directly.
- **Sidebar pane (right)**: custom `ItemView` registered via `registerView('buena-sidebar', ...)`. Two stacked sections: **Pending queue** (callout-style cards with approve / reject / edit) and **Property history** (reverse-chrono accepted changes, click to scroll the editor to the section).
- **Status bar (bottom)**: connection state, pending count badge, "Last patch Xm ago", animated pulse when a patch lands. One `addStatusBarItem()` call.
- **Hover popover**: custom `HoverPopover` triggered on any line carrying a `<!-- prov: ... -->` marker. Shows last 3 entries from `history/` for that section: old / new / source / actor / decision / timestamp. Click source to jump to the file in `attachments/`.
- **Inline pending callout**: pending patches render as `> [!warning] Pending patch` blocks above the affected section. A markdown post-processor replaces a `buena-pending` code-block with a rich approve / reject / edit card (same pattern as the claudian plugin's inline approval UI).
- **New-content highlight**: patches added since last open get a soft yellow background for 24h, then fade. Implemented as a markdown post-processor reading `history/` timestamps.

### Plugin component plan (hackathon-tight)

| Component | Obsidian API | Purpose |
|---|---|---|
| `BuenaPlugin` | `Plugin` | entry point, settings (R2 endpoint, bearer token, property ID) |
| `BuenaSidebarView` | `ItemView` | right-leaf pane with pending queue + history |
| `inlinePatchProcessor` | `registerMarkdownCodeBlockProcessor('buena-pending', ...)` | renders approve/reject card |
| `provenanceProcessor` | `registerMarkdownPostProcessor()` | scans for `<!-- prov: ... -->` and attaches hover handler |
| `BuenaHoverPopover` | `HoverPopover` | renders last 3 history entries |
| `BuenaStatusBar` | `addStatusBarItem()` | connection + pending count |
| `SSEClient` | plain `fetch` with `text/event-stream` | one-way push from Worker |

File watching: register `vault.on('modify', ...)` on the property.md so a human edit immediately marks affected sections as human-edited (writes a `human-edit` marker into `state.json` via the Worker).

---

## Partner technology stack

We use exactly **3 required techs** plus **2 side-challenge techs**.

### 1. Google DeepMind (Gemini), single model for everything

- **Gemini 3.1 Pro with high thinking** for ALL inference: PDF vision, contract reasoning, ETV protocols, plain text emails, relevance classification, section assignment, routing. One model, no Flash, no fallbacks.

```python
# uv pip install google-genai
from google import genai
from google.genai import types

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
response = client.models.generate_content(
    model="gemini-3-pro-preview",  # 3.1 Pro
    contents=[email_text, "Output JSON: {property_id: str, sections: [str], confidence: float}"],
    config=types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(thinking_level="high"),
    ),
)
```

### 2. Tavily, web research and enrichment

For lazy enrichment: building permits, contractor reviews, public registry data. Pulled only when the engine wants to add an external fact, never speculatively. Setup: 1,000 free credits per account. Fallback code `TVLY-DLEE5IJU`. Hosted MCP at `https://mcp.tavily.com/mcp/?tavilyApiKey=<key>`.

### 3. Pioneer / Fastino (GLiNER2), structured extraction and intent SLM (stretch)

**Status**: optional / stretch goal. The core router uses Gemini Flash. Pioneer is the upgrade path if we have time after the edit flow ships.

Schema-driven extraction for property facts plus an intent SLM that routes incoming items to {patch, ignore, escalate, contractor-update, owner-change, ...}. Pioneer fine-tune is trivial: the dataset's `*_index.csv` files have categories like `eigentuemer/rechtlich`, `mieter/kaution`, `versorger/versorger` already labelled. Use those as supervised training data. Targets the **Pioneer side challenge** (€700).

If time-boxed out, swap Pioneer for a third partner tech we already use confidently. Required-tech count must remain at 3.

### Side challenges

- **Entire** (`entire enable --agent claude-code`). Free, captures Claude Code sessions per commit. Targets $1,000 Apple cards plus Switch 2 plus PS5 plus XBOX.
- **Aikido**. Connect repo, screenshot security report. Targets €1,000.

### Dropped from v1

- **Yjs / CRDT / y-partyserver / Durable Objects**: dropped after PM confirmed no live collab.
- **Multi-device live demo**: dropped, PM said live editing isn't important.
- **iOS app**: dropped.
- **Full web app**: dropped, only a tiny bulk-import page survives.
- **FastAPI backend**: dropped, Cloudflare Workers replaces it.
- **Gradium / voice**: dropped, reserved as fallback if a required partner tech fails.
- **Telli**: dropped.

---

## Data handling rules (non-negotiable)

- **Never feed full CSVs to an LLM.** Use the CSV planner: agent writes a question, planner produces a pandas/duckdb query, query runs, result returned as JSON. Lives in `pipeline/csv_query.py`.
- **Never duplicate ERP-owned data in markdown.** Reference by ID, resolve at render time.
- **Default PDF path is OCR-capable.** pdfplumber for text-layer, Gemini vision for everything else. Don't assume text-layer like the simulator data.
- **Don't ingest `*_index.csv` files.** They're the simulator's answer key for evaluation.
- **All inbound items get an immutable copy in `attachments/`** before any extraction runs. Provenance must point at a stable hash.

---

## Implementation plan (24-hour build)

Order matters: edit flow ships first, then ingestion. The plugin is the demo.

### Phase 1, Foundation (hours 0 to 3)
- [x] Public GitHub repo
- [x] `entire enable --agent claude-code` configured
- [x] Buena dataset extracted to `partner-files/`
- [x] PM interviews documented
- [ ] Cloudflare Worker skeleton (`workers/ingest`) with R2 read/write + SSE endpoint
- [ ] Bootstrap script: parse `stammdaten/` into one initial property.md + state.json + history seed (so the plugin has something real to render on hour 3)
- [ ] ERP lookup adapter mocked from stammdaten CSVs

### Phase 2, Plugin edit flow (hours 3 to 10), primary demo surface
- [x] Plugin scaffold (manifest.json, main.ts, settings tab)
- [x] Sidebar `ItemView` with pending queue + history list (`plugin/src/sidebar.ts`, 470+ LOC, scans vault for `buena-pending` blocks live)
- [x] Inline `buena-pending` code-block processor with approve/reject card (`plugin/src/inline-patch.ts`)
- [x] Approve/reject wired to actually edit the vault file (`plugin/src/vault-patch.ts`: `applyPatchToVault`, `stripPendingBlockById`, `findPendingBlocks`)
- [x] Hover popover on `<!-- prov: ... -->` markers (`plugin/src/popover.ts` + `hover.ts`)
- [x] Status bar with connection + pending count + last-patch indicator (`plugin/src/statusbar.ts`)
- [x] Local history log (`plugin/src/history.ts`): every approve/reject writes to plugin data, capped at 50 per file, surfaced in sidebar history pane
- [x] Buena brand palette + wordmark + unit pills + rich hover popovers (styles.css)
- [x] Dev setup documented (symlink + hot-reload, see `plugin/README.md`)
- [ ] Pull property.md + state.json from R2 on connect (blocked on Worker)
- [ ] SSE client for live patch push from Worker (blocked on Worker)
- [ ] Approve/reject POSTs back to Worker (blocked on Worker)
- [ ] New-content highlight (24h soft-yellow)
- [ ] Human-edit detection: `vault.on('modify', ...)` writes a marker into state.json

### Phase 3, Core ingestion engine (hours 10 to 16)
- [ ] **Email parsing**: walk `emails/`, normalise headers, extract body plus attachments
- [ ] **PDF extraction**: send PDF bytes directly to Gemini 3.1 Pro (high thinking); pdfplumber only as a pre-pass for token-cost optimization on text-layer PDFs
- [ ] **CSV planner**: NL question → pandas query → JSON result
- [ ] **Identity resolver**: cluster entities across stammdaten and inbound text
- [ ] **Routing**: Gemini 3.1 Pro (high thinking) classifier (property + section + unit)
- [ ] **Patch gate**: implement the 7 rules above
- [ ] **History log**: every accepted change writes to `history/`
- [ ] (stretch) Pioneer SLM router fine-tune for side-challenge

### Phase 3b, Plugin polish (hours 16 to 18)
- [ ] Provenance jump: clicking a `<!-- prov: ... -->` opens the source PDF in Obsidian's native viewer
- [ ] Multi-unit collapse/expand under `## Units`
- [x] Animated patch pulse in status bar (`markPatchReceived`)
- [x] Cloudflare setup playbook drafted (`docs/cloudflare-setup.md`), parked until extractor + edit flow stable

### Phase 4, Bulk import (hours 18 to 20)
- [ ] Cloudflare Pages page with drag-and-drop file input
- [ ] On upload, fans the archive into the same pipeline
- [ ] Live progress display: "Parsing 47 of 194 invoices…"

### Phase 5, Demo polish (hours 20 to 22)
- [ ] **Bootstrap demo**: ingest the full base archive, show the initial vault build live
- [ ] **Incremental replay**: walk `incremental/day-01` through `day-10`, replay each day's deltas
- [ ] **Conflict scenario**: trigger one pending patch on a section the human pre-edited, show the queue UX
- [ ] **Tavily enrichment**: pull one or two demo facts from public sources
- [ ] **Real PDF stress test**: drop one scanned PDF (not from simulator) into the pipeline to prove OCR path works

### Phase 6, Submission (hours 22 to 24)
- [ ] README with setup instructions
- [ ] 2 min Loom recording
- [ ] Aikido scan + screenshot
- [ ] Pioneer fine-tune documentation
- [ ] Final commit, public push
- [ ] Submission form filled
- [ ] Side challenge submissions (Pioneer, Aikido, Entire)

---

## Demo plan, the 2-min Loom

Storyline: **homeowner onboarding**.

### 0:00 to 0:15, the hook
> *"A homeowner just bought into a Berlin WEG. Their old property manager handed over an archive: thousands of emails, scanned letters, contracts, bank statements, master data exports. Today, untangling that takes weeks. Watch this."*

Screen: a chaotic folder with mixed file types from `partner-files/`.

### 0:15 to 0:50, the bulk bootstrap
Drag the archive zip onto the bulk-import page. On screen:
- Files stream through the Cloudflare Worker
- Gemini extracts entities from PDFs
- Pioneer SLM routes each item
- Identity resolver merges duplicates
- One Obsidian vault file emerges for `WEG Immanuelkirchstraße 26`
- Cut to Obsidian: graph view explodes with property, owners, tenants, service providers

### 0:50 to 1:30, the surgical update
Replay `incremental/day-01`. Three new items land:
- An email from the Heizungs-Versorger about a maintenance appointment
- An invoice PDF from the Hausmeister
- An email contradicting an existing fact (triggers the review queue)

Show in Obsidian:
- First two: surgical patches, only the affected lines change, soft-yellow highlight
- Third: pending callout appears, hover shows source email, click "Approve" → patch lands
- A pre-edited human note nearby is untouched

### 1:30 to 1:50, the speed
Run days 02 through 05 in fast-forward. Vault keeps updating. No re-processing of the base archive on any new email.

### 1:50 to 2:00, the close
> *"Buena's onboarding pain solved in 24 hours, native to their Obsidian workflow. Built with Gemini, Tavily, and a Pioneer-fine-tuned router. Every fact in the vault traces back to its source. Humans always have the final word."*

End on the Obsidian graph view + sidebar history pane.

---

## Suggested file structure

```
buena-hackathon/
├── AGENTS.md                    # this file
├── README.md                    # public README
├── docs/
│   ├── architecture.md
│   ├── demo-script.md
│   └── pioneer-finetune-notes.md
├── workers/
│   ├── wrangler.toml
│   ├── src/
│   │   ├── ingest.ts            # email webhook + bulk upload entry
│   │   ├── extract.ts           # Gemini PDF + text
│   │   ├── route.ts             # Pioneer SLM call
│   │   ├── identity.ts          # cross-schema resolver
│   │   ├── erp.ts               # mocked ERP lookup adapter
│   │   ├── gate.ts              # 7-rule patch decision
│   │   ├── history.ts           # change log writer
│   │   ├── render.ts            # state.json → property.md
│   │   ├── sse.ts               # SSE push to plugin
│   │   └── enrich.ts            # Tavily lookups
│   └── package.json
├── pipeline/                    # local Python helpers, fine-tune, batch bootstrap
│   ├── pyproject.toml           # uv-managed
│   ├── bootstrap.py             # one-shot full-archive ingestion
│   ├── replay_incremental.py    # walks day-01 to day-10
│   ├── csv_query.py             # NL → pandas/duckdb
│   └── pioneer_finetune.py
├── plugin/                      # Obsidian plugin
│   ├── manifest.json
│   ├── main.ts
│   ├── sidebar.ts
│   ├── statusbar.ts
│   ├── popover.ts
│   ├── sse-client.ts
│   └── package.json
├── bulk-import/                 # tiny Cloudflare Pages page
│   ├── index.html
│   └── upload.ts
├── vault/                       # generated Obsidian vault, output of the engine
│   └── WEG-Immanuelkirchstrasse-26.md
└── partner-files/               # Buena's dataset (committed)
    ├── stammdaten/
    ├── briefe/
    ├── emails/
    ├── rechnungen/
    ├── bank/
    ├── incremental/
    └── product-interview/
        ├── pm-interview.md
        └── pm-interview-2.md
```

---

## Submission checklist (Sunday 14:00 hard deadline)

- [ ] **2-min Loom video demo**
- [ ] **Public GitHub repo** with:
  - [ ] Comprehensive README
  - [ ] Documentation of all APIs and tools
  - [ ] Sufficient technical docs for jury evaluation
- [ ] At least **3 partner techs** confirmed (Gemini, Tavily, Pioneer)
- [ ] Project newly created at this hackathon (boilerplates allowed)
- [ ] Submitted via the project submission form

### Side challenge submissions
- [ ] Pioneer: confirm use, document the GLiNER2 router fine-tune (€700)
- [ ] Aikido: connect repo, screenshot security report (€1,000)
- [ ] Entire: confirm use, document the meta-narrative ($1K Apple cards plus Switch 2 plus PS5 plus XBOX)

---

## Important hackathon facts

- **Location**: Donaustraße 44, 12043 Berlin
- **Hosts**: The Delta Campus and Code University of Applied Sciences
- **Discord**: https://discord.gg/brSqTjJVdh
- **Lunch and dinner** provided
- **Saturday**: 10:00 doors, 10:30 opening, 12:30 lunch, 18:30 dinner
- **Sunday**: 12:30 lunch, **14:00 deadline**, 15:00 finalists, 15:15 finalist pitches, 16:30 awards
- **Finalist stage**: 8 teams, 5-min pitch, top 3 win cash plus credits. **1st place: €10K** plus 5K Gemini credits plus 10K Tavily credits plus 900K Gradium credits plus Pioneer Pro.

---

## Anti-patterns to avoid

- **Don't regenerate the whole .md.** Surgical patches only.
- **Don't ignore provenance.** Every fact must trace to a source.
- **Don't reprocess the global archive on every email.** Resolve property first, scope retrieval to that subtree.
- **Don't patch on uncertainty.** Route ambiguous cases to the review queue.
- **Don't propose AI replacing property managers.** Buena's stated philosophy is enhancement.
- **Don't duplicate ERP data in markdown.** Reference by ID.
- **Don't feed full CSVs to LLMs.** Always go through the CSV planner.
- **Don't assume PDFs have a text layer.** Default path must handle scans.

---

## Operational rules for the agent

- **No em dashes** in human-facing text. Use commas, periods, semicolons, colons.
- **Python**: always `uv pip install` and `uv run python ...`.
- **API keys**: check macOS Keychain first via `security find-generic-password -s "<service>" -w`. `gemini-api-key` is in Keychain and added to `.env.local` as `GEMINI_API_KEY`.
- **Long-running processes**: use tmux, never `&` or `nohup`.
- **Diffity is OFF for this repo.** Override of the global rule in `~/Git/CLAUDE.md`: do NOT run `diffity` before commits or pushes. Hackathon repo, speed over review. Just commit and push.

---

## Open questions parked for later

1. **MCP server** exposing the engine to Claude Desktop / agents. Mention as v2 hook in Loom.
2. **Reverse propagation**: when a human edits in Obsidian, do changes flow back to Buena's Postgres? Out of scope for v1.
3. **Multi-property top-level index.md**. If we have time at hour 18, add it.
4. **Push notification surface**. SSE to Obsidian works for in-app, but cross-device pings need extra plumbing.
5. **Languages**: Polish, Turkish, Russian inbound. PM said translate upstream, parked.

---

## Appendix, references

- Buena: https://www.buena.com/en
- Tavily docs: https://docs.tavily.com
- GLiNER2: https://github.com/fastino-ai/GLiNER2
- Pioneer: https://fastino.ai/docs/overview
- Entire CLI: https://github.com/entireio/cli
- Cloudflare Email Workers: https://developers.cloudflare.com/email-routing/email-workers/
- Big Berlin Hack submission form: https://forms.techeurope.io/bbh/content-challenge

---

*Last updated Saturday post-PM-call-2, by Mahir + team. Update this file as decisions evolve.*
