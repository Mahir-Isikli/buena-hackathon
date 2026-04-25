# AGENTS.md, Buena Context Engine

A briefing for any coding agent working in this repo. We're competing in the **Buena track** at Big Berlin Hack 2026, building "CLAUDE.md for buildings", a self-updating context engine for property management.

Read this file first, every session.

---

## TL;DR

| | |
|---|---|
| **Track** | Buena, the Context Engine |
| **Track prize** | €2,500 cash, plus path to €10K finalist prize |
| **Submission deadline** | Sunday 14:00 |
| **Required submission** | 2 min Loom, public GitHub repo with README |
| **Partner techs (3 required)** | Gemini, Tavily, Pioneer/GLiNER2. Plus Entire and Aikido as side challenges. |
| **Team** | Mahir (AI/product), Anwar (automation), Yasin (design) |
| **Surface** | Cloudflare Workers backend, Obsidian vault as the human-facing output, no iOS, no web upload UI for v1 |
| **Demo property** | WEG Immanuelkirchstraße 26, 10405 Berlin (the dataset Buena gave us) |
| **Storyline** | Homeowner onboarding: a homeowner forwards their old property manager's archive, the engine produces a clean Obsidian vault per property, then keeps it surgically up to date as new emails arrive. |

> **Partner-tech risk**: we are at exactly 3 required techs. If one fails to integrate, we miss the bar. Gradium is the natural fallback (transcribing voicemails or PDFs) if we need a buffer.

---

## Mission

Build an engine that produces a single **Context Markdown file per property**, living, self-updating, traced to its source, surgically patched without destroying human edits.

Buena framing: *"CLAUDE.md, but for a building, plus it writes itself."*

Ingestion is **email-first**. PDFs, scanned paper, JSON, v-files arrive as attachments. The engine extracts, resolves identity across systems, and patches the right markdown file in place. Output lives in an Obsidian vault, since the Buena team are heavy Obsidian users (confirmed in the PM interview).

---

## Ground truth (from the PM interview)

See `partner-files/product-interview/pm-interview.md` for the verbatim Q&A. Headlines:

- **Don't reprocess on every input.** A single new email should pull context only from itself plus the resolved property, never from the global archive.
- **Inputs are mostly PDF**, sometimes scanned paper, sometimes JSON or v-files. Always arrives via email.
- **Heavy Obsidian users.** Markdown is the format. Output natively to a vault.
- **False positives are the worst possible outcome.** Precision over recall on every patch. Route ambiguous cases to a human review queue.
- **95% of inbound is relevant.** Filter is light, not aggressive.
- **Triggers**: email arrives, bank transaction lands.
- **No PII restrictions** for the demo, no preferred location in their stack.

---

## Three explicit hard problems from Buena's brief

1. **Schema alignment.** "Owner" is called *Eigentümer*, *MietEig*, *Kontakt*, or *owner* depending on the source system. Same person, different keys. The engine must resolve identity across ERPs.
2. **Surgical updates.** When a new email arrives, you can't regenerate the whole file. That destroys human edits and burns tokens. Patch the right section only.
3. **Signal vs. noise.** Even at 95% relevance, the engine still has to judge what belongs and what doesn't.

---

## About Buena (sponsor context, critical for the pitch)

Berlin-based PropTech. Series A €49.4M (mid-2025), led by GV (Google Ventures) with 20VC, Stride, Capnamic. CEO Din Bisevac (26). Co-founder Moritz von Hase. Around 30-person HQ team.

Full-stack AI-driven residential property management for the German market. 60,000+ units under management. Roughly 5,000-landlord waitlist. Revenue grew 500% in 2024.

Their original strategy was **AI-led M&A rollup** of small German PMs (20+ acquisitions, roughly 2 per month), each migrated onto Buena's platform. They've since pivoted toward **home ownership onboarding**. The PM told us either angle is fine for the demo.

Their stated philosophy is "AI enhances, doesn't replace" property managers. Keep humans in the loop in the design (review queue for ambiguous patches).

---

## Why we have an edge

