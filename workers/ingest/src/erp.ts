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
