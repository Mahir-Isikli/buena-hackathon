import { Notice, parseYaml } from "obsidian";
import type BuenaPlugin from "../main";
import { attachHoverPopover, HoverField } from "./hover";

interface PendingPatchSpec {
  id?: string;
  section?: string;
  unit?: string;
  old?: string;
  new?: string;
  source?: string;
  snippet?: string;
  confidence?: number;
  actor?: string;
}

export function registerInlinePatchProcessor(plugin: BuenaPlugin) {
  plugin.registerMarkdownCodeBlockProcessor("buena-pending", (source, el) => {
    let spec: PendingPatchSpec = {};
    try {
      spec = (parseYaml(source) as PendingPatchSpec) ?? {};
    } catch (err) {
      el.createEl("pre", { text: `[Buena] failed to parse buena-pending block: ${err}` });
      return;
    }

    const card = el.createDiv({ cls: "buena-pending-card" });

    const header = card.createDiv({ cls: "buena-pending-header" });
    header.createSpan({ text: "Pending patch", cls: "buena-pending-label" });
    if (spec.section) {
      header.createSpan({ text: spec.section, cls: "buena-pending-section" });
    }
    if (spec.unit) {
      header.createSpan({ text: spec.unit, cls: "buena-unit-pill" });
    }

    const body = card.createDiv({ cls: "buena-pending-body" });
    if (spec.old) {
      body.createDiv({ text: spec.old, cls: "buena-pending-old" });
    }
    if (spec.new) {
      body.createDiv({ text: spec.new, cls: "buena-pending-new" });
    }

    const meta = card.createDiv({ cls: "buena-pending-meta" });
    if (typeof spec.confidence === "number") {
      meta.createSpan({
        text: `${(spec.confidence * 100).toFixed(0)}% conf`,
        cls: "buena-meta-pill",
      });
    }
    if (spec.actor) meta.createSpan({ text: spec.actor, cls: "buena-meta-pill" });
    if (spec.source) {
      const srcEl = meta.createSpan({
        text: shortSource(spec.source),
        cls: "buena-meta-source",
      });
      attachHoverPopover(srcEl, () => {
        const fields: HoverField[] = [
          { label: "Source", value: spec.source ?? "", mono: true },
        ];
        if (typeof spec.confidence === "number") {
          fields.push({
            label: "Confidence",
            value: `${(spec.confidence * 100).toFixed(0)}%`,
          });
        }
        if (spec.actor) fields.push({ label: "Actor", value: spec.actor });
        if (spec.snippet) fields.push({ label: "Snippet", value: spec.snippet });
        return fields;
      });
    }

    const actions = card.createDiv({ cls: "buena-pending-actions" });
    const approve = actions.createEl("button", {
      text: "Approve",
      cls: "buena-btn buena-btn-primary",
    });
    approve.onclick = () => {
      new Notice(`[Buena] approved ${spec.id ?? "patch"}`);
      plugin.statusBar.bumpPendingCount(-1);
      plugin.statusBar.markPatchReceived();
      card.addClass("buena-pending-approved");
    };

    const reject = actions.createEl("button", { text: "Reject", cls: "buena-btn" });
    reject.onclick = () => {
      new Notice(`[Buena] rejected ${spec.id ?? "patch"}`);
      plugin.statusBar.bumpPendingCount(-1);
      card.addClass("buena-pending-rejected");
    };

    const edit = actions.createEl("button", { text: "Edit", cls: "buena-btn" });
    edit.onclick = () => {
      new Notice("[Buena] inline edit not wired yet");
    };
  });
}

function shortSource(s: string): string {
  const parts = s.split("/");
  return parts[parts.length - 1];
}
