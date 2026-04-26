import type BuenaPlugin from "../main";
import { attachHoverPopover, HoverField } from "./hover";
import { openProvenanceSource } from "./provenance-open";
import type { RemotePendingPatch } from "./api";

/**
 * Reading-view post-processor: injects pending queue items inline under their
 * target heading. Source of truth stays in pending.json on R2; this only
 * renders. Approve/reject in the sidebar mutates the cache and the inline row
 * disappears on the next render.
 *
 * No callouts, no boxes. Plain dimmed list rows so the section reads as the
 * same surface, just with a "pending" tag and the existing source pill.
 */
export function registerPendingInlineProcessor(plugin: BuenaPlugin) {
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    const pending = plugin.pendingCache;
    if (!pending || pending.length === 0) return;
    if (!isPropertyFile(plugin, ctx.sourcePath)) return;

    const headings = el.querySelectorAll("h1, h2, h3");
    if (headings.length === 0) return;

    headings.forEach((h) => {
      const headingText = (h.textContent ?? "").trim();
      if (!headingText) return;
      const key = normalizeHeading(headingText);
      const matches = pending.filter(
        (p) => normalizeHeading(p.target_heading) === key
      );
      if (matches.length === 0) return;

      const list = document.createElement("ul");
      list.className = "buena-pending-inline";
      list.setAttribute("data-buena-pending", "true");

      for (const patch of matches) {
        list.appendChild(renderRow(plugin, patch));
      }

      h.insertAdjacentElement("afterend", list);
    });
  });
}

function isPropertyFile(plugin: BuenaPlugin, sourcePath: string): boolean {
  const target = plugin.settings.propertyFile;
  if (target && sourcePath === target) return true;
  const basename = sourcePath.split("/").pop()?.replace(/\.md$/, "");
  return Boolean(plugin.settings.propertyId && basename === plugin.settings.propertyId);
}

function normalizeHeading(value: string): string {
  return value.replace(/^#+\s*/, "").trim().toLowerCase();
}

function renderRow(plugin: BuenaPlugin, patch: RemotePendingPatch): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "buena-pending-row";
  li.setAttribute("data-patch-id", patch.id);

  const tag = li.appendChild(document.createElement("span"));
  tag.className = "buena-pending-tag";
  tag.textContent = "pending";

  const text = li.appendChild(document.createElement("span"));
  text.className = "buena-pending-text";
  text.textContent = patch.new;

  const meta = li.appendChild(document.createElement("span"));
  meta.className = "buena-pending-meta";

  if (patch.source) {
    const sourcePill = meta.appendChild(document.createElement("button"));
    sourcePill.type = "button";
    sourcePill.className = "buena-prov-pill buena-prov-pill-pending";
    sourcePill.textContent = sourcePillLabel(patch.source);
    attachHoverPopover(sourcePill, () => buildHoverFields(patch));
    sourcePill.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void openProvenanceSource(plugin, patch.source!);
    });
  }

  if (typeof patch.confidence === "number" && patch.confidence > 0) {
    const conf = meta.appendChild(document.createElement("span"));
    conf.className = "buena-confidence-pill buena-confidence-pill-pending";
    conf.textContent = `${Math.round(patch.confidence * 100)}%`;
  }

  return li;
}

function sourcePillLabel(source: string): string {
  const lower = source.toLowerCase();
  if (lower.endsWith(".eml") || lower.includes("emails/")) return "email";
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|webp|gif)$/.test(lower)) return "image";
  return "src";
}

function buildHoverFields(patch: RemotePendingPatch): HoverField[] {
  const fields: HoverField[] = [];
  fields.push({ label: "Status", value: "Pending review" });
  if (patch.actor) fields.push({ label: "Actor", value: patch.actor });
  if (typeof patch.confidence === "number") {
    fields.push({
      label: "Confidence",
      value: `${Math.round(patch.confidence * 100)}%`,
    });
  }
  if (patch.snippet) fields.push({ label: "Excerpt", value: patch.snippet });
  if (patch.source) {
    fields.push({
      label: "Source",
      value: patch.source.replace(/^r2:\/\/buena-raw\//, ""),
      mono: true,
    });
  }
  return fields;
}
