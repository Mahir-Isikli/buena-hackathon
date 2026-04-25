---
property_id: LIE-001
name: WEG Immanuelkirchstraße 26
address: Immanuelkirchstraße 26, 10405 Berlin
verwalter_id: HUB-001
units: 52
owners: 35
weg_iban: DE02 1001 0010 0123 4567 89
ruecklage_iban: DE12 1203 0000 0098 7654 32
beirat:
  - EIG-001
  - EIG-003
  - EIG-004
last_updated: 2026-04-25
tags:
  - property
  - WEG
  - berlin
---

# 🏠 [[LIE-001]]

> [!info] Lookup-resolved data
> All structured data (owners, tenants, units, IBANs, contacts) is resolved at render time via the ERP. Frontmatter and links below are pointers, not duplicates.
>
> 🔍 [[LIE-001|Open in ERP]] · 📋 [[LIE-001/units|All units (52)]] · 👥 [[LIE-001/owners|All owners (35)]] · 🔧 [[LIE-001/dienstleister|All service providers (16)]]

---

## ⚠️ Active issues

> [!todo] [[EH-014]] — broken hot water
> Tenant in [[EH-014]] reports **broken hot water**, claims **rent-withholding 10 %** seit 2026-01-15.
> *Source: `emails/2026-01-15/EMAIL-12891.eml` · confidence 0.83* {changed: 2026-04-25 | actor: gemini-flash | src: emails/2026-01-15/EMAIL-12891.eml}

> [!todo] [[EH-049]] — Kaution-Rückzahlung offen
> Ehemalige Mieterin [[MIE-003]] ist vor 7 Wochen ausgezogen. Kaution **5.163 €** noch nicht ausgezahlt. Anfrage am 01.01.2026.
> *Source: `emails/2026-01/EMAIL-06548.eml` · confidence 0.95*

> [!todo] [[LIE-001/weg-konto]] — Wasser-Jahresabrechnung 2025
> Verbrauch **76.809 m³**, Saldo **5.784 €** ([[DL-010]], 01.01.2026). Auf WEG-Konto buchen.
> *Source: `emails/2026-01/EMAIL-06549.eml` · confidence 0.92*

---

## 🟡 Pending patches

```buena-pending
id: p-007
unit: EH-037
section: Per-unit notes
old: ""
new: "Eigentümerwechsel EIG-005 → EIG-012 zum 2026-06-01"
source: briefe/2026-04-20/BRIEF-00808.pdf
snippet: "Mit notarieller Urkunde vom 18.04.2026 (UR-Nr. 412/2026) wechselt das Eigentum an EH-037 von Hr. Weber (EIG-005) auf Fr. Mahmoud (EIG-012) zum 01.06.2026."
confidence: 0.92
actor: gemini-2.5-pro
target_heading: "## 🏘️ Per-unit notes"
new_block: |
  > [!note]- 🏠 [[EH-037]] · Eigentümerwechsel
  > [[EIG-005]] → [[EIG-012]] zum **2026-06-01** (Notar UR-Nr. 412/2026). Beirat-Status [[EIG-005]] prüfen. {changed: 2026-04-25 | actor: gemini-2.5-pro | src: briefe/2026-04-20/BRIEF-00808.pdf}
```

---

## 💸 Active Mahnungen

> [!bug] [[EH-021]] — 3. Mahnung, Räumungsklage
> [[MIE-002]] Rückstand **8.420 €**. Räumungsklage durch Anwalt eingeleitet 2026-04-18. {changed: 2026-04-25 | actor: gemini-2.5-pro | src: briefe/2026-04-18/BRIEF-00802.pdf}

> [!bug] [[EH-021]] — 2. Mahnung
> [[MIE-002]] im Rückstand seit Q2 2024. Vergleichsangebot offen.
> *Source: `briefe/2024-06/20240626_mahnung_LTR-0038.pdf`*

---

## 📝 Side agreements

> [!tip] [[EH-027]] — Untermiete-Antrag offen
> [[MIE-009]] beantragt Untervermietung ab 2026-06-01 für 9 Monate. Genehmigung durch Verwalter ausstehend. {changed: 2026-04-25 | actor: gemini-flash | src: emails/2026-04-19/EMAIL-13039.eml}

