import { parseYaml } from "obsidian";
import type BuenaPlugin from "../main";
import { attachHoverPopover } from "./hover";
import {
  buildHoverFields,
  getErpStore,
  kindIcon,
  kindLabel,
  ResolvedErp,
} from "./erp";

/**
 * ERP rendering layer for the Buena plugin.
 *
 * Inline chips: `@EIG-004` style refs in markdown get replaced with rich
 * pills (kind icon + label + id), with hover popover.
 *
 * Block cards (```buena-erp``` codeblock): supports several layouts so
 * the same primitive can render the entire vault:
 *
 *   layout: card  (default, single full card)
 *     id: LIE-001
 *
 *   layout: cards (multiple full cards stacked)
 *     ids: [DL-001, DL-002, ...]
 *
 *   layout: grid  (compact head-only cards in a 2-col grid)
 *     ids: [EIG-004, EIG-010, EIG-020]
 *
 *   layout: units (unit + auto-resolved occupant rows)
 *     ids: [EH-001, EH-002, ...]
 *
 *   layout: bank  (special: pulls IBANs off the property record)
 *     id: LIE-001
 */

const REF_RE = /^@([A-Z]+-[A-Z0-9-]+)$/i;

type BlockSpec = {
  layout?: "card" | "cards" | "grid" | "units" | "bank" | "buildings" | "owners";
  id?: string;
  ids?: string[];
  filter?: "beirat" | "selbstnutzer" | "all";
};

export function registerErpReferenceProcessors(plugin: BuenaPlugin) {
  // ---- inline chip ----------------------------------------------------
  plugin.registerMarkdownPostProcessor((el) => {
    const codes = el.querySelectorAll("code");
    codes.forEach((code) => {
      // Skip code inside <pre> (real code blocks)
      if (code.parentElement && code.parentElement.tagName === "PRE") return;
      const txt = (code.textContent ?? "").trim();
      const m = REF_RE.exec(txt);
      if (!m) return;

      const store = getErpStore();
      if (!store) return;
      const resolved = store.resolve(m[1]);

      const chip = document.createElement("span");
      chip.className = "buena-erp-chip";
      if (resolved) {
        chip.classList.add(`buena-erp-chip-${resolved.kind}`);
        chip.dataset.id = resolved.id;

        const ico = document.createElement("span");
        ico.className = "buena-erp-chip-icon";
        ico.textContent = kindIcon(resolved.kind);
        chip.appendChild(ico);

        const lbl = document.createElement("span");
        lbl.className = "buena-erp-chip-label";
        lbl.textContent = resolved.label;
        chip.appendChild(lbl);

        const idEl = document.createElement("span");
        idEl.className = "buena-erp-chip-id";
        idEl.textContent = resolved.id;
        chip.appendChild(idEl);

        attachHoverPopover(chip, () => buildHoverFields(resolved));
      } else {
        chip.classList.add("buena-erp-chip-unresolved");
        chip.textContent = `@${m[1]}`;
        chip.title = "Unknown ERP reference";
      }
      code.replaceWith(chip);
    });
  });

  // ---- block card -----------------------------------------------------
  plugin.registerMarkdownCodeBlockProcessor("buena-erp", (source, el) => {
    let spec: BlockSpec = {};
    try {
      spec = (parseYaml(source) as BlockSpec) ?? {};
    } catch (err) {
      el.createEl("pre", { text: `[Buena] failed to parse buena-erp block: ${err}` });
      return;
    }

    const ids: string[] = [];
    if (spec.id) ids.push(spec.id);
    if (Array.isArray(spec.ids)) ids.push(...spec.ids);

    const store = getErpStore();
    if (!store) return;

    const layout = spec.layout ?? (ids.length > 1 ? "cards" : "card");

    switch (layout) {
      case "bank":
        renderBank(el, store);
        return;
      case "buildings":
        renderBuildings(el, ids, store);
        return;
      case "owners":
        renderOwners(el, ids, store, spec.filter ?? "all");
        return;
      case "grid":
        renderGrid(el, ids, store);
        return;
      case "units":
        renderUnits(el, ids, store);
        return;
      case "card":
      case "cards":
      default: {
        if (ids.length === 0) {
          el.createEl("pre", { text: "[Buena] buena-erp block requires `id` or `ids`" });
          return;
        }
        const wrap = el.createDiv({ cls: "buena-erp-cards" });
        for (const rawId of ids) {
          const r = store.resolve(rawId);
          if (!r) {
            const miss = wrap.createDiv({ cls: "buena-erp-card buena-erp-card-missing" });
            miss.createSpan({ text: `Unknown ERP id: ${rawId}` });
            continue;
          }
          renderCard(wrap, r);
        }
      }
    }
  });
}

