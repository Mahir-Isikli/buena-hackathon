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

    unit_tenant = {t["einheit_id"]: t for t in tenants.values() if t.get("einheit_id")}
    unit_owner: dict[str, dict[str, Any]] = {}
    for owner in owners.values():
        for unit_id in owner["einheit_ids"]:
            unit_owner[unit_id] = owner

    beirat = [o for o in owners.values() if o.get("beirat")]
    selbstnutzer = [o for o in owners.values() if o.get("selbstnutzer")]
    total_units = sum(b["einheiten"] for b in buildings.values())

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines: list[str] = []

    def esc(value: Any) -> str:
        return str(value).replace("|", "\\|")

    def add_table(headers: list[str], rows: list[list[Any]]) -> None:
        lines.append("| " + " | ".join(headers) + " |")
        lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
        for row in rows:
            lines.append("| " + " | ".join(esc(cell) for cell in row) + " |")
        lines.append("")

    def esc_html(value: Any) -> str:
        return (
            str(value)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )

    def add_html_table(headers: list[str], rows: list[list[Any]]) -> None:
        # HTML tables render correctly inside <details> in Obsidian.
        # Markdown tables don't, because the blank-line gap forces the
        # parser to exit HTML mode and the table becomes a sibling.
        lines.append("<table>")
        lines.append(
            "<thead><tr>"
            + "".join(f"<th>{esc_html(h)}</th>" for h in headers)
            + "</tr></thead>"
        )
        lines.append("<tbody>")
        for row in rows:
            lines.append(
                "<tr>"
                + "".join(f"<td>{esc_html(c)}</td>" for c in row)
                + "</tr>"
            )
        lines.append("</tbody>")
        lines.append("</table>")

    def open_details(summary: str, *, open_default: bool = False) -> None:
        attr = " open" if open_default else ""
        lines.append(f"<details{attr}>")
        lines.append(f"<summary>{esc_html(summary)}</summary>")

    def close_details() -> None:
        lines.append("</details>")
        lines.append("")

    def owner_label(owner: dict[str, Any]) -> str:
        if owner.get("firma"):
            return owner["firma"]
        return f"{owner.get('vorname', '')} {owner.get('nachname', '')}".strip() or owner["id"]

    def provider_contract(provider: dict[str, Any]) -> str:
        monthly = provider.get("vertrag_monatlich")
        hourly = provider.get("stundensatz")
        if monthly:
            return f"€{monthly:,.0f}/mo"
        if hourly:
            return f"€{hourly:,.0f}/h"
        return "On demand"

    def owner_role(owner: dict[str, Any]) -> str:
        tags: list[str] = []
        if owner.get("beirat"):
            tags.append("Beirat")
        if owner.get("selbstnutzer"):
            tags.append("Selbstnutzer")
        if owner.get("sev_mandat"):
            tags.append("SEV")
        return ", ".join(tags) if tags else "Eigentümer"

    def occupant_label(unit_id: str) -> str:
        tenant = unit_tenant.get(unit_id)
        owner = unit_owner.get(unit_id)
        if tenant:
            return f"Tenant {tenant['id']}"
        if owner and owner.get("selbstnutzer"):
            return f"Owner occupied {owner['id']}"
        if owner:
            return f"Owner {owner['id']}"
        return "Vacant"

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

    lines.append("## Summary")
    lines.append(f"- **Address**: {prop['strasse']}, {prop['plz']} {prop['ort']}")
    lines.append(f"- **Verwalter**: {prop['verwalter']}")
    lines.append(f"- **Built / renovated**: {prop['baujahr']} / {prop['sanierung']}")
    lines.append(f"- **Buildings**: {len(buildings)}")
    lines.append(f"- **Total units**: {total_units}")
    lines.append("")

    lines.append("## Open issues")
    lines.append("")

    lines.append("## Side agreements")
    lines.append("")

    lines.append("## Assembly decisions")
    lines.append("")

    lines.append("## Beirat notes")
    lines.append("")

    lines.append("## Building reference")
    lines.append("_Derived from the ERP snapshot. Use IDs as stable references._")
    lines.append("")
    open_details(f"{len(buildings)} buildings")
    add_html_table(
        ["Building ID", "House no.", "Units", "Floors", "Elevator", "Year"],
        [
            [
                building["id"],
                building["hausnr"],
                building["einheiten"],
                building["etagen"],
                "Yes" if building.get("fahrstuhl") else "No",
                building["baujahr"],
            ]
            for building in buildings.values()
        ],
    )
    close_details()

    lines.append("## Owner reference")
    lines.append("_Contact data stays in ERP. The markdown keeps just enough reference data to connect context to the right records._")
    lines.append("")
    beirat_line = f"Beirat seats: {', '.join(owner['id'] for owner in beirat) if beirat else 'None'}"
    selfocc_line = f"Self-occupied owners: {len(selbstnutzer)} of {len(owners)}"
    lines.append(beirat_line)
    lines.append("")
    lines.append(selfocc_line)
    lines.append("")
    open_details(f"{len(owners)} owners")
    add_html_table(
        ["Owner ID", "Name", "Units", "Role"],
        [
            [
                owner["id"],
                owner_label(owner),
                ", ".join(owner["einheit_ids"]),
                owner_role(owner),
            ]
            for owner in owners.values()
        ],
    )
    close_details()

    lines.append("## Service provider reference")
    lines.append("_Directory snapshot only. Scheduling, contact, and contracts remain canonical in ERP._")
    lines.append("")
    open_details(f"{len(providers)} service providers")
    add_html_table(
        ["Provider ID", "Category", "Name", "Contract"],
        [
            [
                provider["id"],
                provider["branche"],
                provider["firma"],
                provider_contract(provider),
            ]
            for provider in providers.values()
        ],
    )
    close_details()

    lines.append("## Financial reference")
    lines.append("_Reference-only account view._")
    lines.append("")
    open_details("Accounts")
    add_html_table(
        ["Account", "IBAN", "Bank"],
        [
            ["WEG account", prop["weg_bankkonto_iban"], prop["weg_bankkonto_bank"]],
            ["Reserve", prop["ruecklage_iban"], "Reserve account"],
        ],
    )
    close_details()

    lines.append("## Unit index")
    lines.append("_Reference snapshot for routing. Tribal knowledge should stay in the sections above, not in this table._")
    lines.append("")

    by_building: dict[str, list[dict[str, Any]]] = {building_id: [] for building_id in buildings}
    for unit in units.values():
        by_building.setdefault(unit["haus_id"], []).append(unit)

    primary_building = next(iter(by_building), None)
    for building_id, unit_list in by_building.items():
        is_primary = building_id == primary_building
        open_details(f"{building_id} ({len(unit_list)} units)", open_default=is_primary)
        add_html_table(
            ["Unit ID", "Unit no.", "Lage", "Type", "Area", "Occupancy"],
            [
                [
                    unit["id"],
                    unit["einheit_nr"],
                    unit["lage"],
                    unit["typ"],
                    f"{unit['wohnflaeche_qm']:.1f} m²" if unit.get("wohnflaeche_qm") is not None else "",
                    occupant_label(unit["id"]),
                ]
                for unit in sorted(unit_list, key=lambda value: value["einheit_nr"])
            ],
        )
        close_details()

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
