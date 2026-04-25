---
property_id: LIE-001
name: WEG Immanuelkirchstraße 26
address: Immanuelkirchstraße 26, 10405 Berlin
verwalter: Huber & Partner Immobilienverwaltung GmbH
last_updated: 2026-04-25
tags:
  - property
  - WEG
---

# 🏠 WEG Immanuelkirchstraße 26

> [!info] Property snapshot
> **52 units** across **3 buildings**, built **1928** (saniert 2008). Verwalter: [[Huber & Partner Immobilienverwaltung GmbH]]. Located in Prenzlauer Berg, Berlin.

---

## 📍 Identity

| Field | Value |
| --- | --- |
| Address | Immanuelkirchstraße 26, 10405 Berlin |
| District | Prenzlauer Berg |
| Baujahr | 1928 (saniert 2008) |
| Total units | 52 |
| Verwalter | Huber & Partner Immobilienverwaltung GmbH |

### Buildings

| ID | Hausnr. | Units | Etagen | Fahrstuhl | Baujahr |
| --- | --- | --- | --- | --- | --- |
| HAUS-12 | 12 | 18 | 5 | ✅ | 1928 |
| HAUS-14 | 14 | 20 | 5 | ✅ | 1928 |
| HAUS-16 | 16 | 14 | 4 | ❌ | 1926 |

*Source: `stammdaten/stammdaten.json`*

---

## 🏦 Bank

| Account | IBAN | BIC | Bank |
| --- | --- | --- | --- |
| WEG-Konto | DE02 1001 0010 0123 4567 89 | PBNKDEFFXXX | Postbank Berlin |
| Rücklage | DE12 1203 0000 0098 7654 32 | BYLADEM1001 | BayernLB |
| Verwalter-Konto | DE89 3704 0044 0532 0130 00 | COBADEFFXXX | Commerzbank Berlin |

---

## 📞 Verwalter contact

> [!abstract] Huber & Partner Immobilienverwaltung GmbH
> 📍 Friedrichstrasse 112, 10117 Berlin
> ✉️ info@huber-partner-verwaltung.de
> ☎️ +49 30 12345-0
> 🧾 Steuernummer: 13/456/78901

---

## 🏘️ Units

> [!note] 52 units in total. Tribal-knowledge notes per unit go below. ERP data (tenant, rent, layout) resolved at render time via the plugin.

### EH-001
- **Location:** HAUS-12 · WE 01 · 1. OG links
- **Size:** 103 m² · 4 Zimmer · MEA 241
- **Status:** ✅ no open issues

### EH-002
- **Location:** HAUS-12 · WE 02 · 1. OG mitte
- **Size:** 49 m² · 1.5 Zimmer · MEA 114
- **Status:** ✅ no open issues

*… 50 more units to render once the plugin reads `einheiten.csv`.*

---

## 👥 Owners

| ID | Name | Units | Role |
| --- | --- | --- | --- |
| EIG-001 | Marcus Dowerg | EH-037, EH-032 | Beirat |
| EIG-002 | Gertraud Holsten | EH-047, EH-033 | Selbstnutzer · SEV-Mandat |
| EIG-003 | Arnulf Heintze | EH-025, EH-049 | Beirat |
| EIG-004 | Erdal Beckmann | EH-043, EH-015 | Selbstnutzer · Beirat |

*… 35 owners total. Source: `stammdaten/eigentuemer.csv`*

---

## 🔧 Service providers

| Role | Provider | Cost |
| --- | --- | --- |
| Hausmeister | [[Hausmeister Mueller GmbH]] | 650 €/Monat |
| Aufzugswartung | [[Aufzug Schindler & Co. GmbH]] | 185 €/Monat |
| Heizungswartung | [[Heiztechnik Berlin GmbH]] | 78 €/Std. |
| Treppenhausreinigung | [[Reinigungsservice Kowalski]] | 420 €/Monat |
| Versicherung | [[Allianz Versicherungs-AG]] | — |
| Strom | [[Vattenfall Europe Sales GmbH]] | — |
| Gas | [[GASAG Berliner Gaswerke AG]] | — |
| Wasser | [[Berliner Wasserbetriebe]] | — |

*… 16 Dienstleister total. Source: `stammdaten/dienstleister.csv`*

---

## ⚠️ Open issues

> [!todo] Kaution-Rückzahlung EH-049 offen
> Ehemalige Mieterin **Joanna Schäfer** (MIE-003) ist vor 7 Wochen ausgezogen. Kaution **5.163 €** noch nicht ausgezahlt. Anfrage am 01.01.2026.
> *Source: `emails/2026-01/EMAIL-06548.eml` · confidence 0.95*

> [!todo] Wasser-Jahresabrechnung 2025
> Verbrauch **76.809 m³**, Saldo **5.784 €** (Berliner Wasserbetriebe, 01.01.2026). Auf WEG-Konto buchen.
> *Source: `emails/2026-01/EMAIL-06549.eml` · confidence 0.92*

---

## 🟡 Pending patches

> [!warning] EH-014 — broken hot water (review needed)
> Tenant in EH-014 reports **broken hot water**, claims **rent-withholding 10 %**.
> Conflicts with current note "no open issues" on EH-014.
> *Source: `emails/2026-01-15/EMAIL-12891.eml` · confidence 0.83*
>
> **[ Approve ] · [ Reject ] · [ Edit ]**

---

## 📜 Last assembly decisions

- ETV 2024-04 → see [[ETV-2024-04-Protokoll]]
- *Future Beschlüsse linked here as wiki-pages under `vault/protocols/`.*