function renderCard(parent: HTMLElement, r: ResolvedErp) {
  const card = parent.createDiv({ cls: `buena-erp-card buena-erp-card-${r.kind}` });

  const head = card.createDiv({ cls: "buena-erp-card-head" });
  head.createSpan({ cls: "buena-erp-card-icon", text: kindIcon(r.kind) });
  const title = head.createDiv({ cls: "buena-erp-card-title-wrap" });
  title.createDiv({ cls: "buena-erp-card-title", text: r.label });
  const meta = title.createDiv({ cls: "buena-erp-card-sub" });
  meta.createSpan({ cls: "buena-erp-card-kind", text: kindLabel(r.kind) });
  meta.createSpan({ cls: "buena-erp-card-id", text: r.id });
  if (r.sub) {
    title.createDiv({ cls: "buena-erp-card-sub2", text: r.sub });
  }

  const body = card.createDiv({ cls: "buena-erp-card-body" });
  for (const f of buildHoverFields(r)) {
    if (f.label === "ID") continue;
    if (f.label === kindLabel(r.kind)) continue;
    const row = body.createDiv({ cls: "buena-erp-card-row" });
    row.createSpan({ cls: "buena-erp-card-row-label", text: f.label });
    row.createSpan({
      cls: "buena-erp-card-row-value" + (f.mono ? " mono" : ""),
      text: f.value,
    });
  }
}

// ---- grid layout: compact cards, head + 1 sub line + id ---------------
function renderGrid(el: HTMLElement, ids: string[], store: ReturnType<typeof getErpStore>) {
  if (!store) return;
  const wrap = el.createDiv({ cls: "buena-erp-grid" });
  for (const rawId of ids) {
    const r = store.resolve(rawId);
    if (!r) {
      const miss = wrap.createDiv({ cls: "buena-erp-mini buena-erp-mini-missing" });
      miss.createSpan({ text: `?? ${rawId}` });
      continue;
    }
    const card = wrap.createDiv({ cls: `buena-erp-mini buena-erp-mini-${r.kind}` });
    card.createSpan({ cls: "buena-erp-mini-icon", text: kindIcon(r.kind) });
    const txt = card.createDiv({ cls: "buena-erp-mini-text" });
    txt.createDiv({ cls: "buena-erp-mini-title", text: r.label });
    if (r.sub) txt.createDiv({ cls: "buena-erp-mini-sub", text: r.sub });
    txt.createDiv({ cls: "buena-erp-mini-id", text: r.id });
    attachHoverPopover(card, () => buildHoverFields(r));
  }
}