- **Domain expertise.** Mahir is a full-time AI Product Engineer at Arbio (AI-driven holiday rental management). He has been building Nexus, Arbio's AI ops platform with voice agents, document processing, chat UI, for 6 weeks. Most other teams in this track are reading about property management for the first time today.
- **Real metrics access.** Mahir has a colleague (Lenos) who can describe Arbio's actual property-onboarding schema and KPIs (e.g. 2-week integration target).
- **Real dataset from Buena.** They handed us a complete simulated archive: stammdaten (1 property, 3 buildings, 52 units, 50 owners, 50+ tenants, 9+ service providers), 6,546 emails, 135 letters, 194 invoices, full bank statements, plus 10 days of incremental updates. See `partner-files/`.

---

## Architecture

```
                ┌─────────────────────────────────────┐
                │   EMAIL INGESTION                   │
                │   Cloudflare Email Worker route     │
                │   Attachments to R2                  │
                └────────────────┬────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────┐
                │   EXTRACTION                        │
                │   • Gemini 2.5 Pro vision (PDFs)    │
                │   • Gemini Flash for plain text     │
                │   • GLiNER2 for structured fields   │
                └────────────────┬────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────┐
                │   ROUTING (intent SLM, Pioneer)     │
                │   • Which property?                  │
                │   • Which section?                   │
                │   • Patch / ignore / escalate?       │
                └────────────────┬────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────┐
                │   IDENTITY RESOLVER                 │
                │   Cross-schema clustering           │
                │   (Eigentümer / Kontakt / owner_id) │
                └────────────────┬────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────┐
                │   SCOPED RETRIEVAL                  │
                │   Pull context only for the         │
                │   resolved property, never global    │
                └────────────────┬────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────┐
                │   SURGICAL PATCHER                  │
                │   • Section-level diff               │
                │   • Human-edit conflict guard        │
                │   • Provenance comments              │
                └────────────────┬────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────┐
                │   OBSIDIAN VAULT (R2 + sync)        │
                │   one .md per property               │
                │   frontmatter + wikilinks            │
                └─────────────────────────────────────┘

           Tavily sits to the side: lazy enrichment for
           public registries, contractor reviews, permits.
```

### Why this architecture

- **Email-first ingestion.** PM confirmed email is the real trigger. Cloudflare Email Workers route domain-bound mail straight into our pipeline.
- **No FastAPI.** Cloudflare Workers handle the webhook, run extraction, write to R2. One stack, fast, no tunnel needed for the demo.
- **Provenance is first-class.** Every fact in the .md links to its source (email message-id, PDF page, attachment hash).
- **Human edits are sacred.** The patcher detects human-edited sections via a checksum or explicit marker, routes conflicts to a review queue.
- **Scoped retrieval, not global.** PM was explicit: don't re-examine all history per email. Resolve property first, retrieve only that subtree.

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
  - <!-- src: stammdaten/stammdaten.json | conf: 1.0 -->

## Bank
- WEG-Konto: DE02 1001 0010 0123 4567 89 (Postbank Berlin)
- Rücklage: DE12 1203 0000 0098 7654 32

## Owners
- [[Marcus Dowerg]] (Eigentümer, EH-037, EH-032)
  - <!-- src: stammdaten/eigentuemer.csv:EIG-001 | conf: 1.0 -->

## Service providers
- Hausmeister: [[Hausmeister Mueller GmbH]] (DL-001), 650 €/Monat
- Aufzugswartung: [[Aufzug Schindler & Co. GmbH]] (DL-002), 185 €/Monat
- Heizungswartung: [[Heiztechnik Berlin GmbH]] (DL-003), 78 €/h

## Open issues
- Wartungstermin Heizung bestätigt für 06.10.2024 um 10:00
  - <!-- src: emails/2024-09/EMAIL-02443.eml | conf: 0.94 -->

## Last assembly decisions
- ETV 2024-04: see [[ETV-2024-04-Protokoll]]
```

Wikilinks make Obsidian's graph view explode into a network of properties, owners, contractors. That's the visual demo moment.

---

## Partner technology stack

We use exactly **3 required techs** plus **2 side-challenge techs**.

### 1. Google DeepMind (Gemini), primary LLM and vision

- **Gemini 2.5 Pro** for PDF vision plus reasoning over multi-page contracts and ETV protocols.
- **Gemini Flash** for relevance classification and section assignment, fast and cheap.

```python
# uv pip install google-generativeai
from google import genai

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=[email_text, "Output JSON: {property_id: str, sections: [str], confidence: float}"]
)
```

Onboarding: `goo.gle/hackathon-account` for temporary accounts.

### 2. Tavily, web research and extraction

For lazy enrichment: building permits, contractor reviews, public registry data. Pulled only when the engine wants to add an external fact, never speculatively.

Setup: 1,000 free credits per account. Fallback code `TVLY-DLEE5IJU`. Hosted MCP at `https://mcp.tavily.com/mcp/?tavilyApiKey=<key>`.

