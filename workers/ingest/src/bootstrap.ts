/**
 * Bootstrap a property's vault from a stammdaten archive.
 * Pure functions, no I/O — caller passes file contents in, gets {erp, state, markdown} out.
 *
 * This is a TypeScript port of pipeline/bootstrap.py with the same data shape so
 * downstream consumers (ERP lookup adapter, render templates) stay portable.
 */

import { parseCsv } from "./csv";

export interface StammFiles {
  /** stammdaten.json contents */
  stammdaten: string;
  /** dienstleister.csv */
  dienstleister: string;
  /** eigentuemer.csv */
  eigentuemer: string;
  /** einheiten.csv */
  einheiten: string;
  /** mieter.csv */
  mieter: string;
}

export interface ErpProperty {
  id: string;
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  baujahr?: number | string;
  sanierung?: number | string;
  verwalter: string;
  weg_bankkonto_iban?: string;
  weg_bankkonto_bank?: string;
  ruecklage_iban?: string;
  [k: string]: unknown;
}

export interface ErpBuilding {
  id: string;
  hausnr?: string;
  einheiten: number;
  etagen?: number;
  fahrstuhl?: boolean;
  baujahr?: number;
  [k: string]: unknown;
}

export interface ErpUnit {
  id: string;
  haus_id: string;
  einheit_nr: string;
  lage: string;
  typ: string;
  wohnflaeche_qm: number | null;
  zimmer: number | null;
  miteigentumsanteil: number | null;
  [k: string]: unknown;
}

export interface ErpOwner {
  id: string;
  anrede?: string;
  vorname?: string;
  nachname?: string;
  firma?: string;
  einheit_ids: string[];
  selbstnutzer: boolean;
  sev_mandat: boolean;
  beirat: boolean;
  [k: string]: unknown;
}

export interface ErpTenant {
  id: string;
  einheit_id?: string;
  eigentuemer_id?: string;
  vorname?: string;
  nachname?: string;
  kaltmiete: number | null;
  nk_vorauszahlung: number | null;
  kaution: number | null;
  [k: string]: unknown;
}

export interface ErpProvider {
  id: string;
  firma: string;
  branche: string;
  vertrag_monatlich: number | null;
  stundensatz: number | null;
  [k: string]: unknown;
}

export interface Erp {
  property: ErpProperty;
  buildings: Record<string, ErpBuilding>;
  units: Record<string, ErpUnit>;
  owners: Record<string, ErpOwner>;
  tenants: Record<string, ErpTenant>;
  service_providers: Record<string, ErpProvider>;
}

export interface InitialState {
  schema_version: number;
  property_id: string;
  name: string;
  address: string;
  verwalter: string;
  last_updated: string;
  human_edited_sections: string[];
  sections: Record<string, unknown>;
  [k: string]: unknown;
}

const toBool = (v: unknown): boolean => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "ja";
};

const splitIds = (s: string | undefined): string[] => {
  if (!s) return [];
  return s.split(";").map((p) => p.trim()).filter(Boolean);
};

