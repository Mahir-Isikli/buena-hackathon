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
| **Partner techs (3 required)** | Gemini (core extraction + routing), Tavily (enrichment), TBD third tech. Pioneer was dropped, see "Pioneer dropped for v1" below. Plus Entire and Aikido as side challenges. |
| **Team** | Mahir (AI/product), Anwar (automation), Yasin (design) |
| **Surface** | Obsidian plugin (primary), tiny web page for bulk import only. No iOS, no live web app, no Durable Objects, no Yjs. |
| **Demo property** | WEG Immanuelkirchstraße 26, 10405 Berlin (the dataset Buena gave us) |
| **Build priority** | 1. Edit flow in Obsidian (sidebar review queue, hover history, status bar, clean property briefing). 2. Bulk import (drag-and-drop archive). 3. Email-driven incremental updates. |
| **Storyline** | Homeowner onboarding: a homeowner forwards their old property manager's archive, the engine produces a clean Obsidian vault per property, then keeps it surgically up to date as new emails arrive. |

---

## Pioneer dropped for v1, rationale

We spent a chunk of Saturday training a Pioneer (fastino/gliner2-base-v1) NER model on the Buena dataset. We're shelving it for v1. Honest reasoning, no side-challenge bias:

- **Trained NER F1 was 0.29.** Root cause: we trained on noisy auto-labels from Pioneer's own `label-existing` endpoint, which hallucinated ID strings from surrounding context.
- **The 4 ID labels (EH-XXX, EIG-XXX, MIE-XXX, DL-XXX) literally do not appear in email text.** A regex scan over 1,200+ inbound emails returned 0 matches for each ID prefix. They're internal admin keys that live only in stammdaten, never in correspondence.
- **93.7% of emails resolve to ERP IDs deterministically via a sender/recipient email join with stammdaten.** Verified: `mehdi.faust@bsr-berliner-stadtreinigung.de` → DL-011, `lisa.brown@techclean-international.com` → DL-016, `tom.hartmann@icloud.com` → EIG-022 (and his "Wohnung WE 29" maps to EH-029 via `einheit_nr`). 68.4% join via sender alone, 93.7% via sender OR recipient.
- **For the remaining 6.3%**, the email has no clean ERP match. Those go to the human review queue, same as any other ambiguous routing.
- **Surface entities** (amount, date, invoice_no, IBAN, Wohnung-Nummer) are handled by Gemini directly during extraction. A SLM doesn't beat Gemini on this for the volumes we have.

**Identity resolution lives in two places:**
- **Now (hackathon demo):** in-memory join over `partner-files/stammdaten/*.csv`, exposed via the `erp.ts` lookup adapter. Same interface the production system would use.
- **Later (production):** the same lookup hits Buena's Postgres. The CSV adapter is just a stand-in for the DB.

**Pioneer artifacts kept** (not deleted): trained model `fe8b263b-c2e7-4879-8c81-1705fe9be618`, eval harness in `pipeline/pioneer/`, the Gemini-relabelled NER dataset (`ner_labelled_v2.jsonl`, 1179 rows). If we ever need to drop inference cost at scale, the path back is open. For 24h/Buena's volumes, Gemini + CSV join is the right call.

**Required tech impact:** we still need 3 partner techs. Gemini and Tavily are locked. Replacement for the third slot is TBD, options include Entire (already in for the meta-challenge), or staying at 2 if the rules allow it. Decision parked until Sunday morning.

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
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  IDENTITY RESOLVER                                     │
│  Deterministic email join with stammdaten (93.7% hit). │
│  Sender/recipient email → DL/EIG/MIE id. Fallback:     │
│  fuzzy name + IBAN. Misses route to human queue.       │
│  Now: CSV. Later: Postgres. Same interface.            │
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
     (All routing via Gemini 3.1 Pro high thinking.)
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
- **Pending review surface**: pending patches live in the right sidebar queue, not in the markdown body. The markdown should stay readable as a clean property briefing while the sidebar owns review actions.
- **New-content highlight**: patches added since last open get a soft yellow background for 24h, then fade. Implemented as a markdown post-processor reading `history/` timestamps.

