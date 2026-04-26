/**
 * Render-time projection of ERP master data.
 *
 * The property.md emits placeholder tokens like `{{erp.buildings(LIE-001)}}`
 * for each ERP-derived section. This post-processor finds those tokens in
 * reading view, hits the worker's `/vaults/:id/erp` endpoint, and replaces
 * each token with a rendered HTML table. Tokens stay visible verbatim in
 * source mode, which is the right signal: they are templates, not data.
 *
 * Local edits to the rendered tables don't propagate, because the post-
 * processed HTML is non-editable. The only way to change what a reader sees
 * is to change the underlying ERP record. The worker's gate also refuses to
 * patch sections marked `<!-- erp:snapshot, no-patch -->`, so an inbound
 * email about an owner change can never silently overwrite a stale table.
 */

import type BuenaPlugin from "../main";
import { fetchErpSnapshot, RemoteErpSnapshot } from "./api";

const TOKEN_REGEX = /\{\{erp\.([a-zA-Z]+)\(([A-Z0-9-]+)\)\}\}/;
const CACHE_TTL_MS = 60_000;

interface CachedSnapshot {
  fetchedAt: number;
  promise: Promise<RemoteErpSnapshot | null>;
}

const cache = new Map<string, CachedSnapshot>();

function cacheKey(workerUrl: string, propertyId: string): string {
  return `${workerUrl}::${propertyId}`;
}

/**
 * Fetch (or reuse) a snapshot for the property id baked into the token. Each
 * property has its own cache entry, so a vault with multiple properties open
 * does not leak rows from one into another.
 */
async function getCachedSnapshot(
  plugin: BuenaPlugin,
  propertyId: string
): Promise<RemoteErpSnapshot | null> {
  const settings = plugin.settings;
  const key = cacheKey(settings.workerUrl, propertyId);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.promise;
  const promise = fetchErpSnapshot(settings, propertyId).catch((err) => {
    console.warn("[Buena] erp snapshot fetch failed", { propertyId, err });
    return null;
  });
  cache.set(key, { fetchedAt: now, promise });
  return promise;
}

/**
 * Force the next render to refetch. Call this when a sync completes so the
 * sidebar refresh button also refreshes the projection.
 */
export function invalidateErpProjectionCache(): void {
  cache.clear();
}

/**
 * Fetch (or reuse) the ERP snapshot for a property. Public because main.ts
 * uses it to drive both the inline `@EIG-001` chip resolver (ErpStore) and
 * the projection cache from a single shared fetch path.
 *
 * Returns the snapshot or null if D1 doesn't have it yet.
 */
export async function loadErpForProperty(
  plugin: BuenaPlugin,
  propertyId: string
): Promise<RemoteErpSnapshot | null> {
  return getCachedSnapshot(plugin, propertyId);
}

/** Back-compat alias kept for any other call sites. */
export const prewarmErpProjection = loadErpForProperty;

export function registerErpProjectionProcessor(plugin: BuenaPlugin): void {
  plugin.registerMarkdownPostProcessor(async (el) => {
    const targets = collectTokenElements(el);
    if (targets.length === 0) return;

    // Group tokens by property id so we hit /erp at most once per property
    // per render pass even if a file is mixing property snapshots.
    const byProperty = new Map<string, TokenTarget[]>();
    for (const t of targets) {
      if (!byProperty.has(t.propertyId)) byProperty.set(t.propertyId, []);
      byProperty.get(t.propertyId)!.push(t);
    }

    for (const [propertyId, group] of byProperty) {
      const snapshot = await getCachedSnapshot(plugin, propertyId);
      if (!snapshot) {
        for (const t of group) markUnavailable(t.element);
        continue;
      }
      for (const target of group) {
        const rendered = renderProjection(target.kind, snapshot);
        if (rendered) target.element.replaceWith(rendered);
      }
    }
  });
}

interface TokenTarget {
  element: HTMLElement;
  kind: string;
  propertyId: string;
}

function collectTokenElements(root: HTMLElement): TokenTarget[] {
  const out: TokenTarget[] = [];
  const blocks = root.querySelectorAll("p, div");
  for (const node of Array.from(blocks)) {
    const text = (node.textContent ?? "").trim();
    if (!text) continue;
    const m = TOKEN_REGEX.exec(text);
    if (!m) continue;
    if (text !== m[0]) continue;
    out.push({ element: node as HTMLElement, kind: m[1], propertyId: m[2] });
  }
  return out;
}

