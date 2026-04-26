/**
 * D1-backed ERP lookup adapter.
 *
 * Stand-in for Buena's Postgres. Exposes the same shape as bootstrap's in-memory
 * Erp so existing renderers and callers stay portable. Swap the D1 binding for a
 * Postgres client in production and the rest of the worker keeps working.
 */

import type {
  Erp,
  ErpBuilding,
  ErpOwner,
  ErpProperty,
  ErpProvider,
  ErpTenant,
  ErpUnit,
} from "./bootstrap";

interface PropertyRow {
  id: string;
  name: string;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  land: string | null;
  baujahr: number | null;
  sanierung: number | null;
  verwalter: string | null;
  weg_bankkonto_iban: string | null;
  weg_bankkonto_bank: string | null;
  ruecklage_iban: string | null;
}

interface BuildingRow {
  id: string;
  property_id: string;
  hausnr: string | null;
  einheiten: number | null;
  etagen: number | null;
  fahrstuhl: number | null;
  baujahr: number | null;
}

interface UnitRow {
  id: string;
  haus_id: string;
  einheit_nr: string | null;
  lage: string | null;
  typ: string | null;
  wohnflaeche_qm: number | null;
  zimmer: number | null;
  miteigentumsanteil: number | null;
}

interface OwnerRow {
  id: string;
  property_id: string;
  anrede: string | null;
  vorname: string | null;
  nachname: string | null;
  firma: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  land: string | null;
  email: string | null;
  telefon: string | null;
  iban: string | null;
  bic: string | null;
  selbstnutzer: number;
  sev_mandat: number;
  beirat: number;
  sprache: string | null;
}

interface TenantRow {
  id: string;
  property_id: string;
  anrede: string | null;
  vorname: string | null;
  nachname: string | null;
  email: string | null;
  telefon: string | null;
  einheit_id: string | null;
  eigentuemer_id: string | null;
  mietbeginn: string | null;
  mietende: string | null;
  kaltmiete: number | null;
  nk_vorauszahlung: number | null;
  kaution: number | null;
  iban: string | null;
  bic: string | null;
  sprache: string | null;
}

interface ProviderRow {
  id: string;
  property_id: string;
  firma: string | null;
  branche: string | null;
  ansprechpartner: string | null;
  email: string | null;
  telefon: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  land: string | null;
  iban: string | null;
  bic: string | null;
  ust_id: string | null;
  steuernummer: string | null;
  stil: string | null;
  sprache: string | null;
  vertrag_monatlich: number | null;
  stundensatz: number | null;
}

const nonNull = <T>(o: Record<string, T | null>): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== null) out[k] = v;
  }
  return out;
};

const toBoolish = (n: number | null | undefined): boolean => n === 1;