### Plugin component plan (hackathon-tight)

| Component | Obsidian API | Purpose |
|---|---|---|
| `BuenaPlugin` | `Plugin` | entry point, settings (R2 endpoint, bearer token, property ID) |
| `BuenaSidebarView` | `ItemView` | right-leaf pane with pending queue + history |
| `sync layer` | `pullPropertySnapshotOnce()` + `fetchPending()` | keeps markdown mirrored from remote and loads the queue into the sidebar |
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

### 3. Third partner tech, TBD

Pioneer was the original pick. **Dropped for v1**, see "Pioneer dropped for v1, rationale" near the top of this file. Short version: the 4 ID labels we'd want to extract don't appear in email text, and 93.7% of emails resolve to ERP IDs via a deterministic CSV (later: Postgres) join on sender/recipient email. Gemini handles the surface entities (amount, date, IBAN). A small NER model adds nothing at our volumes.

**Replacement options** (decide Sunday morning):
- Lean harder on Tavily (multiple enrichment surfaces).
- Add Entire formally as the third tech (already in for the meta-challenge).
- Confirm with the Buena PM that 2 partner techs is acceptable if both are deeply integrated.

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
- [x] Cloudflare Worker skeleton (`workers/ingest`) with R2 + Queue + Email Routing wired, end-to-end tested, including SSE vault endpoints.
- [x] Bootstrap script: parse `stammdaten/` into one initial property.md + state.json + `erp.json` (so the plugin has something real to render on hour 3)
- [x] ERP lookup adapter mocked from stammdaten CSVs

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
- [x] Pull property.md + state.json from R2 on connect (`plugin/src/sync.ts`, `plugin/main.ts`)
- [x] SSE client for live patch push from Worker (`plugin/main.ts` + `plugin/src/api.ts`)
- [x] Approve/reject POSTs back to Worker, including rejection reason (`plugin/src/api.ts`, `sidebar.ts`, `inline-patch.ts`)
- [x] New-content highlight (24h soft-yellow) via inline changed markers + recent-content styling (`plugin/src/popover.ts`, `styles.css`)
- [x] Human-edit detection: editor changes mark sections in local + remote state.json (`plugin/src/human-edits.ts`, worker `POST /vaults/:id/human-edit`)

#### Current plugin decisions (Sunday late)
- The current canonical split is: **left side = property briefing**, **right side = workflow UI**. Do not put the pending queue back into markdown unless the user explicitly wants that.
- Remote `property.md` for `LIE-001` was updated on Sunday night to the simplified structure. Treat the remote worker snapshot as canonical. If Obsidian shows the old rich layout again, check remote first and then run a full plugin sync.
- Keep `## Beirat notes` for now. It is a manual-only notes section and is not removed in this pass.
- The property markdown should use this simplified section order: `Summary`, `Open issues`, `Side agreements`, `Assembly decisions`, `Beirat notes`, then lightweight reference tables for buildings, owners, service providers, finances, and the unit index.
- `Unit index` should render as a clean table, not as hover-heavy chips. Keep hover minimal there. Per-building collapse / expand exists now.
- Change history lives in the plugin tab, not in markdown. Rejections require a reason and stay visible there.
- Local property markdown should mirror remote `property.md` + `state.json` only. The pending queue lives in the sidebar and should not be appended into markdown.
- The sidebar queue should fetch pending patches from the worker and show scope explicitly: `EH-XXX`, `HAUS-XX`, or `DL-XXX`, not pretend everything is a unit issue.
- The markdown should keep tribal knowledge plus lightweight references. It should not act like a second ERP. Structured master data remains canonical elsewhere.
- The presentation angle is: the left side is pleasant and human-readable, but still plain enough underneath for agents to use. The right side can be richer and more obviously product-like.
- Sidebar UI source of truth is now `ui-mockups/interactive-redesign-v19.html`, implemented primarily through the bottom `SIDEBAR V19 OVERRIDES` block in `plugin/styles.css`.
- If a future agent needs to change sidebar visuals, start with:
  - `plugin/styles.css` for visuals
  - `plugin/src/sidebar.ts` for header, tabs, queue cards, and history table structure
  - `plugin/src/statusbar.ts` for the footer bar
