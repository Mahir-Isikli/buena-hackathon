import { App, TAbstractFile, TFile } from "obsidian";

/**
 * ERP data loader.
 *
 * Reads erp.json from the vault root, caches the parsed object, and refreshes
 * automatically when the file is modified. Markdown content references ERP
 * entities by ID only (e.g. `@EIG-004`, ```buena-erp ... ```), and the renderer
 * resolves the display via this cache.
 */

export type ErpKind = "owner" | "tenant" | "unit" | "provider" | "building" | "property";

export interface ErpProperty {
  id: string;
  name: string;
  strasse?: string;
  plz?: string;
  ort?: string;
  baujahr?: number;
  sanierung?: number;
  verwalter?: string;
  verwalter_email?: string;
  verwalter_telefon?: string;
  weg_bankkonto_iban?: string;
  ruecklage_iban?: string;
}

export interface ErpBuilding {
  id: string;
  hausnr?: string;
  einheiten?: number;
  etagen?: number;
  fahrstuhl?: boolean;
  baujahr?: number;
}

export interface ErpUnit {
  id: string;
  haus_id?: string;
  einheit_nr?: string;
  lage?: string;
  typ?: string;
  wohnflaeche_qm?: number;
  zimmer?: number;
  miteigentumsanteil?: number;
}

export interface ErpOwner {
  id: string;
  anrede?: string;
  vorname?: string;
  nachname?: string;
  firma?: string;
  email?: string;
  telefon?: string;
  strasse?: string;
  plz?: string;
  ort?: string;
  iban?: string;
  einheit_ids?: string[];
  selbstnutzer?: boolean;
  sev_mandat?: boolean;
  beirat?: boolean;
}

export interface ErpTenant {
  id: string;
  anrede?: string;
  vorname?: string;
  nachname?: string;
  email?: string;
  telefon?: string;
  einheit_id?: string;
  eigentuemer_id?: string;
  mietbeginn?: string;
  mietende?: string;
  kaltmiete?: number;
  nk_vorauszahlung?: number;
  kaution?: number;
}

export interface ErpProvider {
  id: string;
  firma?: string;
  branche?: string;
  ansprechpartner?: string;
  email?: string;
  telefon?: string;
  iban?: string;
  vertrag_monatlich?: number;
  stundensatz?: number;
}

export interface ErpData {
  property?: ErpProperty;
  buildings?: Record<string, ErpBuilding>;
  units?: Record<string, ErpUnit>;
  owners?: Record<string, ErpOwner>;
  tenants?: Record<string, ErpTenant>;
  service_providers?: Record<string, ErpProvider>;
}

export interface ResolvedErp {
  kind: ErpKind;
  id: string;
  label: string; // short, used in chip
  sub?: string; // optional secondary line
  raw: any;
}

const ERP_FILENAME = "erp.json";

class ErpStore {
  private app: App;
  private data: ErpData = {};
  private loaded = false;
  private listeners = new Set<() => void>();

  constructor(app: App) {
    this.app = app;
  }