const parseFloatOrNull = (s: string | undefined): number | null => {
  if (!s || !s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const parseIntOrNull = (s: string | undefined): number | null => {
  if (!s || !s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

export function buildErp(files: StammFiles): Erp {
  const stamm = JSON.parse(files.stammdaten) as {
    liegenschaft: ErpProperty;
    gebaeude: ErpBuilding[];
  };
  const dienstleister = parseCsv(files.dienstleister);
  const eigentuemer = parseCsv(files.eigentuemer);
  const einheiten = parseCsv(files.einheiten);
  const mieter = parseCsv(files.mieter);

  const units: Record<string, ErpUnit> = {};
  for (const u of einheiten) {
    units[u.id] = {
      ...u,
      id: u.id,
      haus_id: u.haus_id,
      einheit_nr: u.einheit_nr,
      lage: u.lage,
      typ: u.typ,
      wohnflaeche_qm: parseFloatOrNull(u.wohnflaeche_qm),
      zimmer: parseFloatOrNull(u.zimmer),
      miteigentumsanteil: parseIntOrNull(u.miteigentumsanteil),
    };
  }

  const owners: Record<string, ErpOwner> = {};
  for (const o of eigentuemer) {
    owners[o.id] = {
      ...o,
      id: o.id,
      einheit_ids: splitIds(o.einheit_ids),
      selbstnutzer: toBool(o.selbstnutzer),
      sev_mandat: toBool(o.sev_mandat),
      beirat: toBool(o.beirat),
    };
  }

  const tenants: Record<string, ErpTenant> = {};
  for (const m of mieter) {
    tenants[m.id] = {
      ...m,
      id: m.id,
      kaltmiete: parseFloatOrNull(m.kaltmiete),
      nk_vorauszahlung: parseFloatOrNull(m.nk_vorauszahlung),
      kaution: parseFloatOrNull(m.kaution),
    };
  }

  const providers: Record<string, ErpProvider> = {};
  for (const d of dienstleister) {
    providers[d.id] = {
      ...d,
      id: d.id,
      firma: d.firma,
      branche: d.branche,
      vertrag_monatlich: parseFloatOrNull(d.vertrag_monatlich),
      stundensatz: parseFloatOrNull(d.stundensatz),
    };
  }

  const buildings: Record<string, ErpBuilding> = {};
  for (const b of stamm.gebaeude) {
    buildings[b.id] = b;
  }

  return {
    property: stamm.liegenschaft,
    buildings,
    units,
    owners,
    tenants,
    service_providers: providers,
  };
}

export function buildInitialState(erp: Erp, propertyId: string, nowIso: string): InitialState {
  const prop = erp.property;
  return {
    schema_version: 1,
    property_id: propertyId,
    name: prop.name,
    address: `${prop.strasse}, ${prop.plz} ${prop.ort}`,
    verwalter: prop.verwalter,
    last_updated: nowIso,
    human_edited_sections: [],
    sections: {
      identity: {
        facts: [
          {
            text: `${prop.name}, ${prop.strasse}, ${prop.plz} ${prop.ort}`,
            provenance: "stammdaten/stammdaten.json",
            actor: "bootstrap",
            confidence: 1.0,
            ts: nowIso,
          },
        ],
      },
      buildings: { facts: [] },
      units: { facts: [] },
      owners: { facts: [] },
      service_providers: { facts: [] },
      bank: {
        facts: [
          {
            text: `WEG-Konto: ${prop.weg_bankkonto_iban ?? ""} (${prop.weg_bankkonto_bank ?? ""})`,
            provenance: "stammdaten/stammdaten.json",
            actor: "bootstrap",
            confidence: 1.0,
            ts: nowIso,
          },
          {
            text: `Rücklage: ${prop.ruecklage_iban ?? ""}`,
            provenance: "stammdaten/stammdaten.json",
            actor: "bootstrap",
            confidence: 1.0,
            ts: nowIso,
          },
        ],
      },
      active_issues: { facts: [] },
      mahnungen: { facts: [] },
      side_agreements: { facts: [] },
      assembly_decisions: { facts: [] },
      per_unit_notes: {},
      beirat_notes: { facts: [] },
    },
  };
}

/**
 * Render property.md with ERP placeholders for structured master data.
 *
 * The ERP-derived sections (buildings, owners, service providers, finances,
 * unit index) are emitted as `{{erp.foo(propertyId)}}` placeholders, framed
 * with `<!-- erp:snapshot, no-patch -->` markers. The plugin's markdown
 * post-processor replaces them at render time by hitting `/vaults/:id/erp`.
 *
 * Why placeholders, not inline tables: the ERP is canonical. Inline tables
 * drift the moment Postgres changes. The patch gate also refuses to write to
 * `erp:snapshot` sections, so an email about an owner change can never silently
 * overwrite a stale row here.
 *
 * The header summary still inlines a few facts (address, verwalter) for
 * readability. Those are the property record itself, not relational tables, so
 * staleness is bounded to one row and rerunning bootstrap rerenders them.
 */
export function renderMarkdown(erp: Erp, propertyId: string): string {
  const prop = erp.property;
  const buildings = erp.buildings;
  const totalUnits = Object.values(buildings).reduce((s, b) => s + (b.einheiten ?? 0), 0);

  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  const erpSection = (heading: string, blurb: string, token: string) => {
    lines.push(`## ${heading}`);
    lines.push("<!-- erp:snapshot, no-patch -->");
    lines.push(`_${blurb}_`);
    lines.push("");
    lines.push(`{{${token}(${propertyId})}}`);
    lines.push("");
  };

  // Frontmatter
  lines.push("---");
  lines.push(`property_id: ${propertyId}`);
  lines.push(`name: ${prop.name}`);
  lines.push(`address: ${prop.strasse}, ${prop.plz} ${prop.ort}`);
  lines.push(`verwalter: ${prop.verwalter}`);
  lines.push(`last_updated: ${today}`);
  if (prop.baujahr !== undefined) lines.push(`baujahr: ${prop.baujahr}`);
  if (prop.sanierung !== undefined) lines.push(`sanierung: ${prop.sanierung}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${prop.name}`);
  lines.push("");

  lines.push("## Summary");
  lines.push(`- **Address**: ${prop.strasse}, ${prop.plz} ${prop.ort}`);
  lines.push(`- **Verwalter**: ${prop.verwalter}`);
  if (prop.baujahr || prop.sanierung) {
    const built = prop.baujahr ?? "n/a";
    const renovated = prop.sanierung ?? "n/a";
    lines.push(`- **Built / renovated**: ${built} / ${renovated}`);
  }
  lines.push(`- **Buildings**: ${Object.keys(buildings).length}`);
  lines.push(`- **Total units**: ${totalUnits}`);
  lines.push("");

  lines.push("## Open issues");
  lines.push("");

  lines.push("## Side agreements");
  lines.push("");

  lines.push("## Assembly decisions");
  lines.push("");

  lines.push("## Beirat notes");
  lines.push("");

  erpSection(
    "Building reference",
    "Live projection from the ERP. Edit in Postgres, never here.",
    "erp.buildings"
  );

  erpSection(
    "Owner reference",
    "Live projection from the ERP. Edit in Postgres, never here.",
    "erp.owners"
  );

  erpSection(
    "Service provider reference",
    "Live projection from the ERP. Edit in Postgres, never here.",
    "erp.serviceProviders"
  );

  erpSection(
    "Financial reference",
    "Live projection from the ERP. Edit in Postgres, never here.",
    "erp.financials"
  );

  erpSection(
    "Unit index",
    "Live projection from the ERP. Tribal knowledge belongs in the sections above.",
    "erp.units"
  );

  return lines.join("\n");
}

export function bootstrapVault(
  files: StammFiles,
  propertyId: string,
  nowIso = new Date().toISOString()
): { erp: Erp; state: InitialState; markdown: string } {
  const erp = buildErp(files);
  const state = buildInitialState(erp, propertyId, nowIso);
  const markdown = renderMarkdown(erp, propertyId);
  return { erp, state, markdown };
}