// ---- units layout: clean table, minimal hover -------------------------
function renderUnits(el: HTMLElement, ids: string[], store: ReturnType<typeof getErpStore>) {
  if (!store) return;
  const wrap = el.createDiv({ cls: "buena-erp-units-table-wrap" });
  const table = wrap.createEl("table", { cls: "buena-units-table" });
  const thead = table.createEl("thead");
  const headRow = thead.createEl("tr");
  for (const label of ["Unit", "Lage", "Typ", "Fläche", "Zi.", "Occupant"]) {
    headRow.createEl("th", { text: label, cls: "buena-units-th" });
  }
  const tbody = table.createEl("tbody");

  for (const rawId of ids) {
    const r = store.resolve(rawId);
    const tr = tbody.createEl("tr", { cls: "buena-units-row" });
    if (!r) {
      const td = tr.createEl("td", {
        cls: "buena-units-td",
        attr: { colspan: "6" },
      });
      td.createSpan({ text: `Unknown unit: ${rawId}` });
      continue;
    }

    const u = r.raw as {
      einheit_nr?: string;
      lage?: string;
      typ?: string;
      wohnflaeche_qm?: number;
      zimmer?: number;
    };

    const unitTd = tr.createEl("td", { cls: "buena-units-td buena-units-td-unit" });
    const unitCell = unitTd.createDiv({ cls: "buena-units-unit-cell" });
    unitCell.createSpan({ cls: "buena-units-unit-id", text: r.id });
    if (u.einheit_nr) {
      unitCell.createSpan({ cls: "buena-units-unit-no", text: u.einheit_nr });
    }

    tr.createEl("td", {
      cls: "buena-units-td buena-units-td-lage",
      text: u.lage ?? "–",
    });

    const typTd = tr.createEl("td", { cls: "buena-units-td buena-units-td-typ" });
    if (u.typ) {
      const tag = typTd.createSpan({ cls: "buena-units-typ-pill", text: u.typ.toLowerCase() });
      tag.classList.add(`buena-units-typ-pill-${slug(u.typ)}`);
    } else {
      typTd.createSpan({ text: "–" });
    }

    tr.createEl("td", {
      cls: "buena-units-td buena-units-td-num",
      text: typeof u.wohnflaeche_qm === "number" ? `${u.wohnflaeche_qm} m²` : "–",
    });
    tr.createEl("td", {
      cls: "buena-units-td buena-units-td-num",
      text: typeof u.zimmer === "number" ? String(u.zimmer) : "–",
    });

    const occTd = tr.createEl("td", { cls: "buena-units-td buena-units-td-occ" });
    const occ = store.occupant(r.id);
    if (!occ) {
      occTd.createSpan({ cls: "buena-units-vacant", text: "Vacant" });
    } else {
      const chip = occTd.createSpan({ cls: `buena-units-occ buena-units-occ-${occ.role}` });
      chip.createSpan({ cls: "buena-units-occ-role", text: roleLabel(occ.role) });
      chip.createSpan({ cls: "buena-units-occ-label", text: occ.resolved.label });
      chip.createSpan({ cls: "buena-units-occ-id", text: occ.resolved.id });
    }
  }
}

// ---- buildings layout: comparison table for HAUS-XX ids ---------------
function renderBuildings(
  el: HTMLElement,
  ids: string[],
  store: ReturnType<typeof getErpStore>
) {
  if (!store) return;
  const wrap = el.createDiv({ cls: "buena-erp-buildings" });
  const table = wrap.createEl("table", { cls: "buena-buildings-table" });
  const thead = table.createEl("thead");
  const headRow = thead.createEl("tr");
  for (const label of ["Building", "Units", "Floors", "Elevator", "Baujahr"]) {
    headRow.createEl("th", { text: label, cls: "buena-buildings-th" });
  }
  const tbody = table.createEl("tbody");
  for (const rawId of ids) {
    const r = store.resolve(rawId);
    const tr = tbody.createEl("tr", { cls: "buena-buildings-row" });
    if (!r || r.kind !== "building") {
      const td = tr.createEl("td", {
        cls: "buena-buildings-td",
        attr: { colspan: "5" },
      });
      td.createSpan({ text: `Unknown building: ${rawId}` });
      continue;
    }
    const b = r.raw as { hausnr?: string; einheiten?: number; etagen?: number; fahrstuhl?: boolean; baujahr?: number };

    // Building cell: chip with id + label
    const buildingTd = tr.createEl("td", { cls: "buena-buildings-td buena-buildings-td-name" });
    const chip = buildingTd.createSpan({ cls: "buena-erp-chip buena-erp-chip-building" });
    chip.dataset.id = r.id;
    const ico = chip.createSpan({ cls: "buena-erp-chip-icon" });
    ico.textContent = kindIcon(r.kind);
    chip.createSpan({ cls: "buena-erp-chip-label", text: r.label });
    chip.createSpan({ cls: "buena-erp-chip-id", text: r.id });
    attachHoverPopover(chip, () => buildHoverFields(r));

    tr.createEl("td", {
      cls: "buena-buildings-td buena-buildings-td-num",
      text: typeof b.einheiten === "number" ? String(b.einheiten) : "–",
    });
    tr.createEl("td", {
      cls: "buena-buildings-td buena-buildings-td-num",
      text: typeof b.etagen === "number" ? String(b.etagen) : "–",
    });
    const elevTd = tr.createEl("td", { cls: "buena-buildings-td buena-buildings-td-bool" });
    if (b.fahrstuhl === true) {
      elevTd.createSpan({ text: "yes", cls: "buena-buildings-yes" });
    } else if (b.fahrstuhl === false) {
      elevTd.createSpan({ text: "no", cls: "buena-buildings-no" });
    } else {
      elevTd.createSpan({ text: "–" });
    }
    tr.createEl("td", {
      cls: "buena-buildings-td buena-buildings-td-num",
      text: typeof b.baujahr === "number" ? String(b.baujahr) : "–",
    });
  }
}

