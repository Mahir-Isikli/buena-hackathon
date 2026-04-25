import { Notice } from "obsidian";
import type BuenaPlugin from "../main";

/**
 * Adds a compact inbox pill below the H1 in rendered markdown.
 *
 * The actual address we copy is property+<PROPERTY_ID>@kontext.haus because
 * that matches the current worker router. The visible label is a compact,
 * human-friendly alias derived from the property address so it fits in the UI.
 */
export function registerPropertyHeaderProcessor(plugin: BuenaPlugin) {
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    const h1 = el.querySelector("h1");
    if (!h1) return;
    if (el.querySelector(".buena-header-pills")) return;

    const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
    const mdFile = file && "path" in file ? file : null;
    const cache = mdFile ? plugin.app.metadataCache.getFileCache(mdFile as any) : null;
    const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const propertyId = typeof fm.property_id === "string" ? fm.property_id : plugin.settings.propertyId;
    if (!propertyId) return;

    const address = typeof fm.address === "string" ? fm.address : "";
    const display = compactAddressLabel(address, propertyId);
    const email = `property+${propertyId}@kontext.haus`;

    const wrap = document.createElement("div");
    wrap.className = "buena-header-pills";

    const pill = document.createElement("button");
    pill.className = "buena-header-pill buena-header-pill-email";
    pill.type = "button";
    pill.title = email;
    pill.innerHTML = `<span class="buena-header-pill-icon">✉</span><span class="buena-header-pill-label">Inbox · ${escapeHtml(display)}</span>`;
    pill.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(email);
        new Notice(`[Buena] copied inbox: ${email}`);
      } catch {
        new Notice(`[Buena] inbox: ${email}`);
      }
    });
    wrap.appendChild(pill);

    h1.insertAdjacentElement("afterend", wrap);
  });
}

function compactAddressLabel(address: string, propertyId: string): string {
  const first = address.split(",")[0]?.trim() ?? "";
  if (!first) return propertyId.toLowerCase();
  const match = first.match(/^(.*?)(\d+[a-zA-Z]?)$/);
  const street = (match?.[1] ?? first)
    .toLowerCase()
    .replace(/straße/g, "str")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  const number = match?.[2]?.toLowerCase() ?? "";
  const base = `${street}${number}` || propertyId.toLowerCase();
  return base.length > 18 ? base.slice(0, 18) : base;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