export async function getErpSnapshot(db: D1Database, propertyId: string): Promise<Erp | null> {
  const propRow = await db
    .prepare("SELECT * FROM properties WHERE id = ?")
    .bind(propertyId)
    .first<PropertyRow>();
  if (!propRow) return null;

  const [buildingsRes, unitsRes, ownersRes, ownerUnitsRes, tenantsRes, providersRes] =
    await Promise.all([
      db
        .prepare("SELECT * FROM buildings WHERE property_id = ? ORDER BY id")
        .bind(propertyId)
        .all<BuildingRow>(),
      db
        .prepare(
          "SELECT u.* FROM units u JOIN buildings b ON b.id = u.haus_id WHERE b.property_id = ? ORDER BY u.id"
        )
        .bind(propertyId)
        .all<UnitRow>(),
      db
        .prepare("SELECT * FROM owners WHERE property_id = ? ORDER BY id")
        .bind(propertyId)
        .all<OwnerRow>(),
      db
        .prepare(
          "SELECT ou.owner_id, ou.unit_id FROM owner_units ou JOIN owners o ON o.id = ou.owner_id WHERE o.property_id = ? ORDER BY ou.owner_id, ou.unit_id"
        )
        .bind(propertyId)
        .all<{ owner_id: string; unit_id: string }>(),
      db
        .prepare("SELECT * FROM tenants WHERE property_id = ? ORDER BY id")
        .bind(propertyId)
        .all<TenantRow>(),
      db
        .prepare("SELECT * FROM service_providers WHERE property_id = ? ORDER BY id")
        .bind(propertyId)
        .all<ProviderRow>(),
    ]);

  const ownerUnits: Record<string, string[]> = {};
  for (const row of ownerUnitsRes.results) {
    (ownerUnits[row.owner_id] ??= []).push(row.unit_id);
  }

  const property: ErpProperty = {
    id: propRow.id,
    name: propRow.name,
    strasse: propRow.strasse ?? "",
    plz: propRow.plz ?? "",
    ort: propRow.ort ?? "",
    verwalter: propRow.verwalter ?? "",
    ...nonNull({
      land: propRow.land,
      baujahr: propRow.baujahr,
      sanierung: propRow.sanierung,
      weg_bankkonto_iban: propRow.weg_bankkonto_iban,
      weg_bankkonto_bank: propRow.weg_bankkonto_bank,
      ruecklage_iban: propRow.ruecklage_iban,
    }),
  };

  const buildings: Record<string, ErpBuilding> = {};
  for (const b of buildingsRes.results) {
    buildings[b.id] = {
      id: b.id,
      einheiten: b.einheiten ?? 0,
      ...nonNull({
        hausnr: b.hausnr,
        etagen: b.etagen,
        baujahr: b.baujahr,
      }),
      ...(b.fahrstuhl !== null ? { fahrstuhl: toBoolish(b.fahrstuhl) } : {}),
    };
  }

  const units: Record<string, ErpUnit> = {};
  for (const u of unitsRes.results) {
    units[u.id] = {
      id: u.id,
      haus_id: u.haus_id,
      einheit_nr: u.einheit_nr ?? "",
      lage: u.lage ?? "",
      typ: u.typ ?? "",
      wohnflaeche_qm: u.wohnflaeche_qm,
      zimmer: u.zimmer,
      miteigentumsanteil: u.miteigentumsanteil,
    };
  }

  const owners: Record<string, ErpOwner> = {};
  for (const o of ownersRes.results) {
    owners[o.id] = {
      id: o.id,
      einheit_ids: ownerUnits[o.id] ?? [],
      selbstnutzer: toBoolish(o.selbstnutzer),
      sev_mandat: toBoolish(o.sev_mandat),
      beirat: toBoolish(o.beirat),
      ...nonNull({
        anrede: o.anrede,
        vorname: o.vorname,
        nachname: o.nachname,
        firma: o.firma,
        strasse: o.strasse,
        plz: o.plz,
        ort: o.ort,
        land: o.land,
        email: o.email,
        telefon: o.telefon,
        iban: o.iban,
        bic: o.bic,
        sprache: o.sprache,
      }),
    };
  }

  const tenants: Record<string, ErpTenant> = {};
  for (const t of tenantsRes.results) {
    tenants[t.id] = {
      id: t.id,
      kaltmiete: t.kaltmiete,
      nk_vorauszahlung: t.nk_vorauszahlung,
      kaution: t.kaution,
      ...nonNull({
        anrede: t.anrede,
        vorname: t.vorname,
        nachname: t.nachname,
        email: t.email,
        telefon: t.telefon,
        einheit_id: t.einheit_id,
        eigentuemer_id: t.eigentuemer_id,
        mietbeginn: t.mietbeginn,
        mietende: t.mietende,
        iban: t.iban,
        bic: t.bic,
        sprache: t.sprache,
      }),
    };
  }

  const providers: Record<string, ErpProvider> = {};
  for (const p of providersRes.results) {
    providers[p.id] = {
      id: p.id,
      firma: p.firma ?? "",
      branche: p.branche ?? "",
      vertrag_monatlich: p.vertrag_monatlich,
      stundensatz: p.stundensatz,
      ...nonNull({
        ansprechpartner: p.ansprechpartner,
        email: p.email,
        telefon: p.telefon,
        strasse: p.strasse,
        plz: p.plz,
        ort: p.ort,
        land: p.land,
        iban: p.iban,
        bic: p.bic,
        ust_id: p.ust_id,
        steuernummer: p.steuernummer,
        stil: p.stil,
        sprache: p.sprache,
      }),
    };
  }

  return { property, buildings, units, owners, tenants, service_providers: providers };
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const intOrNull = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n === null ? null : Math.trunc(n);
};

const strOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

/**
 * Replace the entire ERP slice for `propertyId` in D1 with the given `erp`.
 *
 * Idempotent: deletes existing rows for the property first, then inserts the
 * fresh set. Designed to be called from the /init handler so a stammdaten zip
 * upload populates D1 the same way the demo seed did. Production would call
 * this from a webhook when Buena's Postgres mutates.
 *
 * Runs as a single D1 batch so partial failures roll back.
 */
export async function writeErpToD1(
  db: D1Database,
  propertyId: string,
  erp: Erp
): Promise<void> {
  const stmts: D1PreparedStatement[] = [];

  // Delete in dependency order. owner_units, tenants, providers, owners,
  // units (via building filter), buildings, property.
  stmts.push(
    db
      .prepare(
        "DELETE FROM owner_units WHERE owner_id IN (SELECT id FROM owners WHERE property_id = ?)"
      )
      .bind(propertyId)
  );
  stmts.push(db.prepare("DELETE FROM tenants WHERE property_id = ?").bind(propertyId));
  stmts.push(db.prepare("DELETE FROM service_providers WHERE property_id = ?").bind(propertyId));
  stmts.push(db.prepare("DELETE FROM owners WHERE property_id = ?").bind(propertyId));
  stmts.push(
    db
      .prepare(
        "DELETE FROM units WHERE haus_id IN (SELECT id FROM buildings WHERE property_id = ?)"
      )
      .bind(propertyId)
  );
  stmts.push(db.prepare("DELETE FROM buildings WHERE property_id = ?").bind(propertyId));
  stmts.push(db.prepare("DELETE FROM properties WHERE id = ?").bind(propertyId));

  // Property
  const p = erp.property as ErpProperty;
  stmts.push(
    db
      .prepare(
        "INSERT INTO properties (id, name, strasse, plz, ort, land, baujahr, sanierung, verwalter, weg_bankkonto_iban, weg_bankkonto_bank, ruecklage_iban) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        propertyId,
        strOrNull(p.name) ?? propertyId,
        strOrNull(p.strasse),
        strOrNull(p.plz),
        strOrNull(p.ort),
        strOrNull((p as Record<string, unknown>)["land"]) ?? "DE",
        intOrNull(p.baujahr),
        intOrNull(p.sanierung),
        strOrNull(p.verwalter),
        strOrNull(p.weg_bankkonto_iban),
        strOrNull(p.weg_bankkonto_bank),
        strOrNull(p.ruecklage_iban)
      )
  );

  // Buildings
  for (const b of Object.values(erp.buildings) as ErpBuilding[]) {
    stmts.push(
      db
        .prepare(
          "INSERT INTO buildings (id, property_id, hausnr, einheiten, etagen, fahrstuhl, baujahr) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          b.id,
          propertyId,
          strOrNull(b.hausnr),
          intOrNull(b.einheiten) ?? 0,
          intOrNull(b.etagen),
          b.fahrstuhl ? 1 : 0,
          intOrNull(b.baujahr)
        )
    );
  }

  // Units
  for (const u of Object.values(erp.units) as ErpUnit[]) {
    stmts.push(
      db
        .prepare(
          "INSERT INTO units (id, haus_id, einheit_nr, lage, typ, wohnflaeche_qm, zimmer, miteigentumsanteil) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          u.id,
          u.haus_id,
          strOrNull(u.einheit_nr),
          strOrNull(u.lage),
          strOrNull(u.typ),
          numOrNull(u.wohnflaeche_qm),
          numOrNull(u.zimmer),
          intOrNull(u.miteigentumsanteil)
        )
    );
  }

  // Owners and owner_units
  for (const o of Object.values(erp.owners) as ErpOwner[]) {
    const oRec = o as unknown as Record<string, unknown>;
    stmts.push(
      db
        .prepare(
          "INSERT INTO owners (id, property_id, anrede, vorname, nachname, firma, strasse, plz, ort, land, email, telefon, iban, bic, selbstnutzer, sev_mandat, beirat, sprache) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          o.id,
          propertyId,
          strOrNull(oRec["anrede"]),
          strOrNull(oRec["vorname"]),
          strOrNull(oRec["nachname"]),
          strOrNull(oRec["firma"]),
          strOrNull(oRec["strasse"]),
          strOrNull(oRec["plz"]),
          strOrNull(oRec["ort"]),
          strOrNull(oRec["land"]),
          strOrNull(oRec["email"]),
          strOrNull(oRec["telefon"]),
          strOrNull(oRec["iban"]),
          strOrNull(oRec["bic"]),
          o.selbstnutzer ? 1 : 0,
          o.sev_mandat ? 1 : 0,
          o.beirat ? 1 : 0,
          strOrNull(oRec["sprache"])
        )
    );
    for (const uid of o.einheit_ids) {
      stmts.push(
        db
          .prepare("INSERT INTO owner_units (owner_id, unit_id) VALUES (?, ?)")
          .bind(o.id, uid)
      );
    }
  }

  // Tenants
  for (const t of Object.values(erp.tenants) as ErpTenant[]) {
    const tRec = t as unknown as Record<string, unknown>;
    stmts.push(
      db
        .prepare(
          "INSERT INTO tenants (id, property_id, anrede, vorname, nachname, email, telefon, einheit_id, eigentuemer_id, mietbeginn, mietende, kaltmiete, nk_vorauszahlung, kaution, iban, bic, sprache) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          t.id,
          propertyId,
          strOrNull(tRec["anrede"]),
          strOrNull(tRec["vorname"]),
          strOrNull(tRec["nachname"]),
          strOrNull(tRec["email"]),
          strOrNull(tRec["telefon"]),
          strOrNull(tRec["einheit_id"]),
          strOrNull(tRec["eigentuemer_id"]),
          strOrNull(tRec["mietbeginn"]),
          strOrNull(tRec["mietende"]),
          numOrNull(t.kaltmiete),
          numOrNull(t.nk_vorauszahlung),
          numOrNull(t.kaution),
          strOrNull(tRec["iban"]),
          strOrNull(tRec["bic"]),
          strOrNull(tRec["sprache"])
        )
    );
  }

  // Service providers
  for (const pr of Object.values(erp.service_providers) as ErpProvider[]) {
    const prRec = pr as unknown as Record<string, unknown>;
    stmts.push(
      db
        .prepare(
          "INSERT INTO service_providers (id, property_id, firma, branche, ansprechpartner, email, telefon, strasse, plz, ort, land, iban, bic, ust_id, steuernummer, stil, sprache, vertrag_monatlich, stundensatz) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          pr.id,
          propertyId,
          strOrNull(pr.firma),
          strOrNull(pr.branche),
          strOrNull(prRec["ansprechpartner"]),
          strOrNull(prRec["email"]),
          strOrNull(prRec["telefon"]),
          strOrNull(prRec["strasse"]),
          strOrNull(prRec["plz"]),
          strOrNull(prRec["ort"]),
          strOrNull(prRec["land"]),
          strOrNull(prRec["iban"]),
          strOrNull(prRec["bic"]),
          strOrNull(prRec["ust_id"]),
          strOrNull(prRec["steuernummer"]),
          strOrNull(prRec["stil"]),
          strOrNull(prRec["sprache"]),
          numOrNull(pr.vertrag_monatlich),
          numOrNull(pr.stundensatz)
        )
    );
  }

  await db.batch(stmts);
  // After a fresh /init, the units may have changed; bust the unit-alias
  // cache so the next routing call picks up the new rows.
  invalidateUnitAliasCache();
}