- Current history table simplification:
  - `When` is inline inside the section cell, not a separate column
  - decision is simplified, approved = check only, rejected = x only, auto = icon + `auto`
  - no separate mode column
- Keep the sidebar surface white or only very slightly off-white. Do not reintroduce the older full-panel cream styling.
- Per-property `@kontext.haus` email routing is part of the current path. Worker now resolves subaddress first, then deterministic sender/recipient email lookup from the committed ERP seed. Safe unit hinting applies only when the match collapses to exactly one unit.
- Speech-to-text for rejection reasons is explicitly deferred for now.
- Bulk import stays in scope. Do not drop the public drag-and-drop page yet.
- Current bulk consumer coverage: text, markdown, JSON, CSV, HTML, EML, PDF, common images, zip, docx, and xlsx family parsing.

### Phase 3, Core ingestion engine (hours 10 to 16)
- [x] **Email ingestion** via Cloudflare Email Worker (postal-mime, R2, queue). Local walk of `emails/` is the next step.
- [x] **PDF extraction**: PDFs can flow through Gemini 3.1 Pro in the bulk + attachment paths; text-layer optimization / dedicated OCR tuning can still improve this further
- [ ] **CSV planner**: NL question → pandas query → JSON result
- [x] **Identity resolver**: deterministic sender/recipient email join against stammdaten seed first, then fallback extraction for the remaining misses (`workers/ingest/src/route.ts` + generated routing index)
- [x] **Routing**: subaddress routing + deterministic email lookup first, Gemini 3.1 Pro (high thinking) for the ambiguous remainder
- [x] **Patch gate**: 7-rule worker-side gate implemented end to end with ignore / pending / auto classification, auto-writeback into remote `property.md`, and auto/manual visibility in history (`workers/ingest/src/gate.ts`, `http.ts`, `vaults.ts`)
- [x] **History log**: every accepted, rejected, or auto-applied change writes to `history/`, with auto/manual visibility
- [x] ~~Pioneer SLM router fine-tune~~ Dropped for v1. See "Pioneer dropped for v1" at top of file.

### Phase 3b, Plugin polish (hours 16 to 18)
- [x] Provenance jump: raw `r2://buena-raw/...` sources can be pulled into the vault and opened from the provenance pill (`plugin/src/provenance-open.ts`)
- [x] Multi-unit collapse/expand under `## Unit index` (simple per-building toggle in reading view)
- [x] Animated patch pulse in status bar (`markPatchReceived`)
- [x] Cloudflare setup playbook drafted (`docs/cloudflare-setup.md`), parked until extractor + edit flow stable

### Phase 4, Bulk import (hours 18 to 20)
- [x] Public bulk-import page deployed on Cloudflare Pages and attached to `import.kontext.haus`
- [x] Internal bulk-import page with drag-and-drop, property dropdown, add-new-property flow, and any-file upload (`bulk-import/index.html`)
- [x] On upload, files are stored in R2 with property metadata and queued into the same pipeline (`workers/ingest/src/http.ts`)
- [x] Bulk queue consumer now processes text-like files end to end, passes PDFs/images to Gemini as inline multimodal inputs, and parses zip / docx / xlsx families into extractable text (`workers/ingest/src/email.ts`, `workers/ingest/src/gemini.ts`)
- [x] Basic live progress visibility in the upload UI: per-file upload progress plus pending/history polling after upload
- [ ] Richer live progress display: "Parsing 47 of 194 invoices…"

### Phase 5, Demo polish (hours 20 to 22)
- [ ] **Bootstrap demo**: ingest the full base archive, show the initial vault build live
- [ ] **Incremental replay**: walk `incremental/day-01` through `day-10`, replay each day's deltas
- [x] **Conflict scenario foundation**: provider conflict stays pending while unit / building facts auto-apply. A cleaner scripted demo pass is still useful.
- [ ] **Tavily enrichment**: pull one or two demo facts from public sources
- [ ] **Real PDF stress test**: drop one scanned PDF (not from simulator) into the pipeline to prove OCR path works

