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
  layout?: "card" | "cards" | "grid" | "units" | "bank";
  id?: string;
  ids?: string[];
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

// ---- units layout: row per unit with auto-resolved occupant ------------
function renderUnits(el: HTMLElement, ids: string[], store: ReturnType<typeof getErpStore>) {
  if (!store) return;
  const wrap = el.createDiv({ cls: "buena-erp-units" });
  for (const rawId of ids) {
    const r = store.resolve(rawId);
    if (!r) {
      const miss = wrap.createDiv({ cls: "buena-erp-unit-row buena-erp-unit-row-missing" });
      miss.createSpan({ text: `Unknown unit: ${rawId}` });
      continue;
    }
    const u = r.raw as { typ?: string };
    const row = wrap.createDiv({ cls: "buena-erp-unit-row" });

    // left: unit chip
    const left = row.createDiv({ cls: "buena-erp-unit-left" });
    const unitChip = left.createSpan({ cls: "buena-erp-unit-chip" });
    unitChip.createSpan({ cls: "buena-erp-unit-chip-icon", text: kindIcon(r.kind) });
    unitChip.createSpan({ cls: "buena-erp-unit-chip-label", text: r.label });
    attachHoverPopover(unitChip, () => buildHoverFields(r));

    // middle: meta
    const mid = row.createDiv({ cls: "buena-erp-unit-mid" });
    if (r.sub) mid.createSpan({ cls: "buena-erp-unit-meta", text: r.sub });
    if (u.typ) {
      const tag = mid.createSpan({ cls: "buena-erp-unit-typ", text: u.typ });
      tag.classList.add(`buena-erp-unit-typ-${slug(u.typ)}`);
    }

    // right: occupant chip
    const right = row.createDiv({ cls: "buena-erp-unit-right" });
    const occ = store.occupant(r.id);
    if (!occ) {
      right.createSpan({ cls: "buena-erp-unit-vacant", text: "vacant" });
    } else {
      const chip = right.createSpan({
        cls: `buena-erp-unit-occ buena-erp-unit-occ-${occ.role}`,
      });
      chip.createSpan({ cls: "buena-erp-unit-occ-role", text: roleLabel(occ.role) });
      chip.createSpan({ cls: "buena-erp-unit-occ-icon", text: kindIcon(occ.resolved.kind) });
      chip.createSpan({ cls: "buena-erp-unit-occ-label", text: occ.resolved.label });
      chip.createSpan({ cls: "buena-erp-unit-occ-id", text: occ.resolved.id });
      attachHoverPopover(chip, () => buildHoverFields(occ.resolved));
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
