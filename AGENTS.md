# AGENTS.md, Buena Context Engine

A briefing for any coding agent working in this repo. We're competing in the **Buena track** at Big Berlin Hack 2026, building "CLAUDE.md for buildings", a self-updating context engine for property management, exposed through an **iOS app**.

Read this file first, every session.

---

## TL;DR

| | |
|---|---|
| **Track** | Buena, the Context Engine |
| **Track prize** | €2,500 cash, plus path to €10K finalist prize |
| **Submission deadline** | Sunday 14:00 |
| **Required submission** | 2 min Loom, public GitHub repo with README |
| **Required partner tech** | At least 3 of: Google DeepMind, Tavily, Gradium, Lovable, Entire, Aikido, Pioneer/Fastino |
| **Team** | 3 people: Mahir (AI/product, Arbio day-job edge), Anwar (automation), Yasin (design) |
| **Surface** | Native iOS app (SwiftUI), thin Python/FastAPI backend for the engine |
| **Team edge** | Mahir works at Arbio (AI-driven holiday rental management). This challenge is his actual day-job problem framed as a hackathon prompt. |

> **Open question**: original message mentioned "Telli we already have has an e-programmer". Unclear if that means a 4th teammate, or telli the partner tech. Confirm before submission and update team count and partner tech list accordingly.

---

## Mission

Build an engine that produces a single **Context Markdown file per property**, living, self-updating, traced to its source, surgically patched without destroying human edits.

Buena framing: *"CLAUDE.md, but for a building, plus it writes itself."*

The engine ingests scattered context (Gmail, ERPs, Slack, Drive, scanned PDFs, voice walkthroughs, plus institutional knowledge) and produces a dense, structured markdown file an AI agent can act on. No more re-crawling all sources for every task.

The iOS app is the **capture and inspection surface**: walk a building, narrate context, see the .md update live with provenance.

---

## The challenge (paraphrased from Buena's brief)

Property management runs on context. Every ticket, email, and owner question requires knowing a hundred facts about one specific building: who owns it, what the last assembly decided, whether the roof leak is open, who the heating contractor is.

That context lives across ERPs, Gmail, Slack, Drive, scanned PDFs, and the head of the property manager who's been there 12 years. Today, AI agents have to crawl all of it for every task. Inefficient and lossy.

The challenge is to consolidate this into a single Context.md per property, automatically.

### Three explicit hard problems from Buena's brief

1. **Schema alignment.** "Owner" is called *Eigentümer*, *MietEig*, *Kontakt*, or *owner* depending on the source system. Same person, different keys. The engine must resolve identity across ERPs.
2. **Surgical updates.** When a new email arrives, you can't regenerate the whole file. That destroys human edits and burns tokens. Patch the right section only.
3. **Signal vs. noise.** About 90% of inbound emails are irrelevant to the property file. The engine must judge what belongs and what doesn't.

---

## About Buena (sponsor context, critical for the pitch)

**What they are**: Berlin-based PropTech, Series A €49.4M ($58M total funding, mid-2025), led by GV (Google Ventures) with 20VC, Stride, Capnamic. Founded 2016 (originally as "Home"), rebranded to Buena. CEO Din Bisevac (26). Co-founder Moritz von Hase. About 30-person HQ team.

**What they do**: Full-stack AI-driven residential property management for the German market. 60,000+ units under management. Roughly 5,000-landlord waitlist. Revenue grew 500% in 2024, 300% in 2023.

**Their strategy**: Two-pronged. (1) Build their own AI property management software. (2) **AI-led M&A rollup**, acquire small German property managers (20+ acquisitions to date, roughly 2 per month) and migrate them onto the Buena platform.

**The core pain Buena lives with daily**: 96.3% of German property managers still use pre-cloud software. When Buena acquires one, they have to ingest all that scattered, often paper-based context onto their platform. *This is exactly the challenge they wrote.*

### What this means for the pitch
- The judges are likely Buena engineers or leadership. They feel this pain weekly.
- The demo must speak to their M&A onboarding scenario directly. Phrase the demo as: *"Buena just acquired a property manager. Watch the engine ingest their stack."*
- Buena's stated philosophy is "AI enhances, doesn't replace" property managers. Keep humans in the loop in the design (review queue for ambiguous patches, etc.).
- Buena CEO Din Bisevac co-initiated Project Europe with Harry Stebbings (20VC). They care about European tech that ships.

---