### Phase 6, Submission (hours 22 to 24)
- [ ] README with setup instructions
- [ ] 2 min Loom recording
- [ ] Aikido scan + screenshot
- [ ] Final commit, public push
- [ ] Submission form filled
- [ ] Side challenge submissions (Aikido, Entire)

---

## Demo plan, the 2-min Loom — locked

**Headline beat: "The Human Always Wins."** Real Gmail, real DNS, real Cloudflare Email Routing, real Worker, real vault. Nothing simulated. The bootstrap is already done, the demo opens on a populated vault and shows it staying alive in real time.

Storyboard reference: `~/nanobanana-images/nb_20260426_002026_4k.png` (the four-stage poster).

### 0:00 to 0:15, the gap
> *"A Berlin property manager gets hundreds of emails a week. Each one: read, decide which property, which unit, which owner, open the right file, type the update, file the original. Five to fifteen minutes per email. Watch this."*

Screen: a populated Obsidian vault for `WEG Immanuelkirchstraße 26`. Sidebar empty. Status bar idle.

### 0:15 to 0:45, live email one (auto-apply)
From the phone, on stage, send a freehand email to `property+LIE-001@kontext.haus`:
- **Subject**: `WE 14 Warmwasser defekt`
- **Body**: `In WE 14 ist seit Freitag das Warmwasser ausgefallen. Mieter mindert ab heute 10 Prozent.`

Within ~10 seconds in Obsidian:
- Status bar pulses
- Sidebar card appears, scoped to `EH-014`
- Auto-applied line lands under `## Open issues`, soft-yellow highlight
- Hover the provenance pill, the actual email body shows

Narration: *"Subaddress routing picks the property. Deterministic ERP join picks the unit. Empty section plus new fact, auto-applied with provenance."*

### 0:45 to 1:20, live email two (the kill shot, "human always wins")
Second email from the phone, same address:
- **Subject**: `Korrektur`
- **Body**: `Korrektur: Heizung defekt, nicht Warmwasser. Ab 1. Mai.`

This time the engine **does not** auto-apply. It detects the contradiction:
- Sidebar pending card with amber border
- Side-by-side diff: old `Warmwasser…` strikethrough, new `Heizung defekt seit 1. Mai…`
- Approve button. Click. Line updates, history pane logs old → new with both source emails.

Narration: *"Existing fact plus contradicting fact equals human review. Precision over recall. The engine never overwrites without permission."*

### 1:20 to 1:45, the Beirat beat (humans are sacred)
Before recording, manually type a note in `## Beirat notes` in Obsidian. On camera, send an email that would touch that section. It routes to pending, not auto-applied.

Narration: *"Human-edited sections get a marker. The patcher detects it before writing. Buena's stated philosophy is AI enhances, doesn't replace. This is what that looks like in code."*

### 1:45 to 1:55, the multi-tenant reveal
One more email, this time `property+LIE-002@kontext.haus`. Different vault opens. Same flow. *"Every property gets its own address. Every email knows where it belongs."*

### 1:55 to 2:00, the close
> *"CLAUDE.md, but for a building. Self-updating. Surgical. Traceable. Built with Gemini 3.1 Pro, Cloudflare Email Routing, and Tavily. Humans always have the final word."*

End on the sidebar history pane showing the full chain of decisions.

### Pre-flight checklist (record day)
- [ ] Send one throwaway email 5 minutes before recording to warm Gmail → Cloudflare delivery path
- [ ] Pre-stage Beirat notes manual edit
- [ ] Confirm `LIE-002` vault exists for the multi-tenant beat (or cut that beat if not)
- [ ] `gog` CLI authed, phone Gmail logged in (belt and suspenders, either path)
- [ ] Worker tail running in a side terminal so we can show real logs if delivery is slow
- [ ] Property markdown clean, no leftover pending cards from earlier tests