// ---- owners layout: comparison table with Beirat/Selbstnutzer flags ----
function renderOwners(
  el: HTMLElement,
  ids: string[],
  store: ReturnType<typeof getErpStore>,
  filter: "beirat" | "selbstnutzer" | "all"
) {
  if (!store) return;

  // If no ids supplied, pull all owners off the store.
  let ownerIds = ids;
  if (ownerIds.length === 0) {
    ownerIds = store.allOwnerIds();
  }

  const wrap = el.createDiv({ cls: "buena-erp-owners" });

  // Summary strip: total / Beirat / Selbstnutzer counts (computed from full set)
  const all = store.allOwnerIds().map((id) => store.resolve(id)).filter(Boolean) as ResolvedErp[];
  const beiratCount = all.filter((r) => (r.raw as any)?.beirat).length;
  const selbstCount = all.filter((r) => (r.raw as any)?.selbstnutzer).length;
  const summary = wrap.createDiv({ cls: "buena-owners-summary" });
  const stat = (label: string, value: string | number) => {
    const s = summary.createDiv({ cls: "buena-owners-stat" });
    s.createDiv({ cls: "buena-owners-stat-value", text: String(value) });
    s.createDiv({ cls: "buena-owners-stat-label", text: label });
  };
  stat("Total", all.length);
  stat("Beirat", beiratCount);
  stat("Selbstnutzer", selbstCount);

  const table = wrap.createEl("table", { cls: "buena-owners-table" });
  const thead = table.createEl("thead");
  const headRow = thead.createEl("tr");
  for (const label of ["Owner", "Units", "Role", "Contact"]) {
    headRow.createEl("th", { text: label, cls: "buena-owners-th" });
  }
  const tbody = table.createEl("tbody");

  for (const rawId of ownerIds) {
    const r = store.resolve(rawId);
    if (!r || r.kind !== "owner") continue;
    const o = r.raw as {
      einheit_ids?: string[];
      selbstnutzer?: boolean;
      beirat?: boolean;
      sev_mandat?: boolean;
      email?: string;
      telefon?: string;
    };
    if (filter === "beirat" && !o.beirat) continue;
    if (filter === "selbstnutzer" && !o.selbstnutzer) continue;

    const tr = tbody.createEl("tr", { cls: "buena-owners-row" });
    if (o.beirat) tr.classList.add("buena-owners-row-beirat");

    // Owner cell: chip
    const ownerTd = tr.createEl("td", { cls: "buena-owners-td buena-owners-td-name" });
    const chip = ownerTd.createSpan({ cls: "buena-erp-chip buena-erp-chip-owner" });
    chip.dataset.id = r.id;
    chip.createSpan({ cls: "buena-erp-chip-icon", text: kindIcon(r.kind) });
    chip.createSpan({ cls: "buena-erp-chip-label", text: r.label });
    chip.createSpan({ cls: "buena-erp-chip-id", text: r.id });
    attachHoverPopover(chip, () => buildHoverFields(r));

    // Units cell: list of EH-XXX pills
    const unitsTd = tr.createEl("td", { cls: "buena-owners-td buena-owners-td-units" });
    const list = o.einheit_ids ?? [];
    if (list.length === 0) {
      unitsTd.createSpan({ cls: "buena-owners-units-empty", text: "–" });
    } else {
      const ul = unitsTd.createDiv({ cls: "buena-owners-units-wrap" });
      for (const eid of list) {
        const ru = store.resolve(eid);
        const pill = ul.createSpan({ cls: "buena-owners-unit-pill" });
        pill.createSpan({ cls: "buena-owners-unit-pill-icon", text: kindIcon("unit") });
        pill.createSpan({ cls: "buena-owners-unit-pill-id", text: eid });
        if (ru) attachHoverPopover(pill, () => buildHoverFields(ru));
      }
    }

    // Role cell: flag pills
    const roleTd = tr.createEl("td", { cls: "buena-owners-td buena-owners-td-role" });
    const flags = roleTd.createDiv({ cls: "buena-owners-flags" });
    if (o.beirat) flags.createSpan({ cls: "buena-owners-flag buena-owners-flag-beirat", text: "Beirat" });
    if (o.selbstnutzer) flags.createSpan({ cls: "buena-owners-flag buena-owners-flag-selbst", text: "Selbstnutzer" });
    if (o.sev_mandat) flags.createSpan({ cls: "buena-owners-flag buena-owners-flag-sev", text: "SEV" });
    if (!o.beirat && !o.selbstnutzer && !o.sev_mandat) {
      flags.createSpan({ cls: "buena-owners-flag-empty", text: "Eigentümer" });
    }

    // Contact cell
    const contactTd = tr.createEl("td", { cls: "buena-owners-td buena-owners-td-contact" });
    if (o.email) {
      contactTd.createDiv({ cls: "buena-owners-contact-email", text: o.email });
    }
    if (o.telefon) {
      contactTd.createDiv({ cls: "buena-owners-contact-tel", text: o.telefon });
    }
    if (!o.email && !o.telefon) {
      contactTd.createSpan({ cls: "buena-owners-contact-empty", text: "–" });
    }
  }
}

