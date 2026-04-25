---
property_id: LIE-001
name: WEG Immanuelkirchstraße 26
address: Immanuelkirchstraße 26, 10405 Berlin
verwalter: Huber & Partner Immobilienverwaltung GmbH
last_updated: 2026-04-25
baujahr: 1928
sanierung: 2008
---

# WEG Immanuelkirchstraße 26

## 🏛️ Identity
- **Address**: Immanuelkirchstraße 26, 10405 Berlin (Prenzlauer Berg)
- **Baujahr**: 1928 (saniert 2008)
- **Verwalter**: [[Huber & Partner Immobilienverwaltung GmbH]] ^[src: stammdaten/stammdaten.json · actor: bootstrap · conf: 1.0]
  - Friedrichstrasse 112, 10117 Berlin
  - info@huber-partner-verwaltung.de · +49 30 12345-0
- **Buildings**: `@HAUS-12` (18 units), `@HAUS-14` (20 units), `@HAUS-16` (14 units)
- **Total units**: 52

## 🏢 Buildings
- `@HAUS-12` Hausnr. 12 · 18 units · 5 floors · ✓ elevator · Baujahr 1928
- `@HAUS-14` Hausnr. 14 · 20 units · 5 floors · ✓ elevator · Baujahr 1928
- `@HAUS-16` Hausnr. 16 · 14 units · 4 floors · no elevator · Baujahr 1926

## 🏦 Bank
```buena-erp
layout: bank
id: LIE-001
```
^[src: stammdaten/stammdaten.json · actor: bootstrap · conf: 1.0]

## 👥 Owners
- **Total**: 35 eigentümer
- **Selbstnutzer**: 15
- **Beirat**: 3

### Beirat
```buena-erp
layout: grid
ids:
  - EIG-004
  - EIG-010
  - EIG-020
```
^[src: erp:eigentuemer · actor: erp · conf: 1.0]

## 🔧 Service providers
```buena-erp
ids:
  - DL-001
  - DL-002
  - DL-003
  - DL-004
  - DL-005
  - DL-006
  - DL-007
  - DL-008
  - DL-009
  - DL-010
  - DL-011
  - DL-012
  - DL-013
  - DL-014
  - DL-015
  - DL-016
```

## 🐛 Active issues
> [!info] No open issues yet — patches from email will land here.

## 💸 Active Mahnungen
> [!info] No active dunning notices.

## 🤝 Side agreements
> [!info] No tracked side agreements yet.

## 📋 Assembly decisions
> [!info] No ETV protocols ingested yet.

## 🪑 Beirat notes
> [!info] No beirat notes yet.

## 🚪 Units
### `@HAUS-12`
```buena-erp
layout: units
ids:
  - EH-018
  - EH-001
  - EH-002
  - EH-003
  - EH-004
  - EH-005
  - EH-006
  - EH-007
  - EH-008
  - EH-009
  - EH-010
  - EH-011
  - EH-012
  - EH-013
  - EH-014
  - EH-015
  - EH-016
  - EH-017
```

### `@HAUS-14`
```buena-erp
layout: units
ids:
  - EH-037
  - EH-038
  - EH-019
  - EH-020
  - EH-021
  - EH-022
  - EH-023
  - EH-024
  - EH-025
  - EH-026
  - EH-027
  - EH-028
  - EH-029
  - EH-030
  - EH-031
  - EH-032
  - EH-033
  - EH-034
  - EH-035
  - EH-036
```

### `@HAUS-16`
```buena-erp
layout: units
ids:
  - EH-052
  - EH-039
  - EH-040
  - EH-041
  - EH-042
  - EH-043
  - EH-044
  - EH-045
  - EH-046
  - EH-047
  - EH-048
  - EH-049
  - EH-050
  - EH-051
```

