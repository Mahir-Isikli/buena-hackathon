# Partner Files, Recon Report

Survey of `partner-files/` so we know what we're feeding the engine.

## TL;DR

One real property: **WEG Immanuelkirchstraße 26, 10405 Berlin**, managed by **Huber & Partner Immobilienverwaltung GmbH**. Three buildings (HAUS-12, 14, 16), 52 units total. Two years of synthesized history (2024-01 to 2025-12) plus a 10-day live "today" simulation in `incremental/`.

Total: ~7,000 files. 6,546 emails, 339 PDFs (135 letters + 194 invoices), 1620 bank transactions in three formats, 5 CSV/JSON master files.

The `*_index.csv` files in `bank/` and `incremental/` are **ground-truth labels** (category, error type, thread). Do NOT feed them to the extractor. Use them to evaluate.

---

## Entity ID scheme (the join keys)

| Prefix | Meaning | Count |
|---|---|---|
| `LIE-001` | Liegenschaft (the WEG) | 1 |
| `HAUS-XX` | Building (Haus) | 3 |
| `EH-XXX` | Einheit (unit/apartment) | 52 |
| `EIG-XXX` | Eigentümer (owner) | 35 |
| `MIE-XXX` | Mieter (tenant) | 26 |
| `DL-XXX` | Dienstleister (service provider) | 16 |
| `TX-XXXXX` | Bank transaction | 1,620 |
| `INV-XXXXX` | Invoice (Rechnung) | 194 |
| `LTR-XXXX` | Letter (Brief) | 135 |
| `EMAIL-XXXXX` | Email | 6,546 |
| `THR-XXX` | Email thread | many |

Cross-references:
- `mieter.einheit_id → einheiten.id`, `mieter.eigentuemer_id → eigentuemer.id`
- `eigentuemer.einheit_ids` is a `;`-separated list of `EH-XXX`
- `einheiten.haus_id → gebaeude.id`
- Bank `verwendungszweck` (`Miete 01/2024 EH-045`) is the bridge from a payment to a unit.

---

## 1. `stammdaten/` (master data, 5 files)

The single source of truth for entities. JSON has the WEG itself plus arrays; CSVs are flat exports of the same data.

### `stammdaten.json` (LIE-001)
Top-level keys: `liegenschaft`, `gebaeude[]`, `einheiten[]` (and likely more deeper). Includes verwalter contact, three IBANs (Verwalter, WEG-Konto, Rücklage).

### `eigentuemer.csv` (35 owners)
Columns: `id, anrede, vorname, nachname, firma, strasse, plz, ort, land, email, telefon, iban, bic, einheit_ids, selbstnutzer, sev_mandat, beirat, sprache`

`einheit_ids` is multi-valued (`EH-037;EH-032`).

### `mieter.csv` (26 tenants)
Columns: `id, anrede, vorname, nachname, email, telefon, einheit_id, eigentuemer_id, mietbeginn, mietende, kaltmiete, nk_vorauszahlung, kaution, iban, bic, sprache`

### `einheiten.csv` (52 units)
Columns: `id, haus_id, einheit_nr, lage, typ, wohnflaeche_qm, zimmer, miteigentumsanteil`

### `dienstleister.csv` (16 service providers)
Columns: `id, firma, branche, ansprechpartner, email, telefon, strasse, plz, ort, land, iban, bic, ust_id, steuernummer, stil, sprache, vertrag_monatlich, stundensatz`

Branches seen: Hausmeisterdienst, Aufzugswartung, Heizungswartung, Elektro, Schornsteinfeger, Wasser, Müll, etc.

---

## 2. `bank/` (1,620 transactions, 3 formats)

Same data shipped three ways. The challenge: reconcile each transaction to a unit / tenant / invoice.

### `bank_index.csv` (ground truth, do not feed to engine)
`id, datum, typ, betrag, kategorie, gegen_name, verwendungszweck, referenz_id, error_types`

Categories: `hausgeld 806`, `miete 624`, `dienstleister 155`, `sonstige 26`, `versorger 8`.

