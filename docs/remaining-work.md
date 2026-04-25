# Remaining work, Sunday snapshot

This file collects the still-open items that came up across the PM interviews, plugin review, and follow-up agent passes.

## What is already in

- Obsidian sidebar with Queue and Change history tabs
- Inline approve / reject flow with required rejection reason
- Worker-side SSE, pending fetch, decision POST, and history API
- Owners and Units richer rendering
- Compact per-property inbox pill in the property header
- Deterministic routing hints in the worker:
  - property subaddress first
  - sender / recipient email lookup second
  - unit alias scan in subject/body third
  - Gemini for the ambiguous remainder
- Public bulk import page deployed on Cloudflare Pages at `https://import.kontext.haus` and `https://buena-bulk-import.pages.dev`
- Bulk upload processing after storage for text-like files plus PDF/image multimodal extraction, including zip / docx / xlsx family parsing
- Email attachment extraction through the same stored-document path, not just email body extraction
- Full mirror sync: local vault pulls remote `property.md` + `state.json`, then appends only the current remote pending queue
- Provenance click-to-open for raw `r2://buena-raw/...` sources
- Human edit detection syncing `human_edited_sections` into local + remote state
- Recent-content highlight via inline changed markers
- Full 7-rule patch gate with ignore / pending / auto classification, auto-writeback into remote `property.md`, and `auto` history entries
- Scope-aware pending UI: unit (`EH-XXX`), building (`HAUS-XX`), and provider (`DL-XXX`) are shown explicitly instead of looking unresolved

## Still missing in the plugin

### High priority
- Further unit table polish beyond the current collapse / expand toggle

### Medium priority
- Read remote worker history everywhere and surface true `auto` entries cleanly
- Better reverse / re-queue semantics for remote-only history rows
- Property overview tab if we still want a third tab

## Still missing in the worker

### High priority
- Richer upload progress reporting beyond the current client-side upload + pipeline polling

### Medium priority
- Safer multi-property fallback routing
  - right now `fallback` still resolves to `LIE-001` in the single-property demo
  - once we have multiple real property inboxes, fallback should escalate rather than default
- Persist and expose more routing provenance if useful in the UI

## Bulk import page notes

The PM interview suggests this should be an internal intake tool, not a consumer-facing form.

So the current page is intentionally built around:
- one property at a time
- property dropdown
- add-new-property flow
- optional operator note
- upload any file type, including messy legacy input

## Verification notes

### Deterministic routing, now verifiable locally

The current routing behavior is:
1. `property+LIE-001@kontext.haus` style subaddress picks the property
2. known sender / recipient emails map to owners, tenants, providers, and sometimes unit sets
3. body / subject aliases like `WE 29`, `EH-029`, `TG 18` can narrow to a unit
4. if none of the above exist, we fall back to the demo property and should eventually escalate in multi-property mode

### What the 7 percent case means in practice

If we have:
- no usable property inbox address
- no known sender / recipient email
- no unit alias in the text

then routing is not deterministic. That is the case that should become a review / escalation path rather than a confident auto-route.

## Good next steps

1. tighten multi-property fallback so ambiguous routing escalates instead of defaulting
2. keep polishing the units table and bulk import progress UX
3. add more live regression checks for the gate across conflicting sample inputs