  async load(): Promise<void> {
    const file = this.findErpFile();
    if (!file) {
      this.data = {};
      this.loaded = true;
      return;
    }
    try {
      const text = await this.app.vault.read(file);
      this.data = JSON.parse(text) as ErpData;
      this.loaded = true;
      this.fire();
    } catch (err) {
      console.warn("[Buena] failed to parse erp.json", err);
      this.data = {};
      this.loaded = true;
    }
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private fire() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        console.warn("[Buena] erp listener failed", err);
      }
    }
  }

  private findErpFile(): TFile | null {
    // Look for erp.json next to the property markdown in the vault root.
    const direct = this.app.vault.getAbstractFileByPath(ERP_FILENAME);
    if (direct && direct instanceof TFile) return direct;
    // Fallback: search the entire vault for any erp.json.
    const all = this.app.vault.getFiles();
    for (const f of all) {
      if (f.name === ERP_FILENAME) return f;
    }
    return null;
  }

  /**
   * Get the property record (single LIE-xxx in this vault).
   */
  property(): ErpProperty | null {
    return this.data.property ?? null;
  }

  /**
   * For a unit id, find who occupies it.
   * Returns the resolved occupant + role, or null if vacant/unknown.
   *   - role 'tenant'           : leased to MIE-xxx
   *   - role 'self_occupied'    : owner lives there
   *   - role 'owner_landlord'   : owner rents it out (tenant unknown / TG)
   */
  occupant(
    unitId: string
  ): { resolved: ResolvedErp; role: "tenant" | "self_occupied" | "owner_landlord" } | null {
    const id = unitId.replace(/^@/, "").trim().toUpperCase();
    // Tenant lookup
    if (this.data.tenants) {
      for (const t of Object.values(this.data.tenants)) {
        if (t.einheit_id === id) {
          const r = this.resolve(t.id);
          if (r) return { resolved: r, role: "tenant" };
        }
      }
    }
    // Owner lookup
    if (this.data.owners) {
      for (const o of Object.values(this.data.owners)) {
        if (o.einheit_ids?.includes(id)) {
          const r = this.resolve(o.id);
          if (r)
            return {
              resolved: r,
              role: o.selbstnutzer ? "self_occupied" : "owner_landlord",
            };
        }
      }
    }
    return null;
  }

  /**
   * Resolve a reference like `@EIG-004` or `EIG-004` to a display + raw record.
   * Returns null if the id is unknown.
   */
  resolve(rawId: string): ResolvedErp | null {
    const id = rawId.replace(/^@/, "").trim().toUpperCase();
    if (!id) return null;

    const prefix = id.split("-")[0];
    switch (prefix) {
      case "EIG": {
        const o = this.data.owners?.[id];
        if (!o) return null;
        return {
          kind: "owner",
          id,
          label: ownerLabel(o),
          sub: ownerSub(o),
          raw: o,
        };
      }
      case "MIE":
      case "MV": {
        const t = this.data.tenants?.[id];
        if (!t) return null;
        return {
          kind: "tenant",
          id,
          label: personLabel(t.anrede, t.vorname, t.nachname),
          sub: t.einheit_id ? `Mieter · ${t.einheit_id}` : "Mieter",
          raw: t,
        };
      }
      case "EH": {
        const u = this.data.units?.[id];
        if (!u) return null;
        return {
          kind: "unit",
          id,
          label: u.einheit_nr ? `${id} · ${u.einheit_nr}` : id,
          sub: unitSub(u),
          raw: u,
        };
      }
      case "DL": {
        const p = this.data.service_providers?.[id];
        if (!p) return null;
        return {
          kind: "provider",
          id,
          label: p.firma ?? id,
          sub: p.branche,
          raw: p,
        };
      }
      case "HAUS": {
        const b = this.data.buildings?.[id];
        if (!b) return null;
        return {
          kind: "building",
          id,
          label: b.hausnr ? `Haus ${b.hausnr}` : id,
          sub: buildingSub(b),
          raw: b,
        };
      }
      case "LIE": {
        const p = this.data.property;
        if (!p || p.id !== id) return null;
        return {
          kind: "property",
          id,
          label: p.name,
          sub: p.strasse ? `${p.strasse}, ${p.plz ?? ""} ${p.ort ?? ""}`.trim() : undefined,
          raw: p,
        };
      }
      default:
        return null;
    }
  }
}

let singleton: ErpStore | null = null;

export function initErpStore(app: App): ErpStore {
  if (!singleton) singleton = new ErpStore(app);
  return singleton;
}

export function getErpStore(): ErpStore | null {
  return singleton;
}

export function watchErpFile(app: App, onChange: () => void): () => void {
  const handler = (file: TAbstractFile) => {
    if (file.name === ERP_FILENAME) onChange();
  };
  app.vault.on("modify", handler);
  app.vault.on("create", handler);
  app.vault.on("delete", handler);
  return () => {
    app.vault.off("modify", handler);
    app.vault.off("create", handler);
    app.vault.off("delete", handler);
  };
}