// ---- bank layout: pulls IBANs off the property record ------------------
function renderBank(el: HTMLElement, store: ReturnType<typeof getErpStore>) {
  if (!store) return;
  const prop = store.property();
  if (!prop) {
    el.createEl("pre", { text: "[Buena] no property in erp.json for bank layout" });
    return;
  }

  const wrap = el.createDiv({ cls: "buena-erp-bank" });

  type BankRow = { label: string; iban?: string; bank?: string; purpose?: string };
  const rows: BankRow[] = [];
  if (prop.weg_bankkonto_iban) {
    rows.push({
      label: "WEG-Konto",
      iban: prop.weg_bankkonto_iban,
      bank: (prop as any).weg_bankkonto_bank,
      purpose: "Hausgeld · operative Liquidität",
    });
  }
  if (prop.ruecklage_iban) {
    rows.push({
      label: "Rücklage",
      iban: prop.ruecklage_iban,
      purpose: "Instandhaltungsrücklage",
    });
  }

  for (const row of rows) {
    const card = wrap.createDiv({ cls: "buena-erp-bank-row" });
    const head = card.createDiv({ cls: "buena-erp-bank-head" });
    head.createSpan({ cls: "buena-erp-bank-icon", text: "🏦" });
    head.createSpan({ cls: "buena-erp-bank-label", text: row.label });
    if (row.bank) head.createSpan({ cls: "buena-erp-bank-bank", text: row.bank });

    if (row.iban) {
      const ibanRow = card.createDiv({ cls: "buena-erp-bank-iban" });
      ibanRow.createSpan({ cls: "buena-erp-bank-iban-label", text: "IBAN" });
      ibanRow.createSpan({ cls: "buena-erp-bank-iban-value", text: row.iban });
    }
    if (row.purpose) {
      card.createDiv({ cls: "buena-erp-bank-purpose", text: row.purpose });
    }
  }
}

function roleLabel(role: "tenant" | "self_occupied" | "owner_landlord"): string {
  switch (role) {
    case "tenant":
      return "Mieter";
    case "self_occupied":
      return "Selbstnutzer";
    case "owner_landlord":
      return "Eigentümer";
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