### Risk notes
- Gmail → Cloudflare delivery is usually 2-15s but can spike to 30s+. If it stalls during the live shot, narrate it: *"this is real DNS, real spam filtering, real queue."* That's a feature, not a bug.
- If Gemini routing is slow, the auto-apply takes longer. Don't fake it. Wait it out, narrate the queue.
- Don't demo the bootstrap. It's already done. Opening on a populated vault is stronger than opening on chaos.

---

## Suggested file structure

```
buena-hackathon/
├── AGENTS.md                    # this file
├── README.md                    # public README
├── docs/
│   ├── architecture.md
│   ├── demo-script.md
│   └── identity-join-notes.md
├── workers/
│   ├── wrangler.toml
│   ├── src/
│   │   ├── ingest.ts            # email webhook + bulk upload entry
│   │   ├── extract.ts           # Gemini PDF + text
│   │   ├── route.ts             # Gemini 3.1 Pro routing call
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
│   └── pioneer/                  # parked, not loaded by v1 pipeline
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
- [ ] At least **3 partner techs** confirmed (Gemini, Tavily, third TBD; Pioneer dropped)
- [ ] Project newly created at this hackathon (boilerplates allowed)
- [ ] Submitted via the project submission form

### Side challenge submissions
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

## Design principles (lifted from the Buena redesign framework)

Anwar's `buena-design-framework` doc on `origin/Anou4r-patch-2` reverse-engineers Din Bisevac's design taste. Three rules from that doc apply directly to what we're shipping. Treat them as gates, not aspirations. 

*Note: For exact design tokens, colors, and typography extracted from the live `buena.com` brand website, reference `HSMD.md`. It includes their signature forest green (`#0d7835`), stone background (`#fafaf9`), and typography (`Inter`, `Signifier`).*

### 1. Opinion per section

Every section in `property.md` carries one opinionated stance, written down. If we can't state the opinion in one sentence, the section isn't done and probably shouldn't exist. Current opinions:

- **Summary**: the homeowner's 30-second briefing. One paragraph, no lists. If it needs bullets, it belongs in another section.
- **Open issues**: only items that have a person, a unit/building/provider, and an unresolved state. Closed issues move to history, never linger here.
- **Side agreements**: human-authored exceptions to the standard lease or HOA rules. Never auto-extracted without human review, because misclassifying these is the worst possible failure.
- **Assembly decisions**: pointers to ETV protocols, not the protocols themselves. The protocol PDF is the source of truth, this section is the index.
- **Beirat notes**: manual-only. The engine never writes here. This is the PM's freehand space and protecting it is the whole point of the human-edit detector.
- **Unit index**: a flat reference table, one row per EH-XXX. ERP-owned facts only. Tribal knowledge for a unit lives in the unit's own subsection elsewhere, not in this table.

If we add a new section, we add a new bullet here first.

### 2. Painful baseline, target compression

Every demo claim leads with a single number. The Loom and the README hero use the same one. Locked baselines:

- **Homeowner archive intake**: 3 weeks of paralegal-style untangling → 4 minutes of drag-and-drop and review.
- **Single email update**: 5 to 15 minutes of "which file does this go in" → under 10 seconds, surgical patch with provenance.
- **Identity resolution on inbound email**: 100% manual today → 93.7% deterministic, the remainder routed to a human queue (verified against the stammdaten join).

If a number isn't in this list, we don't claim it on stage.

### 3. Voice audit

Everything a human reads, in the plugin, in the Worker, in the bulk-import page, in the README, sounds like a person wrote it. No corporate filler, no "An unexpected error occurred", no "Please be advised". Rules:

- **Errors name the cause and the next action.** "We couldn't reach Gemini. Retrying in 5s, or click Retry." Not "An unexpected error occurred."
- **Pending callouts say what's pending and why we paused.** "This contradicts the existing rent figure (1,240 EUR vs. 1,180 EUR). Approve to overwrite, reject to keep the current value."
- **Status bar is one short clause.** "Synced 12s ago", "3 pending", "Reconnecting…". Not "Connection status: established".
- **Rejection reasons are the user's words, never templated.** Free text in, stored as-is.
- **No "kindly", no "please be advised", no passive-corporate constructions, no em dashes** anywhere in user-facing text.

