import { Notice, parseYaml, setIcon, TFile } from "obsidian";
import type BuenaPlugin from "../main";
import { attachHoverPopover, HoverField } from "./hover";
import { addHistoryEntry } from "./history";
import {
  applyPatchToVault,
  findHeadingLine,
  revealLineInActiveView,
  stripPendingBlockById,
} from "./vault-patch";
import { postDecision } from "./api";

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
      const scope = deriveScope(spec);
      if (scope) {
        header.createSpan({
          text: scope.label,
          cls: `buena-scope-pill buena-scope-pill-${scope.kind}`,
        });
        const scopeRow = card.createDiv({ cls: "buena-scope-row" });
        scopeRow.createSpan({ text: "Scope", cls: "buena-scope-row-label" });
        scopeRow.createSpan({
          text: scope.label,
          cls: `buena-scope-row-value buena-scope-row-value-${scope.kind}`,
        });
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

      // Go-to-section pill: only shown if the target heading already exists
      // in this file. New sections can't be jumped to, so we hide the pill.
      if (spec.target_heading) {
        const goToWrap = card.createDiv({ cls: "buena-goto-wrap" });
        const pill = goToWrap.createEl("button", {
          cls: "buena-goto-pill",
        });
        setIcon(pill.createSpan({ cls: "buena-goto-icon" }), "arrow-right");
        pill.createSpan({ text: "Go to section", cls: "buena-goto-label" });
        pill.disabled = true;
        pill.title = "Checking target section...";
        // Async existence check — hide pill if heading doesn't exist yet.
        findHeadingLine(plugin.app, ctx.sourcePath, spec.target_heading)
          .then((lineIdx) => {
            if (lineIdx === null) {
              goToWrap.remove();
              return;
            }
            pill.disabled = false;
            pill.title = `Jump to ${spec.target_heading}`;
            pill.onclick = () => {
              revealLineInActiveView(plugin.app, ctx.sourcePath, lineIdx).catch(
                (err) => console.warn("[Buena] go-to-section failed", err)
              );
            };
          })
          .catch(() => goToWrap.remove());
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
          const approvedAt = new Date().toISOString();
          const annotatedBlock = annotateApprovedBlock(
            spec.new_block,
            approvedAt,
            spec.actor ?? "unknown",
            spec.source,
            spec.confidence
          );
          const insertedAt = await applyPatchToVault(plugin.app, filePath, {
            id: spec.id,
            target_heading: spec.target_heading,
            new_block: annotatedBlock,
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
          if (plugin.settings.workerUrl) {
            postDecision(
              plugin.settings,
              spec.id,
              "approved",
              spec.actor ?? "human"
            ).catch((err) => console.warn("[Buena] postDecision failed", err));
          }
          await addHistoryEntry(plugin, filePath, {
            id: spec.id,
            section: spec.section ?? "Unsorted",
            unit: spec.unit,
            oldValue: spec.old,
            newValue: spec.new ?? "",
            source: spec.source,
            decision: "approved",
            timestamp: new Date().toISOString(),
            actor: spec.actor ?? "unknown",
            originalBlock: {
              target_heading: spec.target_heading,
              new_block: annotatedBlock,
              confidence: spec.confidence,
              snippet: spec.snippet,
            },
          });
          await revealLineInActiveView(plugin.app, filePath, insertedAt);
        } catch (err) {
          console.error("[Buena] apply failed", err);
          new Notice(`[Buena] approve failed: ${err}`);
        }
      };

      const reject = actions.createEl("button", { text: "Reject", cls: "buena-btn" });
      // Reject expands an inline reason input. Submitting it commits the
      // rejection with a logged reason. Cancelling collapses it.
      const reasonHost = card.createDiv({
        cls: "buena-reject-reason buena-reject-reason-hidden",
      });
      reject.onclick = () => {
        if (!spec.id) {
          new Notice("[Buena] cannot reject: missing id");
          return;
        }
        if (!reasonHost.hasClass("buena-reject-reason-hidden")) {
          reasonHost.addClass("buena-reject-reason-hidden");
          reasonHost.empty();
          return;
        }
        reasonHost.removeClass("buena-reject-reason-hidden");
        reasonHost.empty();
        const label = reasonHost.createEl("label", {
          text: "Why are you rejecting this? (logged for accountability)",
          cls: "buena-reject-reason-label",
        });
        const ta = reasonHost.createEl("textarea", {
          cls: "buena-reject-reason-input",
          attr: {
            placeholder: "e.g. wrong unit, duplicate of EH-014 issue, sender unverified...",
            rows: "2",
          },
        });
        const row = reasonHost.createDiv({ cls: "buena-reject-reason-row" });
        const cancel = row.createEl("button", {
          text: "Cancel",
          cls: "buena-btn",
        });
        cancel.onclick = () => {
          reasonHost.addClass("buena-reject-reason-hidden");
          reasonHost.empty();
        };
        const confirm = row.createEl("button", {
          text: "Confirm reject",
          cls: "buena-btn buena-btn-danger",
        });
        const submit = async () => {
          const reason = ta.value.trim();
          if (reason.length < 10) {
            new Notice(
              "[Buena] please give a real reason (min 10 chars). It is logged for accountability."
            );
            ta.focus();
            return;
          }
          confirm.disabled = true;
          cancel.disabled = true;
          await commitReject(plugin, ctx.sourcePath, spec, reason);
          // The codeblock will disappear once the file is rewritten.
        };
        confirm.onclick = submit;
        ta.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault();
            void submit();
          }
        });
        ta.focus();
      };
    }
  );
}

