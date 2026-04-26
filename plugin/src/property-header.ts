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

    const email = `property+${propertyId}@kontext.haus`;

    const wrap = document.createElement("div");
    wrap.className = "buena-header-pills";

    const card = document.createElement("div");
    card.className = "buena-inbox-card";
    card.title = email;
    // Outline-style mail glyph (Material-ish, 1.6px stroke, sharp corners).
    const mailSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>`;
    const copySvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>`;
    card.innerHTML = `
      <span class="buena-inbox-card-icon" aria-hidden="true">${mailSvg}</span>
      <div class="buena-inbox-card-body">
        <span class="buena-inbox-card-label">Property inbox</span>
        <span class="buena-inbox-card-address">${escapeHtml(email)}</span>
      </div>
      <button type="button" class="buena-inbox-card-copy" aria-label="Copy email address">
        <span class="buena-inbox-card-copy-icon" aria-hidden="true">${copySvg}</span>
        <span class="buena-inbox-card-copy-label">Copy</span>
      </button>
    `;

    const copyBtn = card.querySelector<HTMLButtonElement>(".buena-inbox-card-copy")!;
    const copyLabel = copyBtn.querySelector<HTMLSpanElement>(".buena-inbox-card-copy-label")!;
    const doCopy = async (e: Event) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(email);
        copyBtn.classList.add("is-copied");
        copyLabel.textContent = "Copied";
        new Notice(`[Buena] copied inbox: ${email}`);
        setTimeout(() => {
          copyBtn.classList.remove("is-copied");
          copyLabel.textContent = "Copy";
        }, 1400);
      } catch {
        new Notice(`[Buena] inbox: ${email}`);
      }
    };
    copyBtn.addEventListener("click", doCopy);
    card.addEventListener("click", doCopy);
    wrap.appendChild(card);

    h1.insertAdjacentElement("afterend", wrap);
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