/* -------------------------------------------------------------------------
 * Routing helpers, D1-backed
 * Replaces the old static stammdaten-map.ts. Same shapes, but resolved live
 * from D1 so adding a new property no longer requires a redeploy.
 * ----------------------------------------------------------------------- */

export interface EmailHint {
  kind: "owner" | "tenant" | "provider";
  id: string;
  propertyId: string;
  unitIds: string[];
}

export interface UnitAlias {
  unitId: string;
  aliases: string[];
}

/**
 * Look up a batch of emails across owners, tenants, and service_providers.
 * Returns a map keyed by lowercased email so callers can intersect with the
 * inbound message participants. Empty input returns an empty map. One round
 * trip per entity type plus one for owner_units.
 */
export async function lookupEmailHints(
  db: D1Database,
  emails: string[]
): Promise<Record<string, EmailHint[]>> {
  const out: Record<string, EmailHint[]> = {};
  const lc = [...new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean))];
  if (lc.length === 0) return out;
  const placeholders = lc.map(() => "?").join(",");

  const [owners, tenants, providers] = await Promise.all([
    db
      .prepare(
        `SELECT lower(email) AS email, id, property_id FROM owners WHERE lower(email) IN (${placeholders})`
      )
      .bind(...lc)
      .all<{ email: string; id: string; property_id: string }>(),
    db
      .prepare(
        `SELECT lower(email) AS email, id, property_id, einheit_id FROM tenants WHERE lower(email) IN (${placeholders})`
      )
      .bind(...lc)
      .all<{ email: string; id: string; property_id: string; einheit_id: string | null }>(),
    db
      .prepare(
        `SELECT lower(email) AS email, id, property_id FROM service_providers WHERE lower(email) IN (${placeholders})`
      )
      .bind(...lc)
      .all<{ email: string; id: string; property_id: string }>(),
  ]);

  const ownerIds = owners.results.map((o) => o.id);
  const ownerUnitsMap: Record<string, string[]> = {};
  if (ownerIds.length) {
    const ph = ownerIds.map(() => "?").join(",");
    const ou = await db
      .prepare(
        `SELECT owner_id, unit_id FROM owner_units WHERE owner_id IN (${ph}) ORDER BY owner_id, unit_id`
      )
      .bind(...ownerIds)
      .all<{ owner_id: string; unit_id: string }>();
    for (const r of ou.results) (ownerUnitsMap[r.owner_id] ??= []).push(r.unit_id);
  }

  for (const o of owners.results) {
    (out[o.email] ??= []).push({
      kind: "owner",
      id: o.id,
      propertyId: o.property_id,
      unitIds: ownerUnitsMap[o.id] ?? [],
    });
  }
  for (const t of tenants.results) {
    (out[t.email] ??= []).push({
      kind: "tenant",
      id: t.id,
      propertyId: t.property_id,
      unitIds: t.einheit_id ? [t.einheit_id] : [],
    });
  }
  for (const p of providers.results) {
    (out[p.email] ??= []).push({
      kind: "provider",
      id: p.id,
      propertyId: p.property_id,
      unitIds: [],
    });
  }
  return out;
}