```python
from tavily import TavilyClient
client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])
results = client.search("Immanuelkirchstraße 26 Berlin Bauakte", max_results=5)
```

### 3. Pioneer / Fastino (GLiNER2), structured extraction and intent SLM

**Schema-driven extraction** for property facts (owner, contractor, issue, decision, contract). Plus an **intent SLM** that routes incoming items to {patch, ignore, escalate, contractor-update, owner-change, ...}.

Pioneer fine-tune is now trivial: the dataset's `*_index.csv` files have categories like `eigentuemer/rechtlich`, `mieter/kaution`, `versorger/versorger` already labelled. Use those as supervised training data.

Targets the **Pioneer side challenge** (€700) at the same time.

```python
# uv pip install gliner2
from gliner2 import GLiNER2

extractor = GLiNER2.from_pretrained("fastino/gliner2-base-v1")
schema = (extractor.create_schema()
    .structure("property_fact")
        .field("property_id", dtype="str")
        .field("fact_type", dtype="str", labels=["owner", "contractor", "issue", "decision", "contract"])
        .field("entity_name", dtype="str")
        .field("contact", dtype="str")
        .field("amount", dtype="float", optional=True)
)
results = extractor.extract(email_text, schema)
```

### Side challenges

- **Entire** (`entire enable --agent claude-code`). Free, captures Claude Code sessions per commit. Targets $1,000 Apple cards plus Switch 2 plus PS5 plus XBOX.
- **Aikido**. Connect repo, screenshot security report. Targets €1,000. Not eligible as one of the 3 required partner techs.

### Dropped from v1

- **Gradium / voice**: dropped. Reserved as fallback if a required partner tech doesn't pan out.
- **iOS app**: dropped.
- **Web upload UI**: dropped, email is the ingestion route.
- **FastAPI backend**: dropped, Cloudflare Workers replaces it.
- **Telli as 4th partner**: dropped.

---

## Implementation plan (24-hour build)

### Phase 1, Foundation (hours 0 to 3)
- [x] Public GitHub repo (initial commit done)
- [x] `entire enable --agent claude-code` configured
- [x] Buena dataset extracted to `partner-files/`
- [x] PM interview verbatim in `partner-files/product-interview/pm-interview.md`
- [ ] Cloudflare Worker skeleton (`workers/ingest`)
- [ ] R2 bucket for vault and attachments
- [ ] Bootstrap script: parse `stammdaten/` into one initial vault file per property

### Phase 2, Core engine (hours 3 to 12)
- [ ] **PDF extraction**: Gemini 2.5 Pro vision over `briefe/` and `rechnungen/`
- [ ] **Email parsing**: walk `emails/`, normalise headers, extract body plus attachments
- [ ] **Identity resolver**: cluster entities across stammdaten CSVs and inbound text
- [ ] **Routing SLM**: Pioneer fine-tune using `*_index.csv` category labels
- [ ] **Surgical patcher**: section-level diff with provenance comments
- [ ] **Human-edit guard**: detect and skip patches that would overwrite human edits

### Phase 3, Demo loop (hours 12 to 18)
- [ ] **Bootstrap demo**: ingest the full base archive, generate the initial vault. Show graph view in Obsidian.
- [ ] **Incremental replay**: walk `incremental/day-01` through `day-10`, replay each day's deltas live. Each day shows surgical patches landing in the vault.
- [ ] **Provenance footnotes**: every fact links back to source PDF page or email message-id, clickable from Obsidian.
- [ ] **Tavily enrichment**: one or two demo facts pulled from public sources to show the layer exists.

### Phase 4, Polish and side challenges (hours 18 to 22)
- [ ] Aikido scan, screenshot for side challenge
- [ ] Pioneer fine-tune documentation for side challenge
- [ ] README with setup instructions
- [ ] 2 min Loom recording