Before the Loom, do one read-aloud pass over every visible string. Anything that sounds like SaaS boilerplate gets rewritten.

### 4. Plugin visual style, locked

The Obsidian sidebar and the property markdown share one rounded surface family. Don't drift from it without checking with Mahir first.

- **Cards** (queue cards, history table card, statusbar, inbox card on the property md): `border-radius: 16px`, `1px solid #d6d3d1`, white fill, soft `0 4px 6px -1px rgba(0,0,0,0.03)` shadow, inset 20px from the sidebar edges.
- **Pills and chips** (filter chips, source pill, confidence pill, unit pill, decision pill, "Go to section", inbox copy button, ERP refs): `border-radius: 999px`, single 1px border, no double-border (no extra `box-shadow`). When the chip is `.buena-chip-conflict`, the border must be visible against its tinted fill — use `#fdba74` not `#ffedd5`.
- **Approve / Reject buttons in queue cards**: 28px circular icon-only buttons. Approve is filled black with white check; Reject is soft neutral grey with dark x. They sit pinned to the bottom-right of the card; no full-width rectangles.
- **Header wordmark**: Kontext SVG mark (`.buena-kontext-mark`, inline 16×20 in `currentColor` black) + 1px vertical divider + "Buena" (18px / 700, NOT italic — `font-style: normal` enforced) + 1px vertical divider + the property name. No "Kontext" text label, no ".haus", no pill-wrap, no green tint. The mark glyph lives inline in `plugin/src/sidebar.ts` (paths copied from `kontext_logo.svg`); keep `currentColor` so it picks up the wordmark color. The property name is plain monospace inline text in muted grey (`#4A4744`), no pill/background. Header padding: `28px 28px 20px`, title-row gap `20px`, wordmark gap `14px`.
- **Diff (pending cards)**: old value muted grey + line-through; new value black with a soft butter-yellow highlighter band (`#fff3b0`, `border-radius: 4px`, `box-decoration-break: clone`). When there's no old value, swap the highlighter to soft mint (`#ecfdf5`).
- **Hover popovers**: 16px radius, `#d6d3d1` border. Inline mono badges inside are 999px pills; the email-body preview block is 10px radius. Never set both a native `title` and an `attachHoverPopover` on the same element — pick one.
- **Property markdown inbox card**: 16px radius, no inset left accent stripe, material-style outline SVG icon (not emoji), copy button is a 999px pill. Live in `plugin/src/property-header.ts` + `.buena-inbox-card*` styles.

The V19 override block at the bottom of `plugin/styles.css` is the source of truth for these. Older rules earlier in the file may contradict — V19 wins by cascade order.

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

## Cloudflare infrastructure (provisioned, parked until ingest phase)

Domain, account, and email routing are already provisioned. The Worker code is **not** deployed yet. Do not touch this until we hit Phase 3 (core ingestion). Listing it here so future sessions don't waste time rediscovering the wiring.

### What's live on Cloudflare today
- **Domain**: `kontext.haus` (registered 2026-04-25, Cloudflare Registrar). Active zone.
  - Zone ID: `34c29fb320c85246d499440d103d2dde`
  - Name servers: `cruz.ns.cloudflare.com`, `huxley.ns.cloudflare.com`