// ---- formatters --------------------------------------------------------

function personLabel(anrede?: string, vorname?: string, nachname?: string): string {
  const parts = [anrede, vorname, nachname].filter((s) => !!s && s.trim().length > 0);
  return parts.join(" ").trim() || "(unbenannt)";
}

function ownerLabel(o: ErpOwner): string {
  if (o.firma && o.firma.trim().length > 0) return o.firma;
  return personLabel(o.anrede, o.vorname, o.nachname);
}

function ownerSub(o: ErpOwner): string | undefined {
  const tags: string[] = [];
  if (o.beirat) tags.push("Beirat");
  if (o.selbstnutzer) tags.push("Selbstnutzer");
  if (o.sev_mandat) tags.push("SEV");
  const units = o.einheit_ids ?? [];
  const unitTxt = units.length
    ? `${units.length} Einheit${units.length === 1 ? "" : "en"}`
    : undefined;
  const all = [unitTxt, ...tags].filter(Boolean) as string[];
  return all.length ? all.join(" · ") : undefined;
}

function unitSub(u: ErpUnit): string | undefined {
  const parts: string[] = [];
  if (u.lage) parts.push(u.lage);
  if (typeof u.wohnflaeche_qm === "number") parts.push(`${u.wohnflaeche_qm} m²`);
  if (typeof u.zimmer === "number") parts.push(`${u.zimmer} Zi.`);
  return parts.length ? parts.join(" · ") : undefined;
}

function buildingSub(b: ErpBuilding): string | undefined {
  const parts: string[] = [];
  if (typeof b.einheiten === "number") parts.push(`${b.einheiten} units`);
  if (typeof b.etagen === "number") parts.push(`${b.etagen} floors`);
  if (b.fahrstuhl != null) parts.push(b.fahrstuhl ? "elevator" : "no elevator");
  return parts.length ? parts.join(" · ") : undefined;
}

// ---- hover field builder (used by chip + block) ------------------------