### Phase 5, Submission (hours 22 to 24)
- [ ] Final commit, public push
- [ ] Loom uploaded
- [ ] Submission form filled
- [ ] Side challenge submissions (Pioneer, Aikido, Entire)

---

## Demo plan, the 2-min Loom

Storyline: **homeowner onboarding**.

### 0:00 to 0:15, the hook
> *"A homeowner just bought into a Berlin WEG. Their old property manager handed over an archive: thousands of emails, scanned letters, contracts, bank statements, master data exports. Today, untangling that takes weeks. Watch this."*

Screen: a chaotic folder with mixed file types from `partner-files/`.

### 0:15 to 0:50, the bootstrap
Trigger ingestion against the full base archive. On screen:
- Files stream through the Cloudflare Worker
- Gemini extracts entities from PDFs
- Identity resolver merges duplicates
- One Obsidian vault file emerges for `WEG Immanuelkirchstraße 26`
- Cut to Obsidian: the graph view explodes with property, owners, tenants, service providers as nodes

### 0:50 to 1:30, the surgical update
Replay `incremental/day-01`. Three new items land:
- An email from the Heizungs-Versorger about a maintenance appointment
- An invoice PDF from the Hausmeister
- A bank transaction (rent payment)

Show in Obsidian:
- Each item routed by the Pioneer SLM to the right section
- Surgical patches: only the affected lines change, animated
- Provenance footnote: tap, jumps to source email or PDF
- A pre-edited human note nearby is untouched

### 1:30 to 1:50, the speed
Run days 02 through 05 in fast-forward. Vault keeps updating. No re-processing of the base archive on any new email.

### 1:50 to 2:00, the close
> *"Buena's onboarding pain solved in 24 hours, native to their Obsidian workflow. Built with Gemini, Tavily, and a Pioneer-fine-tuned router. Every fact in the vault traces back to its source."*

End on the Obsidian graph view.

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
│   │   ├── ingest.ts            # email webhook entry
│   │   ├── extract.ts           # Gemini PDF + text
│   │   ├── route.ts             # Pioneer SLM call
│   │   ├── identity.ts          # cross-schema resolver
│   │   ├── patch.ts             # surgical markdown writer
│   │   └── enrich.ts            # Tavily lookups
│   └── package.json
├── pipeline/                    # local Python helpers, fine-tune, batch bootstrap
│   ├── pyproject.toml           # uv-managed
│   ├── bootstrap.py             # one-shot full-archive ingestion
│   ├── replay_incremental.py    # walks day-01 to day-10
│   └── pioneer_finetune.py
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
        └── pm-interview.md
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
- **Don't reprocess the global archive on every email.** PM was explicit. Resolve property first, then scope retrieval to that subtree.
- **Don't patch on uncertainty.** False positives are the worst possible outcome. Route ambiguous cases to a review queue.
- **Don't propose AI replacing property managers.** Buena's stated philosophy is enhancement.

---

## Operational rules for the agent

- **No em dashes** in human-facing text. Use commas, periods, colons, or semicolons.
- **Python**: always `uv pip install` and `uv run python ...`.
- **API keys**: check macOS Keychain first via `security find-generic-password -s "<service>" -w`. `gemini-api-key` is in Keychain and added to `.env.local` as `GEMINI_API_KEY`.
- **Long-running processes**: use tmux, never `&` or `nohup`.
- **Before committing**: run `diffity --no-open` and open the URL for review.

---

## Open questions to resolve

1. **Lenos call**: get Arbio's actual onboarding doc schema as a sanity check on our output template.
2. **Cloudflare Email Worker setup**: confirm Anwar can wire the email route end-to-end before hour 6.
3. **Obsidian sync from R2**: simplest path for the demo? Local clone of R2 contents into a vault folder, or a thin watcher?
4. **Partner-tech buffer**: if any of Gemini/Tavily/Pioneer underperforms, do we add Gradium back as a fourth?
5. **Human-review surface**: minimal review queue UI, or just a flagged section inside the .md itself with `> [!warning]` callouts?

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

*Last updated Saturday, post-PM-interview, by Mahir + team. Update this file as decisions evolve.*
