# Buena Context Engine

**CLAUDE.md, but for buildings.**

A self-updating Obsidian vault for German property managers. Forward an email, the right facts land in the right property file with provenance. Contradictions queue for human review. Built for [Buena](https://www.buena.com/en) at Big Berlin Hack 2026.

[Architecture](#architecture) · [Try it](#try-it)

---

## Why

A Berlin property manager gets hundreds of emails a week. Each one: read it, decide which property, which unit, which owner, open the right file, type the update, file the original. The PM is the lookup table.

We rebuilt the lookup table.

- **3 weeks → 4 minutes**, to onboard a homeowner's archive.
- **5 to 15 minutes → 10 seconds**, to file a single email update.
- **100% manual → 93.7% deterministic**, identity resolution on inbound mail.

The 93.7% was verified against Buena's stammdaten by joining sender or recipient email against `eigentuemer`, `mieter`, and `dienstleister`. The remaining 6.3% routes to a human queue. The engine never overwrites without permission.

---

## What it does

1. **Ingest.** Forward a property email to `property+LIE-001@kontext.haus`, or drop an archive into the bulk-import page.
2. **Extract and route.** Gemini 3.1 Pro (high thinking) reads the email and any attachments, names the facts, and routes them to a property, building, unit, or service provider.
3. **Resolve.** A deterministic email-to-ID join against `stammdaten` resolves the sender or recipient to an ERP identity. Misses go to the human queue.
4. **Patch.** Empty section plus new fact lands clean. Existing fact plus contradicting fact pauses for human review with a side-by-side diff. Confidence threshold and human-edit detection guard the rest.
5. **Review.** The Obsidian plugin renders pending items in a sidebar queue. Approve, reject with a reason, or edit. Every change writes to an immutable history log.

The property markdown stays human-readable at all times. ERP-owned facts (tenant names, rent, addresses) live in Buena's database and are referenced by ID. The `.md` file holds tribal knowledge that has no table.

---

## Architecture

```
   Email             Bulk upload
     │                   │
     ▼                   ▼
 ┌──────────────────────────────┐
 │  Cloudflare buena-ingest     │   Email Routing → Worker → R2 → Queue
 └──────────────┬───────────────┘
                ▼
 ┌──────────────────────────────┐
 │  Gemini 3.1 Pro              │   PDF, text, vision, classification, routing.
 │  high thinking, no fallbacks │
 └──────────────┬───────────────┘
                ▼
 ┌──────────────────────────────┐
 │  Identity resolver           │   email → ERP ID via stammdaten join.
 │  + ERP lookup adapter        │   CSV today, Postgres later, same interface.
 └──────────────┬───────────────┘
                ▼
 ┌──────────────────────────────┐
 │  Patch gate                  │   auto-apply, ignore, or route to review.
 └──────────────┬───────────────┘
                ▼
 ┌──────────────────────────────┐
 │  R2 vault store              │   property.md, state.json, history/, attachments/
 └──────────────┬───────────────┘
                ▼
 ┌──────────────────────────────┐
 │  Obsidian plugin             │   Sidebar queue, hover provenance,
 │  (SSE live patches)          │   status bar, history pane.
 └──────────────────────────────┘
```

Tavily sits to the side for lazy enrichment of public registries, contractor reviews, permits. Pulled only when the engine wants an external fact.

---

## Stack

| Tech               | Role                                                                                                            |
| :---               | :---                                                                                                            |
| **Gemini 3.1 Pro** | Single model for all extraction, routing, and classification. High thinking on, no fallbacks, no downgrade.    |
| **Cloudflare**     | Email Routing for inbound MX, Worker for ingestion, R2 for raw and vault storage, Queue for extraction jobs.   |
| **Tavily**         | Lazy enrichment. Fires once per genuinely new service provider, lands a one-line summary plus source URL in `## External context` with `actor: tavily`. |

---

## Try it

### Send a real email

From any email client, send a message to **`property+LIE-001@kontext.haus`**. The engine routes it through Cloudflare Email Routing, extracts facts with Gemini, and patches the demo vault.

Try something like:

- **Subject**: `WE 29 Mietminderung wegen Heisswasser`
- **Body**: `In WE 29 mindert der Bewohner seit dem 15.01.2026 die Miete um 10 Prozent.`

Within 10 to 15 seconds, the patch lands in the demo vault. If you're running the Obsidian plugin pointed at this Worker, you'll see it stream in via SSE, with hover-able provenance for each fact. The raw R2 endpoints (`property.md`, `history`, `pending`) require a bearer token; see the Worker API table below.

If the email mentions a service provider the engine doesn't already have public context for, Tavily is called once for that name and a line lands in `## External context` with `actor: tavily` and the source URL. Try a contractor like **Wisag Facility Service Holding GmbH** or **Apleona HSG Berlin GmbH**.

The bulk-import drop page is live at **`https://import.kontext.haus`**. Drag a zip, pick a property, files queue into the same pipeline.

### Run it locally

Worker (`workers/ingest`):

```bash
npm install
# Required secrets:
#   GEMINI_API_KEY          Gemini 3.1 Pro
#   TAVILY_API_KEY          Tavily
# Plus a Cloudflare account with Workers Paid, R2, Queues, Email Routing,
# authenticated via `wrangler login` or
# CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID env vars.
npx wrangler dev
```

Plugin (`plugin`):

```bash
npm install
npm run dev
# Symlink dist/ into your vault's .obsidian/plugins/buena/
```

---

## Worker API

| Method | Path                         | Purpose                                                        |
| :---   | :---                         | :---                                                           |
| `GET`  | `/health`                    | Liveness check.                                                |
| `POST` | `/upload?name=<filename>`    | Bulk import drop. Stores to R2, queues extraction.             |
| `GET`  | `/vaults/:id/property.md`    | Rendered property markdown.                                    |
| `GET`  | `/vaults/:id/state.json`     | Structured facts with provenance per section.                  |
| `GET`  | `/vaults/:id/pending`        | Pending review items.                                          |
| `GET`  | `/vaults/:id/history`        | Change log. Auto, approved, rejected.                          |
| `POST` | `/vaults/:id/decision`       | Approve or reject a pending patch with `{patchId, decision, actor, reason?}`. Reason is free text, stored as-is. |
| `POST` | `/vaults/:id/human-edit`     | Mark a section as human-edited so future writes route to review. |
| `GET`  | `/vaults/:id/events`         | One-way SSE stream of patch events for the plugin.             |
| `GET`  | `/raw?key=<r2-key>`          | Fetch a raw source object from `buena-raw` for the provenance jump. |

Authed routes require `Authorization: Bearer <INGEST_TOKEN>`. `/health` is public.

The email handler parses MIME via `postal-mime`, drops `.eml` and attachments to R2, and enqueues `{source, msgId, from, to, subject, attachmentKeys}` to the `buena-extract` queue. The subaddress (`+LIE-001`) is the strongest property hint and is preferred over inference.

Source: [`workers/ingest/src/`](workers/ingest/src/).

---

## License

MIT.