## 🔗 Connected pages
- ERP lookup: `erp.json` (units, owners, tenants, service providers)
- State: `state.json` (tribal-knowledge facts + provenance)
- History: `history/` (immutable change log)
```buena-pending
id: CAJ9sWTsUv0Th4b6m8QzUhDB_c-2hQpnni2tv=pqwPYMy5VeL=Q@mail.gmail.com-4
section: Open issues
unit: EH-014
new: Die Miete wird seit dem 15.01.2026 wegen eines Heißwasser-Defekts um 10 Prozent gemindert
source: r2://buena-raw/emails/CAJ9sWTsUv0Th4b6m8QzUhDB_c-2hQpnni2tv=pqwPYMy5VeL=Q@mail.gmail.com.eml
snippet: Mieter EH-014 mindert ab 15.01.2026 weiterhin die Miete um 10 Prozent wegen Heißwasser-Defekt.
confidence: 0.99
actor: gemini-3-pro
target_heading: "## Open issues"
new_block: "- Die Miete wird seit dem 15.01.2026 wegen eines Heißwasser-Defekts um 10 Prozent gemindert"
```
```buena-pending
id: CAJ9sWTsUv0Th4b6m8QzUhDB_c-2hQpnni2tv=pqwPYMy5VeL=Q@mail.gmail.com-3
section: Open issues
unit:
new: Die Reparatur des Aufzugs in HAUS-12 ist für den 28.04.2026 terminiert
source: r2://buena-raw/emails/CAJ9sWTsUv0Th4b6m8QzUhDB_c-2hQpnni2tv=pqwPYMy5VeL=Q@mail.gmail.com.eml
snippet: wurde beauftragt, Reparatur am 28.04.2026.
confidence: 0.98
actor: gemini-3-pro
target_heading: "## Open issues"
new_block: "- Die Reparatur des Aufzugs in HAUS-12 ist für den 28.04.2026 terminiert"
```
```buena-pending
id: CAJ9sWTsUv0Th4b6m8QzUhDB_c-2hQpnni2tv=pqwPYMy5VeL=Q@mail.gmail.com-2
section: Service providers
unit:
new: DL-002 führt die Aufzugswartung für 185 EUR/Monat durch
source: r2://buena-raw/emails/CAJ9sWTsUv0Th4b6m8QzUhDB_c-2hQpnni2tv=pqwPYMy5VeL=Q@mail.gmail.com.eml
snippet: DL-002 (Aufzugswartung, 185 EUR/Monat) wurde beauftragt
confidence: 0.98
actor: gemini-3-pro
target_heading: "## Service providers"
new_block: "- DL-002 führt die Aufzugswartung für 185 EUR/Monat durch"
```
```buena-pending
id: CAJ9sWTsUv0Th4b6m8QzUhDB_c-2hQpnni2tv=pqwPYMy5VeL=Q@mail.gmail.com-1
section: Open issues
unit: EH-007
new: Die Mieterin hat sich wegen des defekten Aufzugs beschwert
source: r2://buena-raw/emails/CAJ9sWTsUv0Th4b6m8QzUhDB_c-2hQpnni2tv=pqwPYMy5VeL=Q@mail.gmail.com.eml
snippet: Mieterin Frau Meier in EH-007 hat sich beschwert.
confidence: 0.95
actor: gemini-3-pro
target_heading: "## Open issues"
new_block: "- Die Mieterin hat sich wegen des defekten Aufzugs beschwert"
```
```buena-pending
id: CAJ9sWTsUv0Th4b6m8QzUhDB_c-2hQpnni2tv=pqwPYMy5VeL=Q@mail.gmail.com-0
section: Open issues
unit:
new: Der Aufzug in HAUS-12 ist seit dem 24.04.2026 defekt
source: r2://buena-raw/emails/CAJ9sWTsUv0Th4b6m8QzUhDB_c-2hQpnni2tv=pqwPYMy5VeL=Q@mail.gmail.com.eml
snippet: der Aufzug in HAUS-12 ist seit 24.04.2026 defekt.
confidence: 0.98
actor: gemini-3-pro
target_heading: "## Open issues"
new_block: "- Der Aufzug in HAUS-12 ist seit dem 24.04.2026 defekt"
```