function markUnavailable(el: HTMLElement): void {
  const wrap = document.createElement("div");
  wrap.className = "buena-erp-projection-error";
  wrap.textContent = "ERP snapshot unavailable. Check the worker connection.";
  el.replaceWith(wrap);
}

function renderProjection(kind: string, snapshot: RemoteErpSnapshot): HTMLElement | null {
  const erp = snapshot.erp;
  const wrap = document.createElement("div");
  wrap.className = "buena-erp-projection";
  wrap.setAttribute("data-kind", kind);
  wrap.appendChild(renderFreshness(snapshot.generatedAt));

  switch (kind) {
    case "buildings":
      wrap.appendChild(renderBuildings(erp));
      return wrap;
    case "owners":
      wrap.appendChild(renderOwners(erp));
      return wrap;
    case "serviceProviders":
      wrap.appendChild(renderProviders(erp));
      return wrap;
    case "financials":
      wrap.appendChild(renderFinancials(erp));
      return wrap;
    case "units":
      wrap.appendChild(renderUnits(erp));
      return wrap;
    default:
      console.warn("[Buena] unknown erp projection kind:", kind);
      return null;
  }
}

function renderFreshness(generatedAt: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "buena-erp-projection-freshness";
  const ts = new Date(generatedAt);
  const display = isNaN(ts.getTime())
    ? generatedAt
    : ts.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
  el.textContent = `Live from ERP, snapshot ${display}`;
  return el;
}

function buildTable(headers: string[], rows: string[][]): HTMLElement {
  const table = document.createElement("table");
  table.className = "buena-erp-projection-table";
  const thead = table.createTHead();
  const headRow = thead.insertRow();
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.appendChild(th);
  }
  const tbody = table.createTBody();
  for (const row of rows) {
    const tr = tbody.insertRow();
    for (const cell of row) {
      const td = tr.insertCell();
      td.textContent = cell;
    }
  }
  return table;
}

function buildDetails(summary: string, body: HTMLElement, opens = false): HTMLElement {
  const details = document.createElement("details");
  if (opens) details.setAttribute("open", "");
  const sum = document.createElement("summary");
  sum.textContent = summary;
  details.appendChild(sum);
  details.appendChild(body);
  return details;
}

function renderBuildings(erp: RemoteErpSnapshot["erp"]): HTMLElement {
  const buildings = Object.values(erp.buildings);
  const rows = buildings.map((b) => [
    String(b.id),
    String(b.hausnr ?? ""),
    String(b.einheiten ?? ""),
    String(b.etagen ?? ""),
    b.fahrstuhl ? "Yes" : "No",
    String(b.baujahr ?? ""),
  ]);
  const table = buildTable(["Building ID", "House no.", "Units", "Floors", "Elevator", "Year"], rows);
  return buildDetails(`${buildings.length} buildings`, table, true);
}

function renderOwners(erp: RemoteErpSnapshot["erp"]): HTMLElement {
  const owners = Object.values(erp.owners);
  const beirat = owners.filter((o) => Boolean(o.beirat));
  const selbstnutzer = owners.filter((o) => Boolean(o.selbstnutzer));

  const wrap = document.createElement("div");
  wrap.className = "buena-erp-projection-owners";

  const seatLine = document.createElement("p");
  seatLine.textContent = `Beirat seats: ${
    beirat.length ? beirat.map((o) => o.id).join(", ") : "None"
  }`;
  wrap.appendChild(seatLine);

  const selfLine = document.createElement("p");
  selfLine.textContent = `Self-occupied owners: ${selbstnutzer.length} of ${owners.length}`;
  wrap.appendChild(selfLine);

  const rows = owners.map((o) => [
    String(o.id),
    ownerLabel(o),
    Array.isArray(o.einheit_ids) ? o.einheit_ids.join(", ") : "",
    ownerRole(o),
  ]);
  const table = buildTable(["Owner ID", "Name", "Units", "Role"], rows);
  wrap.appendChild(buildDetails(`${owners.length} owners`, table));
  return wrap;
}

function renderProviders(erp: RemoteErpSnapshot["erp"]): HTMLElement {
  const providers = Object.values(erp.service_providers);
  const rows = providers.map((p) => [
    String(p.id),
    String(p.branche ?? ""),
    String(p.firma ?? ""),
    providerContract(p),
  ]);
  const table = buildTable(["Provider ID", "Category", "Name", "Contract"], rows);
  return buildDetails(`${providers.length} service providers`, table);
}