- **Email Routing**: enabled, subaddressing on, catch-all `*@kontext.haus` → Worker `buena-ingest`. MX/SPF/DKIM all live.
- **R2 bucket**: `buena-raw` (raw .eml + attachments + bulk uploads).
- **Queue**: `buena-extract` (queue_id `964ea057236842e6b99a7b4e12ae65c6`). Producer wired. HTTP-pull consumer enabled for testing. The repo now also includes a worker consumer in `wrangler.toml` plus `queue()` handling in `workers/ingest/src/email.ts`; re-check deployed Cloudflare state before relying on it.
- **Worker `buena-ingest`** deployed at `https://buena-ingest.isiklimahir.workers.dev`.
  - HTTP routes: `GET /health`, `POST /upload?name=<filename>` (bulk-import path).
  - `email()` handler parses MIME via `postal-mime`, drops .eml + attachments to R2, enqueues structured job to `buena-extract` with `{source, msgId, from, to, subject, attachmentKeys}`.
  - Subaddress is preserved in `to` (e.g. `property+LIE-001@kontext.haus`) — the routing layer should use `+TAG` as a property hint to skip routing inference.
  - Source: `workers/ingest/`.
- **End-to-end verified 2026-04-25**: real Gmail → kontext.haus → worker → R2 (.eml + PDF attachment) → queue (job with attachmentKeys). Tested with two emails, one with a PDF attachment from `partner-files/rechnungen/`.
- **Account**: `isiklimahir@gmail.com`, account id `564b8125cf83c4aa38cf87f61f2ac14c`. Workers Paid ($5/mo) active.
- **Sending test emails autonomously**: use `gog` CLI (Gmail OAuth, already authed). Binary at `/opt/homebrew/Cellar/gogcli/0.11.0/bin/gog`. Example: `gog -a isiklimahir@gmail.com send --to property+LIE-001@kontext.haus --subject ... --body ... [--attach path.pdf]`.

### Gmail / GOG smoke-test recipes (preferred over synthetic injection)
Use Mahir's real Gmail path for end-to-end verification whenever possible. This proves the full chain, Gmail -> Cloudflare Email Routing -> Worker -> Queue -> Gemini -> gate -> pending/history/property.md.

#### Unit-scoped test
```bash
gog -a isiklimahir@gmail.com send \
  --to "property+LIE-001@kontext.haus" \
  --subject "WE 29 Mietminderung wegen Heisswasser" \
  --body "Hallo, in WE 29 besteht weiterhin ein Heisswasser-Defekt. Der Bewohner mindert deshalb seit dem 15.01.2026 die Miete um 10 Prozent. Bitte als offene Angelegenheit erfassen."
```
Expected outcome: auto-applied `Open issues` lines scoped to `EH-029`, and the rendered markdown line should visibly include `EH-029:`.

#### Building-scoped test
```bash
gog -a isiklimahir@gmail.com send \
  --to "property+LIE-001@kontext.haus" \
  --subject "HAUS-12 Aufzug Reparaturtermin bestaetigt" \
  --body "Hallo, der Aufzug in HAUS-12 ist weiterhin defekt. Die Reparatur ist fuer den 28.04.2026 terminiert. Bitte als gebaeudeweite offene Angelegenheit aufnehmen."
```
Expected outcome: building-level `Open issues` entry for `HAUS-12`, usually auto-applied.

#### Provider-scoped test
```bash
gog -a isiklimahir@gmail.com send \
  --to "property+LIE-001@kontext.haus" \
  --subject "DL-002 Aufzugswartung bestaetigt" \
  --body "Hallo, DL-002 fuehrt die Aufzugswartung fuer 185 EUR pro Monat durch. Bitte den Dienstleistereintrag entsprechend ergaenzen."
```
Expected outcome: provider-scoped item for `DL-002`. Depending on current file state, this may stay pending as a conflict instead of auto-applying.

#### Attachment test
```bash
gog -a isiklimahir@gmail.com send \
  --to "property+LIE-001@kontext.haus" \
  --subject "Attachment only test" \
  --body "Bitte siehe Anhang." \
  --attach /path/to/file.txt
```
Expected outcome: the attachment content is extracted through the stored-document path, not only the email body.

#### What to check after sending
- `GET /vaults/LIE-001/pending` for queued review items
- `GET /vaults/LIE-001/history` for `auto` vs `approved` vs `rejected`
- `GET /vaults/LIE-001/property.md` for actual rendered markdown changes
- In Obsidian, use the plugin sync button, which now does a full mirror sync of remote `property.md` + `state.json`, then refreshes the sidebar queue from the current remote pending list