let aliasCache: { ts: number; data: UnitAlias[] } | null = null;
const ALIAS_TTL_MS = 60_000;

/**
 * Per-unit alias list ("EH-029" → ["EH-029","WE 29","WE-29","WE29"]) for the
 * subject/body free-text scan in the routing layer. Cached for 60s; D1 has
 * the canonical units table now, so a CSV change rerun no longer requires
 * regenerating a stammdaten-map file.
 */
export async function listUnitAliases(db: D1Database): Promise<UnitAlias[]> {
  const now = Date.now();
  if (aliasCache && now - aliasCache.ts < ALIAS_TTL_MS) return aliasCache.data;
  const res = await db
    .prepare("SELECT id, einheit_nr FROM units ORDER BY id")
    .all<{ id: string; einheit_nr: string | null }>();
  const data = res.results.map(buildAliasesForUnit);
  aliasCache = { ts: now, data };
  return data;
}

/** Bust the unit-alias cache. Call after /init when D1 may have new units. */
export function invalidateUnitAliasCache(): void {
  aliasCache = null;
}

function buildAliasesForUnit(u: { id: string; einheit_nr: string | null }): UnitAlias {
  const aliases = new Set<string>([u.id]);
  const nr = u.einheit_nr?.trim();
  if (nr) {
    const m = /^([A-Za-z]+)\s*0*(\d+)$/.exec(nr);
    if (m) {
      const tag = m[1].toUpperCase();
      // Match the original stammdaten-map format: zero-padded number after the
      // tag. The CSV "WE 01" pattern is the canonical source.
      const padded = nr.replace(/^[A-Za-z]+\s*/, "");
      aliases.add(`${tag} ${padded}`);
      aliases.add(`${tag}-${padded}`);
      aliases.add(`${tag}${padded}`);
    } else {
      aliases.add(nr);
    }
  }
  return { unitId: u.id, aliases: [...aliases] };
}