function renderFinancials(erp: RemoteErpSnapshot["erp"]): HTMLElement {
  const prop = erp.property as Record<string, unknown>;
  const rows: string[][] = [
    [
      "WEG account",
      String(prop["weg_bankkonto_iban"] ?? ""),
      String(prop["weg_bankkonto_bank"] ?? ""),
    ],
    ["Reserve", String(prop["ruecklage_iban"] ?? ""), "Reserve account"],
  ];
  return buildTable(["Account", "IBAN", "Bank"], rows);
}

function renderUnits(erp: RemoteErpSnapshot["erp"]): HTMLElement {
  const units = Object.values(erp.units);
  const tenants = Object.values(erp.tenants);
  const owners = Object.values(erp.owners);

  const unitTenant = new Map<string, Record<string, unknown>>();
  for (const t of tenants) {
    const uid = (t as Record<string, unknown>)["einheit_id"];
    if (typeof uid === "string") unitTenant.set(uid, t);
  }
  const unitOwner = new Map<string, Record<string, unknown>>();
  for (const o of owners) {
    const ids = (o as Record<string, unknown>)["einheit_ids"];
    if (Array.isArray(ids)) {
      for (const uid of ids) if (typeof uid === "string") unitOwner.set(uid, o);
    }
  }

  const occupant = (uid: string): string => {
    const t = unitTenant.get(uid);
    if (t) return `Tenant ${t["id"]}`;
    const o = unitOwner.get(uid);
    if (o && o["selbstnutzer"]) return `Owner occupied ${o["id"]}`;
    if (o) return `Owner ${o["id"]}`;
    return "Vacant";
  };

  const byBuilding = new Map<string, Record<string, unknown>[]>();
  for (const u of units) {
    const bid = String((u as Record<string, unknown>)["haus_id"] ?? "");
    if (!byBuilding.has(bid)) byBuilding.set(bid, []);
    byBuilding.get(bid)!.push(u);
  }
  const buildingIds = Array.from(byBuilding.keys()).sort();

  const wrap = document.createElement("div");
  wrap.className = "buena-erp-projection-units";

  buildingIds.forEach((bid, idx) => {
    const list = (byBuilding.get(bid) ?? [])
      .slice()
      .sort((a, b) =>
        String((a as Record<string, unknown>)["einheit_nr"] ?? "").localeCompare(
          String((b as Record<string, unknown>)["einheit_nr"] ?? "")
        )
      );
    const rows = list.map((u) => {
      const r = u as Record<string, unknown>;
      const area = r["wohnflaeche_qm"];
      return [
        String(r["id"]),
        String(r["einheit_nr"] ?? ""),
        String(r["lage"] ?? ""),
        String(r["typ"] ?? ""),
        typeof area === "number" ? `${area.toFixed(1)} m²` : "",
        occupant(String(r["id"])),
      ];
    });
    const table = buildTable(
      ["Unit ID", "Unit no.", "Lage", "Type", "Area", "Occupancy"],
      rows
    );
    wrap.appendChild(buildDetails(`${bid} (${list.length} units)`, table, idx === 0));
  });

  return wrap;
}

function ownerLabel(o: Record<string, unknown>): string {
  const firma = String(o["firma"] ?? "").trim();
  if (firma) return firma;
  const parts = [o["vorname"], o["nachname"]].filter((p) => typeof p === "string" && p.trim()).join(" ");
  return parts || String(o["id"] ?? "");
}

function ownerRole(o: Record<string, unknown>): string {
  const tags: string[] = [];
  if (o["beirat"]) tags.push("Beirat");
  if (o["selbstnutzer"]) tags.push("Selbstnutzer");
  if (o["sev_mandat"]) tags.push("SEV");
  return tags.length ? tags.join(", ") : "Eigentümer";
}

function providerContract(p: Record<string, unknown>): string {
  const monthly = p["vertrag_monatlich"];
  const hourly = p["stundensatz"];
  if (typeof monthly === "number" && monthly > 0) {
    return `€${Math.round(monthly).toLocaleString("en-US")}/mo`;
  }
  if (typeof hourly === "number" && hourly > 0) {
    return `€${Math.round(hourly).toLocaleString("en-US")}/h`;
  }
  return "On demand";
}