async function commitReject(
  plugin: BuenaPlugin,
  filePath: string,
  spec: PendingPatchSpec,
  reason: string
) {
  if (!spec.id) return;
  const file = plugin.app.vault.getAbstractFileByPath(filePath);
  if (file && file instanceof TFile) {
    const text = await plugin.app.vault.read(file);
    const stripped = stripPendingBlockById(text, spec.id);
    if (stripped !== text) {
      await plugin.app.vault.modify(file, stripped);
    }
  }
  await addHistoryEntry(plugin, filePath, {
    id: spec.id,
    section: spec.section ?? "Unsorted",
    unit: spec.unit,
    oldValue: spec.old,
    newValue: spec.new ?? "",
    source: spec.source,
    decision: "rejected",
    timestamp: new Date().toISOString(),
    actor: spec.actor ?? "unknown",
    rejectionReason: reason,
    originalBlock: {
      target_heading: spec.target_heading,
      new_block: spec.new_block,
      confidence: spec.confidence,
      snippet: spec.snippet,
    },
  });
  new Notice(`[Buena] rejected ${spec.id}`);
  plugin.statusBar.bumpPendingCount(-1);
  if (plugin.settings.workerUrl) {
    postDecision(
      plugin.settings,
      spec.id,
      "rejected",
      spec.actor ?? "human",
      reason
    ).catch((err) => console.warn("[Buena] postDecision failed", err));
  }
}

function annotateApprovedBlock(
  block: string,
  _approvedAt: string,
  actor: string,
  source?: string,
  confidence?: number
): string {
  const safeSource = source ? source.replace(/@/g, "%40") : undefined;
  const prov = safeSource
    ? ` {prov: ${safeSource}${typeof confidence === "number" ? ` | conf: ${confidence}` : ""} | actor: ${actor}}`
    : "";
  return `${block}${prov}`;
}

function deriveScope(spec: PendingPatchSpec): { kind: "unit" | "building" | "provider"; label: string } | null {
  if (spec.unit) return { kind: "unit", label: spec.unit };
  const hay = [spec.new, spec.snippet, spec.new_block].filter(Boolean).join(" \n ");
  const building = /\b(HAUS-\d+)\b/i.exec(hay);
  if (building) return { kind: "building", label: building[1].toUpperCase() };
  const provider = /\b(DL-\d+)\b/i.exec(hay);
  if (provider) return { kind: "provider", label: provider[1].toUpperCase() };
  return null;
}

function shortSource(s: string): string {
  const parts = s.split("/");
  return parts[parts.length - 1];
}