`error_types` is the adversarial label: empty for clean rows, filled with `EIG-XXX` when that owner has a payment anomaly. Each owner has ~22-24 anomalies → roughly one a month per owner. **This is what the engine has to flag.**

### `kontoauszug_2024_2025.csv` (German bank export, MT940-style)
Semicolon-separated, German column names. The realistic input.
Columns: `Auftragskonto; Buchungstag; Valutadatum; Buchungstext; Verwendungszweck; Glaeubiger-ID; Mandatsreferenz; Kundenreferenz (End-to-End); Sammlerreferenz; Lastschrift Ursprungsbetrag; Auslagenersatz Ruecklastschrift; Beguenstigter/Zahlungspflichtiger; Kontonummer/IBAN; BIC (SWIFT-Code); Betrag; Waehrung; Info`

Link to entities:
- `Beguenstigter/Zahlungspflichtiger` → match against `mieter.{vor,nach}name` or `dienstleister.firma`
- `Kontonummer/IBAN` → exact match against `mieter.iban` / `dienstleister.iban` / `eigentuemer.iban`
- `Verwendungszweck` contains `EH-045`, `INV-2026-0195`, etc.
- `Kundenreferenz (End-to-End)` is `TX-XXXXX`
- `Info` carries running balance: `Saldo: 933582,62`

### `kontoauszug_2024_2025.camt053.xml` (ISO 20022 CAMT.053)
Namespace: `urn:iso:std:iso:20022:tech:xsd:camt.053.001.02`. Same data in XML. Path of interest: `Document/BkToCstmrStmt/Stmt/Ntry`. Each `<Ntry>` has `NtryRef` (TX id), `Amt`, `CdtDbtInd` (CRDT/DBIT), dates, then `NtryDtls/TxDtls/RltdPties/Dbtr` and `RmtInf/Ustrd` (the Verwendungszweck).

This is the format Buena most likely actually consumes from real bank APIs.

---

## 3. `emails/` (6,546 .eml files, 2024-01 → 2026-01)

Plain RFC-822 emails. ~280 per month, fairly even across 24 months, then 2 emails in 2026-01 (the rest of "today" lives in `incremental/`).

Filename: `YYYYMMDD_HHMMSS_EMAIL-NNNNN.eml`.

### Senders
- `huber-partner-verwaltung.de` (the verwalter): 1,678 → outgoing
- Owner/tenant domains: `gmx.de 830`, `gmail.com 407`, `outlook.com 398`, `posteo.de 239`, `web.de 236`, `icloud.com 222`, `t-online.de 179`
- Dienstleister domains: `bsr-berliner-stadtreinigung.de`, `berliner-wasserbetriebe.de`, `elektro-schmidt-e-k.de`, `schornsteinfegermeister-bauer.de`, `heiztechnik-berlin.de`, `securelock-systems-ltd.com`, etc.

### Subject patterns (from the head of the corpus)
Wartungsbericht, Nachtrag Reparatur, Auftragsbestaetigung, Terminbestaetigung Wartung, Abschlagsanpassung, SEV - Monatsauszug, Frage zur Hausgeldabrechnung, Sonderumlage - Einspruch, Modernisierung - Zustimmung, Eigentuemerversammlung - TOP-Vorschlag, Heizung faellt aus, Defektes Fenster, Monatsbericht.

Categories implied (also in `incremental/emails_index.csv` as label):
- `eigentuemer/rechtlich`, `mieter/kaution`, `mieter/schaden`, `versorger/versorger`, `dienstleister/auftrag`, `verwaltung/intern`, etc.

### Format
ASCII text bodies, `Content-Type: text/plain; charset="utf-8"`, `quoted-printable`. Some have HTML / attachments; most are short German text. Easy to ingest.

---

## 4. `briefe/` (135 outgoing letters, PDF)

All from the verwalter to owners. Filename: `YYYYMMDD_TYPE_LTR-NNNN.pdf`.

Types: `etv_einladung` 70, `etv_protokoll` 2, `kuendigung` (seen), and presumably more in 2025-12 etc. Mostly invitations to the annual Eigentümerversammlung and minutes.

Each PDF is a short formal letter: header (Huber & Partner), salutation to a named owner, body, footer with bank details. Easy to extract with `pdfplumber` (no OCR needed, text-layer PDFs).

