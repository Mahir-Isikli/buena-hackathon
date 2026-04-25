import { Notice, parseYaml } from "obsidian";
import type BuenaPlugin from "../main";

interface PendingPatchSpec {
  id?: string;
  section?: string;
  old?: string;
  new?: string;
  source?: string;
  confidence?: number;
  actor?: string;
}

/**
 * Renders a `buena-pending` codeblock as an interactive approve/reject card.
 *
 * Usage in markdown:
 *
 * ```buena-pending
 * id: p-001
 * section: Open issues
 * new: Tenant in EH-014 withholding 10% rent due to broken hot water
 * source: emails/2026-01-15/EMAIL-12891.eml
 * confidence: 0.91
 * actor: gemini-flash
 * ```
 */
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

    const body = card.createDiv({ cls: "buena-pending-body" });
    if (spec.old) {
      body.createDiv({ text: `was: ${spec.old}`, cls: "buena-pending-old" });
    }
    if (spec.new) {
      body.createDiv({ text: spec.new, cls: "buena-pending-new" });
    }

    const meta = card.createDiv({ cls: "buena-pending-meta" });
    if (typeof spec.confidence === "number") {
      meta.createSpan({
        text: `conf ${(spec.confidence * 100).toFixed(0)}%`,
        cls: "buena-meta-pill",
      });
    }
    if (spec.actor) meta.createSpan({ text: spec.actor, cls: "buena-meta-pill" });
    if (spec.source) meta.createSpan({ text: spec.source, cls: "buena-meta-source" });

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