## Why we have an edge

- **Domain expertise.** Mahir is a full-time AI Product Engineer at Arbio (AI-driven holiday rental management). He has been building Nexus, Arbio's AI ops platform with voice agents, document processing, chat UI, for 6 weeks. Every other team in this track is reading about property management for the first time today.
- **Real metrics access.** Mahir has a colleague (Lenos) who can describe Arbio's actual property-onboarding schema and KPIs (e.g. 2-week integration target). That is our output template.
- **Demo set close to the venue.** Mahir's apartment at Hasenheide 76 is 5 min from the venue. We can do a live property walkthrough capture as part of the demo, straight from the iOS app.

---

## Architecture

```
                  ┌──────────────────────────────────────┐
                  │  iOS APP (SwiftUI)                   │
                  │  • Voice capture (mic + AVAudioEngine)│
                  │  • Camera capture for visual context │
                  │  • Property picker / inbox viewer    │
                  │  • Live context.md viewer with diffs │
                  └──────────────┬───────────────────────┘
                                 │ HTTPS / WebSocket
                                 ▼
                ┌─────────────────────────────────────┐
                │   INGESTION LAYER (FastAPI)         │
                │   • Gmail mock                       │
                │   • Drive / PDFs                     │
                │   • Voice notes (Gradium STT)        │
                │   • Web research (Tavily)            │
                └────────────────┬────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────┐
                │   PROCESSING LAYER                  │
                │   • GLiNER2 entity extraction       │
                │   • Identity resolver (schema map)  │
                │   • Relevance classifier (Gemini)   │
                │   • Section classifier (Gemini)     │
                └────────────────┬────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────┐
                │   CONTEXT GRAPH                     │
                │   per-property store with           │
                │   provenance (source, timestamp,    │
                │   confidence)                       │
                └────────────────┬────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────┐
                │   PATCHING LAYER                    │
                │   • Section-level diff emitter      │
                │   • Human-edit conflict resolver    │
                │   • Surgical markdown writer        │
                └────────────────┬────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────┐
                │   CONTEXT.MD per property           │
                │   (the deliverable, served to iOS)  │
                └─────────────────────────────────────┘
```

### Why this architecture

- **Separation of extraction from patching.** Extraction is noisy (recall-biased). Patching is conservative (precision-biased). Different models, different rules.
- **Provenance is first-class.** Every fact in the .md links to its source (email message-id, PDF page, transcript timestamp). This is what wins judges.
- **Human edits are sacred.** The patcher detects human-edited sections and routes conflicts to a review queue instead of overwriting. Buena's "AI enhances, doesn't replace" philosophy lives here.
- **iOS as capture surface.** The phone is the natural input device for property walkthroughs (voice, photo, location). It is also a polished demo artifact in its own right.

### Concrete .md structure (per property)

```markdown
# Hasenheide 76, 10967 Berlin

## Identity
- **Address**: Hasenheide 76, 10967 Berlin (Kreuzberg)
- **Building ID**: HAS076
- **Units**: 12 apartments, 1 commercial
- **Owner association (WEG)**: HAS076-WEG
  - <!-- src: contracts/2019-WEG-protocol.pdf, p.1 | conf: 0.94 -->

## Owners
- Hans Müller (Eigentümer / Kontakt: hans.mueller@email.de)
  - Apt 4B, owned since 2018
  - <!-- src: erp.buena/owners/4831, gmail/thread/abc123 | conf: 0.91 -->

## Open issues
- Roof leak (apt 7C, reported 2026-04-12)
  - Contractor: Dachdecker Schmidt GmbH (+49 30 555 0123)
  - <!-- src: gmail/thread/xyz789 | last_updated: 2026-04-23 -->

## Contractors
- Heating: Heizungsbau Berlin GmbH, +49 30 ...
- Roofing: Dachdecker Schmidt GmbH, +49 30 555 0123
- ...

## Last assembly decisions
- 2025-11-15: Approved €18K budget for facade repainting
  - <!-- src: contracts/2025-11-WEG-minutes.pdf | conf: 0.97 -->
```

The `<!-- src: ... -->` comments are provenance. The patcher uses them to find the right section to update.

---

## Partner technology stack (confirmed picks in bold)

We aim for at least 3 partner techs. Current confirmed picks:

1. **Google DeepMind (Gemini)**, primary LLM and vision
2. **Gradium**, speech-to-text for the iOS walkthrough capture
3. **Tavily**, fast web research and extraction API
4. **Pioneer / Fastino (GLiNER2)**, schema-driven extraction, possibly fine-tuned for intent classification

Plus opportunistic:

5. **Entire**, agent context capture, essentially free side challenge
6. **Aikido**, security scan side challenge

### 1. Google DeepMind (Gemini), primary LLM, multimodal

Frontier multimodal. Use for:
- Reasoning over emails to classify relevance and assign sections
- Vision on scanned PDFs and photos
- Generating the surgical patches

**Onboarding**: Temporary accounts on-site at the hackathon. Check `goo.gle/hackathon-account` for setup.

**Recommended models**: Gemini 2.5 Pro for reasoning, Gemini Flash for fast classification.

```python
# uv pip install google-generativeai
from google import genai

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=[email_text, "Is this relevant to property HAS076? Output JSON: {relevant: bool, sections: [...], confidence: float}"]
)
```

### 2. Gradium, voice for the iOS capture interface

The walkthrough demo is the wow moment: walk through Mahir's apartment with iPhone, voice gets transcribed in real-time on-device or via streaming, becomes new context entries.

Gradium has native German support and integrates with LiveKit. Latency is sub-300 ms.

For iOS specifically, options to evaluate at hour 0:
- **Server-streamed**: iOS streams mic audio to our FastAPI backend, backend pipes to Gradium STT, returns transcript chunks via WebSocket. Simpler, less iOS code.
- **Direct from device**: only if Gradium has an iOS SDK or a stable WebRTC ingestion path. Lower latency, more iOS code.

Default plan: server-streamed via WebSocket.

```bash
uv pip install "livekit-plugins-gradium[stt,tts]"
export GRADIUM_API_KEY=...
export LIVEKIT_URL=wss://your-project.livekit.cloud
```

```python
from livekit.agents import AgentSession
from livekit.plugins import gradium

session = AgentSession(
    stt=gradium.STT(language="de"),
    llm=gemini.LLM(model="gemini-2.5-flash"),
)
# Audio in -> transcript -> fact extractor -> context.md patch
```

If voice walkthrough is descoped, Gradium STT can still be used to ingest voicemails left by tenants/contractors. Either way it earns its slot in the partner tech requirement.

### 3. Tavily, web research and extraction

For enriching the .md with public-source facts (building permits, zoning, public registry data, contractor reviews).

**Setup**: 1,000 free credits per account. Fallback code from manual: `TVLY-DLEE5IJU`. There is also a hosted MCP server at `https://mcp.tavily.com/mcp/?tavilyApiKey=<key>`.

```python
# uv pip install tavily-python
from tavily import TavilyClient

client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])

# Search
results = client.search("Hasenheide 76 Berlin building permit", max_results=5)

# Extract from a known URL
extracted = client.extract("https://www.berlin.de/...")
```

### 4. Pioneer / Fastino (GLiNER2), schema-driven extraction and intent SLM

**This is the schema-alignment workhorse.** GLiNER2 is a 205M to 1B parameter model that does NER plus classification plus structured data extraction in one schema-driven prompt. CPU-friendly, no GPU needed. Pioneer fine-tunes it.

**Side challenge**: best use of Pioneer wins €700 (Mac Mini cash value). Worth pursuing.