Provenance: each letter encodes (date, type, owner) and references the WEG.

---

## 5. `rechnungen/` (194 incoming invoices, PDF)

Invoices from dienstleister to the verwalter. Filename: `YYYYMMDD_DL-XXX_INV-NNNNN.pdf`. Two duplicate filenames (`INV-DUP-XXXXX`) → dedup challenge.

Top vendors by invoice count: `DL-001` 35 (Hausmeister, monthly), `DL-005` 24, `DL-004` 24, `DL-013` 23, `DL-012` 20, `DL-014` 17.

Each invoice has: vendor header, customer (Huber & Partner), Rechnungsnr (`RE-2024-XXXX`), Datum, line items (Position/Menge/Einzelpreis/Betrag), Summe netto, MwSt 19%, Gesamtbetrag, Bankverbindung. Text-layer PDF, easy to parse.

The `DL-XXX` in the filename is the join key to `dienstleister.csv`.

---

## 6. `incremental/` (the live demo, 10 days)

This is the simulation we run on stage. `day-01` through `day-10` cover **2026-01-01 to 2026-01-10**.

Per day: ~4 emails, 1 invoice, 1 bank transaction, plus three index CSVs (`emails_index`, `rechnungen_index`, bank `bank_index` and `kontoauszug_delta.csv`) and `incremental_manifest.json`.

Manifest example:
```json
{ "schema_version": 1, "day_index": 1, "content_date": "2026-01-01",
  "seed": 42, "difficulty": "medium", "emails_written": 4,
  "invoices_written": 1, "bank_transactions_written": 1,
  "stammdaten_relative": "../stammdaten/stammdaten.json",
  "note": "Nur Delta-Dateien. Basis-Paket (Stammdaten, Archiv-Mails, ...) liegt im uebergeordneten Ordner." }
```

Explicit: these are **deltas only**. The base load is the parent `partner-files/{stammdaten,emails,rechnungen,bank}`. We bootstrap the context.md from history once, then watch the engine apply 10 days of incremental updates live.

The demo loop:
1. Day 0: ingest the entire history → produce one `context.md` per HAUS-XX (or one for the whole WEG).
2. Loop day 1..10: for each new email/invoice/tx, the engine classifies, routes, surgically patches, shows provenance.
3. Some incoming items will hit the `error_types` flags from `bank_index.csv` (e.g. EIG-001 underpaid hausgeld) → these become "issues" entries with a confidence and a recommended action.

---

## 7. `product-interview/pm-interview.md`

Mahir's verbatim transcript from the interview with a real property manager. Read this first to ground the design in real workflow language. Already committed (commit `8feeee9`).

---

## What this tells us about the build

- **Schema-alignment** challenge from Buena's brief is real: tenant payments arrive with names that vary (`Beguenstigter/Zahlungspflichtiger` is the human-typed name), with IBANs that match `mieter.iban` exactly, and with `Verwendungszweck` containing `EH-XXX`. Three independent join paths, sometimes contradictory, sometimes one missing. Identity resolver wins by combining them.
- **Surgical update** challenge: each of the 10 incremental days is literally one or two new rows. Patch the right section, don't touch the rest. The `incremental_manifest.json` even gives us the seed for reproducibility.
- **Signal vs noise** challenge: many emails are pure boilerplate (Wartungsbericht, Auftragsbestaetigung). The relevance classifier earns its keep here. The `category` field in `emails_index.csv` is the eval target.
- **Three bank formats** = a free win: parse one, derive the others. CAMT.053 is the right primary because it preserves structure.
- **CONTEXT.md per building (HAUS-XX)** is probably the right granularity, with the WEG as a higher-level "umbrella" file. 3 buildings × 1 file = a clean demo grid. Owners with `einheit_ids` across multiple buildings show up in two files (with a back-reference).

## What we explicitly should NOT do

- Don't ingest the `*_index.csv` files into the engine. They are eval ground truth.
- Don't try to OCR. PDFs have text layers.
- Don't model individual transactions in the .md; aggregate to monthly per-tenant balance, with anomalies promoted to "Open issues".