export function buildHoverFields(
  r: ResolvedErp
): { label: string; value: string; mono?: boolean }[] {
  const fields: { label: string; value: string; mono?: boolean }[] = [];
  fields.push({ label: "ID", value: r.id, mono: true });
  fields.push({ label: kindLabel(r.kind), value: r.label });

  switch (r.kind) {
    case "owner": {
      const o = r.raw as ErpOwner;
      if (o.firma && (o.vorname || o.nachname))
        fields.push({ label: "Contact", value: personLabel(o.anrede, o.vorname, o.nachname) });
      if (o.email) fields.push({ label: "Email", value: o.email });
      if (o.telefon) fields.push({ label: "Phone", value: o.telefon });
      const addr = [o.strasse, [o.plz, o.ort].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
      if (addr) fields.push({ label: "Address", value: addr });
      if (o.iban) fields.push({ label: "IBAN", value: o.iban, mono: true });
      if (o.einheit_ids?.length)
        fields.push({ label: "Units", value: o.einheit_ids.join(", "), mono: true });
      const flags: string[] = [];
      if (o.beirat) flags.push("Beirat");
      if (o.selbstnutzer) flags.push("Selbstnutzer");
      if (o.sev_mandat) flags.push("SEV-Mandat");
      if (flags.length) fields.push({ label: "Tags", value: flags.join(", ") });
      break;
    }
    case "tenant": {
      const t = r.raw as ErpTenant;
      if (t.email) fields.push({ label: "Email", value: t.email });
      if (t.telefon) fields.push({ label: "Phone", value: t.telefon });
      if (t.einheit_id) fields.push({ label: "Unit", value: t.einheit_id, mono: true });
      if (t.eigentuemer_id)
        fields.push({ label: "Owner", value: t.eigentuemer_id, mono: true });
      if (t.mietbeginn) fields.push({ label: "Lease since", value: t.mietbeginn });
      if (t.mietende) fields.push({ label: "Lease end", value: t.mietende });
      if (typeof t.kaltmiete === "number")
        fields.push({ label: "Kaltmiete", value: `${t.kaltmiete.toFixed(2)} €` });
      if (typeof t.kaution === "number")
        fields.push({ label: "Kaution", value: `${t.kaution.toFixed(2)} €` });
      break;
    }
    case "unit": {
      const u = r.raw as ErpUnit;
      if (u.haus_id) fields.push({ label: "Building", value: u.haus_id, mono: true });
      if (u.einheit_nr) fields.push({ label: "Unit no.", value: u.einheit_nr });
      if (u.lage) fields.push({ label: "Lage", value: u.lage });
      if (u.typ) fields.push({ label: "Typ", value: u.typ });
      if (typeof u.wohnflaeche_qm === "number")
        fields.push({ label: "Fläche", value: `${u.wohnflaeche_qm} m²` });
      if (typeof u.zimmer === "number")
        fields.push({ label: "Zimmer", value: `${u.zimmer}` });
      if (typeof u.miteigentumsanteil === "number")
        fields.push({ label: "MEA", value: `${u.miteigentumsanteil}/10000` });
      break;
    }
    case "provider": {
      const p = r.raw as ErpProvider;
      if (p.branche) fields.push({ label: "Branche", value: p.branche });
      if (p.ansprechpartner)
        fields.push({ label: "Contact", value: p.ansprechpartner });
      if (p.email) fields.push({ label: "Email", value: p.email });
      if (p.telefon) fields.push({ label: "Phone", value: p.telefon });
      if (typeof p.vertrag_monatlich === "number")
        fields.push({
          label: "Vertrag",
          value: `${p.vertrag_monatlich.toFixed(2)} €/Mo.`,
        });
      if (typeof p.stundensatz === "number")
        fields.push({ label: "Stundensatz", value: `${p.stundensatz.toFixed(2)} €` });
      if (p.iban) fields.push({ label: "IBAN", value: p.iban, mono: true });
      break;
    }
    case "building": {
      const b = r.raw as ErpBuilding;
      if (b.hausnr) fields.push({ label: "Hausnr.", value: b.hausnr });
      if (typeof b.einheiten === "number")
        fields.push({ label: "Einheiten", value: `${b.einheiten}` });
      if (typeof b.etagen === "number")
        fields.push({ label: "Etagen", value: `${b.etagen}` });
      if (b.fahrstuhl != null)
        fields.push({ label: "Fahrstuhl", value: b.fahrstuhl ? "ja" : "nein" });
      if (typeof b.baujahr === "number")
        fields.push({ label: "Baujahr", value: `${b.baujahr}` });
      break;
    }
    case "property": {
      const p = r.raw as ErpProperty;
      if (p.strasse)
        fields.push({
          label: "Address",
          value: `${p.strasse}, ${p.plz ?? ""} ${p.ort ?? ""}`.trim(),
        });
      if (p.verwalter) fields.push({ label: "Verwalter", value: p.verwalter });
      if (p.weg_bankkonto_iban)
        fields.push({ label: "WEG IBAN", value: p.weg_bankkonto_iban, mono: true });
      if (p.ruecklage_iban)
        fields.push({ label: "Rücklage", value: p.ruecklage_iban, mono: true });
      break;
    }
  }

  return fields;
}

export function kindLabel(kind: ErpKind): string {
  switch (kind) {
    case "owner":
      return "Eigentümer";
    case "tenant":
      return "Mieter";
    case "unit":
      return "Einheit";
    case "provider":
      return "Dienstleister";
    case "building":
      return "Gebäude";
    case "property":
      return "Liegenschaft";
  }
}

export function kindIcon(kind: ErpKind): string {
  switch (kind) {
    case "owner":
      return "👤";
    case "tenant":
      return "🔑";
    case "unit":
      return "🚪";
    case "provider":
      return "🔧";
    case "building":
      return "🏢";
    case "property":
      return "🏛";
  }
}
