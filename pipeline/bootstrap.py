"""
Bootstrap the LIE-001 vault from partner-files/stammdaten/.

Outputs three files into buena-vault/buena-hackathon/:
  - erp.json       : pure CSV mirror, lookup tables keyed by ID
  - state.json     : tribal-knowledge state, sections + provenance
  - WEG-Immanuelkirchstrasse-26.md : rendered Obsidian markdown

Run:
  uv run python pipeline/bootstrap.py
"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
STAMM = ROOT / "partner-files" / "stammdaten" / "stammdaten"
VAULT = ROOT / "buena-vault" / "buena-hackathon"
PROPERTY_ID = "LIE-001"
MD_NAME = "WEG-Immanuelkirchstrasse-26.md"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def fn(prov: str, actor: str, conf: float) -> str:
    """Inline footnote for provenance, renders as superscript in Obsidian."""
    return f"^[src: {prov} · actor: {actor} · conf: {conf}]"


def to_bool(s: str) -> bool:
    return str(s).strip().lower() in {"true", "1", "yes", "ja"}


def split_ids(s: str) -> list[str]:
    if not s:
        return []
    return [p.strip() for p in s.split(";") if p.strip()]


def build_erp() -> dict[str, Any]:
    stamm = read_json(STAMM / "stammdaten.json")
    dienstleister = read_csv(STAMM / "dienstleister.csv")
    eigentuemer = read_csv(STAMM / "eigentuemer.csv")
    einheiten = read_csv(STAMM / "einheiten.csv")
    mieter = read_csv(STAMM / "mieter.csv")

    # Index for fast lookup
    units = {u["id"]: {**u, "wohnflaeche_qm": float(u["wohnflaeche_qm"]) if u["wohnflaeche_qm"] else None,
                       "zimmer": float(u["zimmer"]) if u["zimmer"] else None,
                       "miteigentumsanteil": int(u["miteigentumsanteil"]) if u["miteigentumsanteil"] else None}
             for u in einheiten}

    owners = {}
    for o in eigentuemer:
        owners[o["id"]] = {
            **o,
            "selbstnutzer": to_bool(o.get("selbstnutzer", "")),
            "sev_mandat": to_bool(o.get("sev_mandat", "")),
            "beirat": to_bool(o.get("beirat", "")),
            "einheit_ids": split_ids(o.get("einheit_ids", "")),
        }

    tenants = {}
    for m in mieter:
        tenants[m["id"]] = {
            **m,
            "kaltmiete": float(m["kaltmiete"]) if m.get("kaltmiete") else None,
            "nk_vorauszahlung": float(m["nk_vorauszahlung"]) if m.get("nk_vorauszahlung") else None,
            "kaution": float(m["kaution"]) if m.get("kaution") else None,
        }

    providers = {}
    for d in dienstleister:
        providers[d["id"]] = {
            **d,
            "vertrag_monatlich": float(d["vertrag_monatlich"]) if d.get("vertrag_monatlich") else None,
            "stundensatz": float(d["stundensatz"]) if d.get("stundensatz") else None,
        }

    buildings = {b["id"]: b for b in stamm["gebaeude"]}

    return {
        "property": stamm["liegenschaft"],
        "buildings": buildings,
        "units": units,
        "owners": owners,
        "tenants": tenants,
        "service_providers": providers,
    }


def build_state(erp: dict[str, Any]) -> dict[str, Any]:
    """state.json holds tribal-knowledge facts (sections), human-edit markers, and provenance.
    ERP-owned data lives in erp.json; markdown references it by ID via {{erp.X(ID)}} placeholders."""
    now = datetime.now(timezone.utc).isoformat()
    prop = erp["property"]
    return {
        "schema_version": 1,
        "property_id": PROPERTY_ID,
        "name": prop["name"],
        "address": f"{prop['strasse']}, {prop['plz']} {prop['ort']}",
        "verwalter": prop["verwalter"],
        "last_updated": now,
        "human_edited_sections": [],
        "sections": {
            "identity": {
                "facts": [
                    {
                        "text": f"{prop['name']}, {prop['strasse']}, {prop['plz']} {prop['ort']}",
                        "provenance": "stammdaten/stammdaten.json",
                        "actor": "bootstrap",
                        "confidence": 1.0,
                        "ts": now,
                    }
                ]
            },
            "buildings": {"facts": []},  # ERP-derived, rendered from erp.json
            "units": {"facts": []},      # ERP-derived
            "owners": {"facts": []},     # ERP-derived
            "service_providers": {"facts": []},  # ERP-derived
            "bank": {
                "facts": [
                    {
                        "text": f"WEG-Konto: {prop['weg_bankkonto_iban']} ({prop['weg_bankkonto_bank']})",
                        "provenance": "stammdaten/stammdaten.json",
                        "actor": "bootstrap",
                        "confidence": 1.0,
                        "ts": now,
                    },
                    {
                        "text": f"Rücklage: {prop['ruecklage_iban']}",
                        "provenance": "stammdaten/stammdaten.json",
                        "actor": "bootstrap",
                        "confidence": 1.0,
                        "ts": now,
                    },
                ]
            },
            "active_issues": {"facts": []},
            "mahnungen": {"facts": []},
            "side_agreements": {"facts": []},
            "assembly_decisions": {"facts": []},
            "per_unit_notes": {},  # keyed by EH-XXX → {facts: [...]}
            "beirat_notes": {"facts": []},
        },
    }


def render_markdown(erp: dict[str, Any], state: dict[str, Any]) -> str:
    prop = erp["property"]
    buildings = erp["buildings"]
    units = erp["units"]
    owners = erp["owners"]
    tenants = erp["tenants"]
    providers = erp["service_providers"]

    # Map of unit_id -> tenant
    unit_tenant = {t["einheit_id"]: t for t in tenants.values() if t.get("einheit_id")}
    # Map of unit_id -> owner
    unit_owner: dict[str, dict[str, Any]] = {}
    for o in owners.values():
        for uid in o["einheit_ids"]:
            unit_owner[uid] = o

    beirat = [o for o in owners.values() if o.get("beirat")]
    selbstnutzer = [o for o in owners.values() if o.get("selbstnutzer")]

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines: list[str] = []

    # Frontmatter
    lines.append("---")
    lines.append(f"property_id: {PROPERTY_ID}")
    lines.append(f"name: {prop['name']}")
    lines.append(f"address: {prop['strasse']}, {prop['plz']} {prop['ort']}")
    lines.append(f"verwalter: {prop['verwalter']}")
    lines.append(f"last_updated: {today}")
    lines.append(f"baujahr: {prop['baujahr']}")
    lines.append(f"sanierung: {prop['sanierung']}")
    lines.append("---")
    lines.append("")
    lines.append(f"# {prop['name']}")
    lines.append("")

    # Identity
    lines.append("## 🏛️ Identity")
    lines.append(f"- **Address**: {prop['strasse']}, {prop['plz']} {prop['ort']} (Prenzlauer Berg)")
    lines.append(f"- **Baujahr**: {prop['baujahr']} (saniert {prop['sanierung']})")
    lines.append(
        f"- **Verwalter**: [[{prop['verwalter']}]] {fn('stammdaten/stammdaten.json', 'bootstrap', 1.0)}"
    )
    lines.append(
        f"  - {prop['verwalter_strasse']}, {prop['verwalter_plz']} {prop['verwalter_ort']}"
    )
    lines.append(f"  - {prop['verwalter_email']} · {prop['verwalter_telefon']}")
    total_units = sum(b["einheiten"] for b in buildings.values())
    lines.append(
        "- **Buildings**: "
        + ", ".join(f"`@{b['id']}` ({b['einheiten']} units)" for b in buildings.values())
    )
    lines.append(f"- **Total units**: {total_units}")
    lines.append("")

    # Buildings
    lines.append("## 🏢 Buildings")
    for b in buildings.values():
        fahrstuhl = "✓ elevator" if b.get("fahrstuhl") else "no elevator"
        lines.append(
            f"- `@{b['id']}` Hausnr. {b['hausnr']} · {b['einheiten']} units · {b['etagen']} floors · {fahrstuhl} · Baujahr {b['baujahr']}"
        )
    lines.append("")

    # Bank
    lines.append("## 🏦 Bank")
    for f in state["sections"]["bank"]["facts"]:
        lines.append(f"- {f['text']} {fn(f['provenance'], f['actor'], f['confidence'])}")
    lines.append("")

    # Owners (summary, ERP-driven)
    lines.append("## 👥 Owners")
    lines.append(f"- **Total**: {len(owners)} eigentümer")
    lines.append(f"- **Selbstnutzer**: {len(selbstnutzer)}")
    lines.append(f"- **Beirat**: {len(beirat)}")
    if beirat:
        lines.append("")
        lines.append("### Beirat")
        for o in beirat:
            unit_chips = ", ".join(f"`@{u}`" for u in o["einheit_ids"])
            oid = o["id"]
            lines.append(
                f"- `@{oid}` · {unit_chips} {fn(f'erp:eigentuemer:{oid}', 'erp', 1.0)}"
            )
    lines.append("")

    # Service providers (rendered as rich cards via plugin)
    lines.append("## 🔧 Service providers")
    lines.append("```buena-erp")
    lines.append("ids:")
    for p in providers.values():
        lines.append(f"  - {p['id']}")
    lines.append("```")
    lines.append("")

    # Active issues (empty, ready for patches)
    lines.append("## 🐛 Active issues")
    lines.append("> [!info] No open issues yet — patches from email will land here.")
    lines.append("")

    # Mahnungen
    lines.append("## 💸 Active Mahnungen")
    lines.append("> [!info] No active dunning notices.")
    lines.append("")

    # Side agreements
    lines.append("## 🤝 Side agreements")
    lines.append("> [!info] No tracked side agreements yet.")
    lines.append("")

    # Assembly decisions
    lines.append("## 📋 Assembly decisions")
    lines.append("> [!info] No ETV protocols ingested yet.")
    lines.append("")

    # Beirat notes
    lines.append("## 🪑 Beirat notes")
    lines.append("> [!info] No beirat notes yet.")
    lines.append("")

    # Per-unit notes (only render units that have notes; here, all empty at bootstrap)
    lines.append("## 🚪 Units")
    # group units by building
    by_building: dict[str, list[dict[str, Any]]] = {bid: [] for bid in buildings}
    for u in units.values():
        by_building.setdefault(u["haus_id"], []).append(u)
    def _person_label(o: dict[str, Any]) -> str:
        if o.get("firma"):
            return o["firma"]
        return f"{o.get('anrede', '')} {o.get('vorname', '')} {o.get('nachname', '')}".strip()

    def _tenant_label(t: dict[str, Any]) -> str:
        return f"{t.get('anrede', '')} {t.get('vorname', '')} {t.get('nachname', '')}".strip()

    for bid, ulist in by_building.items():
        lines.append(f"### `@{bid}`")
        for u in sorted(ulist, key=lambda x: x["einheit_nr"]):
            tenant = unit_tenant.get(u["id"])
            owner = unit_owner.get(u["id"])
            occupancy = []
            if tenant:
                occupancy.append(f"Tenant `@{tenant['id']}`")
            elif owner and owner.get("selbstnutzer"):
                occupancy.append(f"Owner-occupied `@{owner['id']}`")
            elif owner:
                occupancy.append(f"Owner `@{owner['id']}` (rented)")
            qm = f"{u['wohnflaeche_qm']:.0f}qm" if u.get("wohnflaeche_qm") else "?qm"
            zimmer = f"{u['zimmer']}Z" if u.get("zimmer") else ""
            meta = " · ".join(filter(None, [u["einheit_nr"], u["lage"], u["typ"], qm, zimmer]))
            lines.append(f"- `@{u['id']}` — {meta}")
            if occupancy:
                lines.append(f"  - {' · '.join(occupancy)}")
        lines.append("")

    # Connected pages
    lines.append("## 🔗 Connected pages")
    lines.append("- ERP lookup: `erp.json` (units, owners, tenants, service providers)")
    lines.append("- State: `state.json` (tribal-knowledge facts + provenance)")
    lines.append("- History: `history/` (immutable change log)")
    lines.append("")

    return "\n".join(lines)


def main() -> None:
    print(f"Reading stammdaten from {STAMM}")
    erp = build_erp()
    state = build_state(erp)
    md = render_markdown(erp, state)

    VAULT.mkdir(parents=True, exist_ok=True)
    (VAULT / "erp.json").write_text(json.dumps(erp, ensure_ascii=False, indent=2), encoding="utf-8")
    (VAULT / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    (VAULT / MD_NAME).write_text(md, encoding="utf-8")

    print(f"  erp.json:    {len(erp['units'])} units, {len(erp['owners'])} owners, "
          f"{len(erp['tenants'])} tenants, {len(erp['service_providers'])} providers")
    print(f"  state.json:  {len(state['sections'])} sections")
    print(f"  {MD_NAME}: {len(md.splitlines())} lines")
    print(f"Wrote to {VAULT}")


if __name__ == "__main__":
    main()
