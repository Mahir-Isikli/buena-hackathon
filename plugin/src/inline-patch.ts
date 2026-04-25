import { Notice, parseYaml, TFile } from "obsidian";
import type BuenaPlugin from "../main";
import { attachHoverPopover, HoverField } from "./hover";
import { applyPatchToVault, revealLineInActiveView } from "./vault-patch";

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
  target_heading?: string;
  new_block?: string;
}

export function registerInlinePatchProcessor(plugin: BuenaPlugin) {
  plugin.registerMarkdownCodeBlockProcessor(
    "buena-pending",
    (source, el, ctx) => {
      let spec: PendingPatchSpec = {};
      try {
        spec = (parseYaml(source) as PendingPatchSpec) ?? {};
      } catch (err) {
        el.createEl("pre", {
          text: `[Buena] failed to parse buena-pending block: ${err}`,
        });
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
      approve.onclick = async () => {
        if (!spec.id || !spec.target_heading || !spec.new_block) {
          new Notice(
            "[Buena] cannot apply: missing id, target_heading, or new_block"
          );
          return;
        }
        const filePath = ctx.sourcePath;
        try {
          const insertedAt = await applyPatchToVault(plugin.app, filePath, {
            id: spec.id,
            target_heading: spec.target_heading,
            new_block: spec.new_block,
          });
          if (insertedAt === null) {
            new Notice(
              `[Buena] approve failed: heading "${spec.target_heading}" not found`
            );
            return;
          }
          new Notice(`[Buena] approved ${spec.id}, written to vault`);
          plugin.statusBar.bumpPendingCount(-1);
          plugin.statusBar.markPatchReceived();
          // Reveal the inserted block in the editor
          await revealLineInActiveView(plugin.app, filePath, insertedAt);
        } catch (err) {
          console.error("[Buena] apply failed", err);
          new Notice(`[Buena] approve failed: ${err}`);
        }
      };

      const reject = actions.createEl("button", { text: "Reject", cls: "buena-btn" });
      reject.onclick = async () => {
        if (!spec.id) {
          new Notice("[Buena] cannot reject: missing id");
          return;
        }
        const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (file && file instanceof TFile) {
          const text = await plugin.app.vault.read(file);
          const stripped = stripPendingBlockById(text, spec.id);
          if (stripped !== text) {
            await plugin.app.vault.modify(file, stripped);
          }
        }
        new Notice(`[Buena] rejected ${spec.id}`);
        plugin.statusBar.bumpPendingCount(-1);
      };

      const edit = actions.createEl("button", { text: "Edit", cls: "buena-btn" });
      edit.onclick = () => {
        new Notice("[Buena] inline edit not wired yet");
      };
    }
  );
}

function shortSource(s: string): string {
  const parts = s.split("/");
  return parts[parts.length - 1];
}

/**
 * Strip a buena-pending block by id without inserting anything. Used by reject.
 */
function stripPendingBlockById(text: string, patchId: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```buena-pending\s*$/.test(line)) {
      let j = i + 1;
      let foundId = false;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        if (lines[j].trim().startsWith("id:")) {
          const v = lines[j].split(":").slice(1).join(":").trim();
          if (v === patchId) foundId = true;
        }
        j += 1;
      }
      if (foundId) {
        i = j + 1;
        if (out.length && out[out.length - 1] === "" && lines[i] === "") i += 1;
        continue;
      }
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n");
}