> [!tip] [[EH-008]] — Untermiete genehmigt
> Untermietvertrag 2025-11 für 6 Monate. Vertrag in `attachments/`.
> *Source: `briefe/2025-11/BRIEF-00412.pdf`*

---

## 💰 Payment status

- **WEG-Konto balance**: ~76.220 € (as of 2024-01-02)
  *Source: `bank/kontoauszug_2024_2025.csv` · confidence 0.9*
- **Last full rent collection**: 2024-01
- **Hausgeld arrears**: none known as of last bank export
- **Rücklage**: DE12 1203 0000 0098 7654 32 (balance not in current export)

---

## 📅 Events

> [!info] [[ETV-2024-04]] — Eigentümerversammlung (past)
> 33 Einladungen versandt 2024-04-09 bis 2024-04-19. Meeting date to be extracted from PDF.
> *Source: `briefe/2024-04/20240409_etv_einladung_LTR-0001.pdf` · confidence 0.9*

> [!info] [[ETV-2024-06-Protokoll]] — Eigentümerversammlung (past, 2024-06-01)
> Protokoll vorhanden. Beschlüsse siehe Assembly decisions.
> *Source: `briefe/2024-06/20240601_etv_protokoll_LTR-0037.pdf` · confidence 0.95*

---

## 📜 Assembly decisions (ETV)

- ETV 2024-06 Protokoll → [[ETV-2024-06-Protokoll]]
  - Beschluss: Aufzug HAUS-12 Großwartung 2025
  - Beschluss: Rücklagen-Erhöhung 0,30 €/m²
  - *Source: `briefe/2024-06/20240601_etv_protokoll_LTR-0037.pdf`*
- ETV 2024-04 Einladungen → 33 versendet, [[ETV-2024-04]]

---

## 🪪 Beirat notes

> [!quote] [[EIG-001]]
> Pushes for faster maintenance turnaround. Prefers email contact.

> [!quote] [[EIG-003]]
> Concerned about Tiefgarage Sicherheit. Mentioned at last ETV.

---

## 🏘️ Per-unit notes

> Only units with tribal-knowledge content render here. Empty units are looked up live via the ERP.

> [!note]- 🏠 [[EH-014]] · pending hot-water issue
> See "Pending patches" above. Awaiting approval.

> [!note]- 🏠 [[EH-049]] · Kaution offen
> See "Active issues" above. [[MIE-003]] ausgezogen 2025-11.

> [!note]- 🏠 [[EH-021]] · Mahnung läuft
> See "Active Mahnungen". [[MIE-002]], Vergleichsangebot offen.

> [!note]- 🏠 [[EH-008]] · Untermiete OK
> See "Side agreements". Untermiete bis 2026-05.

---

## 🔧 Service provider contracts

- [[DL-001]] Hausmeister Mueller GmbH — **650 €/Monat** · Slawomir Sölzer
- [[DL-002]] Aufzug Schindler & Co. — **185 €/Monat** · Paul-Heinz Köhler
- [[DL-004]] Reinigungsservice Kowalski — **420 €/Monat** · Malte Becker
- [[DL-005]] Gaertnerei Gruener Daumen — **180 €/Monat** · Ekkehart Wende
- [[DL-003]] Heiztechnik Berlin — on-call **78 €/h** · Olga Holsten
- [[DL-007]] Allianz — Gebäudeversicherung · Rolf Schönland
- [[DL-008]] Vattenfall — Strom Allgemein
- [[DL-009]] GASAG — Gas
- [[DL-010]] Berliner Wasserbetriebe — Wasser/Abwasser
- [[DL-011]] BSR Berliner Stadtreinigung — Müllentsorgung
*Source: `stammdaten/stammdaten.json` · confidence 1.0*

---

## 🔗 Connected pages

- [[HUB-001]] (Verwalter)
- [[DL-001]] (Hausmeister) · [[DL-002]] (Aufzug) · [[DL-004]] (Reinigung)
- [[ETV-2024-06-Protokoll]]
- Beirat: [[EIG-001]] · [[EIG-003]] · [[EIG-004]]