#### Important note
When verifying scope behavior, remember that not every fact should have a unit. Valid scopes are unit (`EH-XXX`), building (`HAUS-XX`), and provider (`DL-XXX`). The pending UI should show the correct scope pill instead of implying everything is a unit issue.

### Tokens in Keychain (never commit token values, references only)
| Service name | Scope | Use for |
|---|---|---|
| `cloudflare-buena-token` | Includes Email Routing on `kontext.haus`. Account-scoped (no `User: Memberships`, so `/user/tokens/verify` returns Invalid, but real API calls succeed). | **Buena hackathon work.** Use this one. |
| `cloudflare-api-token` | Mahir's general Workers/Pages/R2/D1/DNS token. **Lacks Email Routing.** | Other personal projects, not this repo. |
| `cloudflare-account-id` | `564b8125cf83c4aa38cf87f61f2ac14c` | Wrangler env var. |
| `cloudflare-browser-rendering-token` | For the Browser Rendering binding on the cf-browser-worker project. | Not needed here. |

Retrieve via `security find-generic-password -s cloudflare-buena-token -w`. Wrangler invocations should look like:
```bash
CLOUDFLARE_API_TOKEN=$(security find-generic-password -s cloudflare-buena-token -w) \
CLOUDFLARE_ACCOUNT_ID=$(security find-generic-password -s cloudflare-account-id -w) \
wrangler <command>
```

### Cloudflare MCP server (Code Mode) via MCPorter — prefer this over wrangler
MCPorter exposes the official Cloudflare MCP at `https://mcp.cloudflare.com/mcp` as `cloudflare-api` (config in `~/.mcporter/mcporter.json`). This gives the agent the **full Cloudflare API** (2,500+ endpoints, 130+ products) through just two tools, instead of being limited to the ~20 things wrangler covers. **Default to this when you need to inspect or change Cloudflare state**, fall back to wrangler only for `pages dev`, D1 migrations, and `wrangler tail`.

Call it from a shell:
```bash
mcporter call cloudflare-api.search code='async () => { /* JS over the OpenAPI spec object */ }'
mcporter call cloudflare-api.execute code='async () => { return cloudflare.request({ method: "GET", path: `/zones` }); }'
```
- `accountId` is auto-injected into the `execute` sandbox.
- `cloudflare.request({ method, path, query, body })` returns the parsed Cloudflare response.
- Use this for things wrangler can't do: analytics, security insights, WAF rules, audit logs, Email Routing rules, bulk parallel calls, account-wide inventories.

**Token caveat:** The MCP currently authenticates with `cloudflare-api-token`, which lacks Email Routing scope. For Email Routing changes either (a) shell with the buena token directly via `curl -H "Authorization: Bearer $(security find-generic-password -s cloudflare-buena-token -w)" ...`, or (b) swap the MCP config to use `cloudflare-buena-token` when we start Phase 3.

### When we resume Phase 3 (ingest)
1. Build the local extractor + patch gate against `partner-files/`.
2. Wire it as the **queue consumer** for `buena-extract` (replace HTTP-pull with a worker consumer in `wrangler.toml`).
3. Create a second R2 bucket `buena-vaults/` (rendered property.md + state.json + history) when the renderer lands.
4. Add a Pages project for the bulk-import page later, point a subdomain on `kontext.haus` at it.

---

## Operational rules for the agent

- **No em dashes** in human-facing text. Use commas, periods, semicolons, colons.
- **Python**: always `uv pip install` and `uv run python ...`.
- **API keys**: check macOS Keychain first via `security find-generic-password -s "<service>" -w`. `gemini-api-key` is in Keychain and added to `.env.local` as `GEMINI_API_KEY`.
- **Long-running processes**: use tmux, never `&` or `nohup`.
- **Tailing the Cloudflare Worker**: always run `./scripts/tail-worker.sh [worker-name]` via the `process` tool. The script wraps `wrangler tail` with a 20s heartbeat so the pi process harness doesn't reap it during silent periods. Don't call `wrangler tail` directly.
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