Two concrete uses for us:
- **Schema-driven extraction**: pull `property_fact` records from incoming emails and PDFs.
- **Intent classification SLM** (Mahir's plan): tiny model that routes incoming items to {patch, ignore, escalate, contractor-update, owner-change, ...}. Fine-tune via Pioneer in around 6 hours from synthetic data.

```python
# uv pip install gliner2
from gliner2 import GLiNER2

extractor = GLiNER2.from_pretrained("fastino/gliner2-base-v1")

schema = (extractor.create_schema()
    .structure("property_fact")
        .field("property_id", dtype="str")
        .field("fact_type", dtype="str", labels=["owner", "contractor", "issue", "decision", "contract"])
        .field("entity_name", dtype="str")
        .field("entity_role", dtype="str")
        .field("contact", dtype="str")
        .field("amount", dtype="float", optional=True)
        .field("date", dtype="str", optional=True)
)

email = "Hi, I'm Hans Müller, owner of apt 4B at Hasenheide 76..."
results = extractor.extract(email, schema)
```

For identity resolution, also use GLiNER2's classification head:

```python
# Resolve "Eigentümer Müller" / "Kontakt: hans.m@..." / "owner_id: 4831" to the same person
resolution_schema = extractor.create_schema().classify("same_person", labels=["yes", "no", "uncertain"])
```

The bigger model (`gliner2-large-v1`, 340M) supports descriptions for higher precision, useful for nuanced property terminology.

To fine-tune via Pioneer: get an API key at `gliner.pioneer.ai`, define task in natural language, Pioneer handles synthetic data plus training in roughly 6 hours.

### 5. Entire, agent context capture (essentially free)

Entire is a CLI that hooks into Git and captures every Claude Code agent session as a checkpoint alongside the commit. Open source, $60M seed.

**Why this is essentially free for us**: we are using Claude Code anyway. Just running `entire enable --agent claude-code` adds Entire as a partner tech with zero engineering cost.

**Side challenge**: best use of Entire wins **$1,000 in Apple gift cards plus Switch 2 plus PS5 plus XBOX**. The narrative writes itself: *"we used Entire to capture how Claude Code built a context engine, a context engine for context engines."*

```bash
curl -fsSL https://entire.io/install.sh | bash
cd buena-hackathon
entire enable --agent claude-code
# That's it. Every commit now has full agent context attached.
```

### 6. Aikido, security scan side challenge

Free Pro trial during the hackathon. Connect the GitHub repo, screenshot the security report, submit. **Side challenge prize: €1,000 cash.** Cheap to add, around 15 min of work.

NB from manual: Aikido is **not eligible as one of the 3 required partner techs**. Pure side-challenge upside.

---

## iOS app design notes (Yasin owns)

- **SwiftUI**, iOS 17+, no UIKit unless a specific component forces it.
- **Tabs**: Properties (list), Property Detail (.md viewer with diff highlights), Capture (mic + camera), Inbox (email-style stream of incoming items being processed live).
- **Capture screen**: big mic button. Hold to talk, release to send. Show streaming transcript in real time (from Gradium via our WebSocket). After release, show the resulting patch preview before commit.
- **Property detail**: render markdown with provenance comments turned into tappable footnotes. Tap a footnote to see the source email or PDF page.
- **Diff visualisation**: when a new patch lands while viewing a property, animate the changed lines (yellow flash, then settle). This is the demo money shot.
- **Backend**: configurable base URL in Settings, default to ngrok or similar tunnel during dev so judges can use the app live if needed.

---

## Implementation plan (24-hour build)

### Phase 1, Foundation (hours 0 to 4)
- [ ] Public GitHub repo created
- [ ] `entire enable --agent claude-code` configured
- [ ] FastAPI backend skeleton (`backend/`)
- [ ] iOS app skeleton (`ios/`), SwiftUI, Xcode project committed
- [ ] `uv` for Python deps (Mahir's preference)
- [ ] Mock data folder with realistic German PM data:
  - 30+ emails (owner queries, contractor invoices, tenant complaints, M&A handover)
  - 5+ scanned PDF contracts
  - 2+ ERP-style CSV exports with conflicting field names (`Eigentümer` vs `owner`)
- [ ] One real demo property: `examples/hasenheide-76/` with seed `context.md`
- [ ] Tunnel set up (ngrok or cloudflared) so iOS device can hit local backend

### Phase 2, Core engine (hours 4 to 12)
- [ ] **Extraction**: GLiNER2 with property-management schema
- [ ] **Identity resolver**: clusters entities across ERPs
- [ ] **Relevance classifier**: Gemini Flash, returns `{property_id, sections[], confidence}`
- [ ] **Section classifier**: maps facts to .md sections (Owners, Contractors, Open issues, Decisions, etc.)
- [ ] **Surgical patcher**: section-level diff, never regenerates whole file
- [ ] **Provenance**: every fact gets a `<!-- src: ... | conf: ... -->` comment
- [ ] **WebSocket endpoint**: stream patches to iOS

### Phase 3, iOS surface (hours 12 to 18)
- [ ] Property list and detail screens
- [ ] Markdown viewer with provenance footnotes
- [ ] Mic capture + Gradium STT streaming
- [ ] Live diff animation on incoming patches
- [ ] **The M&A drop**: dev-only screen that triggers ingestion of a portfolio of buildings at once, emits one .md per property
- [ ] **The Hasenheide walkthrough** (stretch): walk through the apartment narrating, .md updates live with timestamps and provenance

### Phase 4, Polish and side challenges (hours 18 to 22)
- [ ] Aikido scan, screenshot for side challenge submission
- [ ] Pioneer fine-tune of GLiNER2 on synthetic property data (intent SLM, side challenge)
- [ ] README with full setup instructions for both backend and iOS
- [ ] 2 min Loom recording (script below)

### Phase 5, Submission (hours 22 to 24)
- [ ] Final commit, public push
- [ ] Loom uploaded
- [ ] Submission form filled
- [ ] Side challenge submissions (Pioneer, Aikido, Entire)

---

## Demo plan, the 2-min Loom

Aim: judges feel Buena's M&A pain in the first 15 seconds, see surgical patching by 1 minute, and remember the wow at 1:45.

### 0:00 to 0:15, the hook
> *"Buena just acquired a property manager. 14 buildings, 200 units. Their data is in Outlook PST files, scanned PDFs, and Frau Schmidt's head. Today, that takes 2 weeks to onboard. We just built it in 24 hours."*

Screen: a chaotic folder with mixed file types. Logo of fictional acquired firm.

### 0:15 to 0:50, the engine
Drop the folder onto a backend dev tool. Watch on the iOS app:
- Files stream in to the inbox tab
- GLiNER2 entities highlighted live
- Identity resolver merges duplicates ("Eigentümer Müller" plus "owner: hans.m" highlighted as same)
- One `Context.md` per building emerges in real time on the property list

### 0:50 to 1:20, the surgical update
A new email arrives mid-demo: roof contractor changes phone number. Show on iOS:
- Email classified as relevant (Hasenheide 76)
- Section classifier picks "Contractors, Roofing"
- Surgical patch: only that one line changes, animated yellow flash
- Tap the footnote: jumps to the source email
- Human-edited section nearby: untouched

### 1:20 to 1:45, the wow
Cut to phone-camera POV walking into the Hasenheide apartment, app open in capture mode.
- "Heating valve in living room is dripping" (voice into the iPhone)
- New entry appears in `Context.md` under "Open issues" with timestamp and provenance back to the audio clip

### 1:45 to 2:00, the close
> *"This is Buena's onboarding pain solved in 24 hours. CLAUDE.md for buildings, plus it writes itself. Built with Gemini, Tavily, GLiNER2, Gradium, and Entire, and we used Entire to capture how Claude Code built it. Context engine, all the way down."*

End on the polished Context.md inside the iOS app.

---

## Suggested file structure

```
buena-hackathon/
├── AGENTS.md                    # this file
├── README.md                    # public README (setup, install, partner tech list)
├── docs/
│   ├── architecture.md
│   ├── demo-script.md
│   ├── partner-tech-integration.md
│   └── pioneer-finetune-notes.md
├── backend/
│   ├── pyproject.toml          # uv-managed
│   ├── ingestion/
│   │   ├── gmail_mock.py
│   │   ├── pdf_parser.py
│   │   ├── voice.py            # Gradium STT
│   │   └── web_research.py     # Tavily
│   ├── processing/
│   │   ├── extraction.py       # GLiNER2
│   │   ├── identity.py         # cross-schema resolver
│   │   ├── relevance.py        # Gemini classifier
│   │   └── sections.py         # section classifier
│   ├── patching/
│   │   ├── differ.py
│   │   ├── conflict.py         # human-edit detector
│   │   └── writer.py
│   ├── graph/
│   │   └── store.py            # context graph w/ provenance
│   └── api/
│       └── main.py             # FastAPI + WebSocket
├── ios/
│   └── BuenaContext.xcodeproj  # SwiftUI app
├── data/
│   ├── mock-emails/
│   ├── mock-pdfs/
│   ├── mock-erp-exports/
│   └── synthetic-finetune/     # for Pioneer
└── examples/
    └── hasenheide-76/
        └── context.md          # the live demo property
```

---

## Submission checklist (Sunday 14:00 hard deadline)

- [ ] **2-min Loom video demo** (key features plus live walkthrough)
- [ ] **Public GitHub repo** with:
  - [ ] Comprehensive README (backend setup, iOS build instructions)
  - [ ] Documentation of all APIs, frameworks, tools used
  - [ ] Sufficient technical docs for jury evaluation
- [ ] At least **3 partner techs** used and confirmed
- [ ] Project newly created at this hackathon (boilerplates allowed)
- [ ] Submitted via the project submission form

### Side challenge submissions (extra prizes)
- [ ] **Pioneer**: confirm Pioneer use, document creative GLiNER2 use case, €700
- [ ] **Aikido**: connect repo, screenshot security report, €1,000
- [ ] **Entire**: confirm use, document the meta-narrative, $1K Apple cards plus Switch 2 plus PS5 plus XBOX

---

## Important hackathon facts

- **Location**: Donaustraße 44, 12043 Berlin
- **Hosts**: The Delta Campus and Code University of Applied Sciences
- **Discord**: https://discord.gg/brSqTjJVdh (main support channel)
- **Legal office hours**: PXR, 2pm to 4pm, sign up via the office-hours form (might be useful for an open-source license question)
- **Lunch and dinner**: provided
- **Team size**: max 5

### Agenda
- **Saturday**: 10:00 doors open, 10:30 opening, 12:30 lunch, 18:30 dinner
- **Sunday**: 12:30 lunch, **14:00 submission deadline**, 15:00 finalists announced, 15:15 finalist pitches, 16:30 award ceremony

### Finalist stage
- 8 finalist teams (1 per track)
- 5 minute live pitch
- Top 3 finalists win cash plus credits
- **1st place: €10K cash** plus 5K Gemini credits plus 10K Tavily credits plus 900K Gradium credits plus Pioneer Pro

---

## Anti-patterns to avoid

- **Don't regenerate the whole .md.** Surgical patches only. Buena explicitly calls this out.
- **Don't ignore provenance.** Every fact must trace to a source. This is what wins.
- **Don't let the demo become a generic LLM chatbot demo.** The .md file IS the product. Show it changing live, on the phone.
- **Don't over-build the iOS app.** A clean, fast, polished list plus detail plus capture flow beats a flashy one. Spend should go into engine quality and the demo moment.
- **Don't use Ray-Bans.** (Earlier discussion: too fragile a hardware dependency. iPhone plus AirPods only.)
- **Don't propose AI replacing property managers.** Buena's stated philosophy is enhancement, not replacement. Keep humans in the loop (review queue for ambiguous patches).

---

## Operational rules for the agent

- **No em dashes** in any human-facing text (per global CLAUDE.md). Use commas, periods, colons, or semicolons.
- **Python**: always `uv pip install` and `uv run python ...`, never bare `pip` or `python`.
- **API keys**: check macOS Keychain first via `security find-generic-password -s "<service>" -w` before asking. The `gemini-api-key` is already in Keychain and added to `.env.local` as `GEMINI_API_KEY`.
- **Long-running processes**: use tmux per the project CLAUDE.md, never `&` or `nohup`.
- **Before committing**: run `diffity --no-open` and open the URL for review.

---

## Open questions to resolve before serious building starts

1. **Lenos call**: get Arbio's actual onboarding doc schema. Use as our output template.
2. **M&A demo data**: real public registry data for a Berlin building, or fully synthesised? Probably synthesised to avoid data issues.
3. **Telli ambiguity**: confirm whether Telli is a 4th teammate, the partner tech telli, or a misheard reference. Update team and partner tech accordingly.
4. **iOS walkthrough**: ship as part of v1 or descope to "v2 future" mention in pitch? Decide at hour 12.
5. **Backend host**: local with ngrok tunnel for the demo, or quick Fly.io / Render deploy? Default to ngrok unless wifi at venue is shaky.

---

## Appendix, relevant references

- Buena: https://www.buena.com/en
- Buena Series A coverage (GV-led, mid-2025): https://www.gv.com/news/buena-property-management
- Buena CEO context: https://www.eu-startups.com/2025/07/berlin-based-buena-raises-e49-million-to-digitise-property-management/
- Tavily docs: https://docs.tavily.com
- Tavily MCP: https://github.com/tavily-ai/tavily-mcp
- GLiNER2 (Fastino): https://github.com/fastino-ai/GLiNER2
- Pioneer launch: https://fastino.ai/docs/overview
- Gradium docs: https://docs.gradium.ai
- Gradium plus LiveKit guide: https://gradium.ai/content/how-to-build-voice-ai-agent-gradium-livekit
- Entire CLI: https://github.com/entireio/cli
- Entire blog (vision): https://entire.io/blog/hello-entire-world
- Big Berlin Hack project submission form: https://forms.techeurope.io/bbh/content-challenge

---

*Last updated Saturday by Mahir, Anwar, Yasin. Update this file as decisions evolve.*
