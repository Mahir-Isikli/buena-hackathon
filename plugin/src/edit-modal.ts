import { App, Notice, setIcon, TFile } from "obsidian";

export interface EditablePatch {
  id: string;
  new: string;
  new_block: string;
  section?: string;
  unit?: string;
  source?: string;
  snippet?: string;
  confidence?: number;
  target_heading?: string;
  note?: string;
}

export interface EditPatchPaneCallbacks {
  /** Called when the user closes the pane (cancel or save). */
  onClose: () => void;
  /** Called after a successful save, before onClose. */
  onSaved?: () => void;
}

/**
 * Property-manager-focused edit pane. Renders into a host element inside
 * the sidebar, so it lives in the right side panel rather than as a
 * floating modal. Same intent-driven UX: summary, target heading,
 * optional note, raw markdown hidden under Advanced.
 */
export class EditPatchPane {
  private app: App;
  private host: HTMLElement;
  private filePath: string;
  private patch: EditablePatch;
  private cb: EditPatchPaneCallbacks;

  constructor(
    app: App,
    host: HTMLElement,
    filePath: string,
    patch: EditablePatch,
    cb: EditPatchPaneCallbacks
  ) {
    this.app = app;
    this.host = host;
    this.filePath = filePath;
    this.patch = { ...patch };
    this.cb = cb;
  }

  render() {
    const root = this.host;
    root.empty();
    root.addClass("buena-edit-pane");

    // ---------- Header (with back button) ----------
    const header = root.createDiv({ cls: "buena-edit-header" });
    const back = header.createEl("button", {
      cls: "buena-edit-back",
      attr: { "aria-label": "Back to queue" },
    });
    setIcon(back, "arrow-left");
    back.onclick = () => this.cb.onClose();

    const title = header.createDiv({ cls: "buena-edit-title" });
    title.createSpan({ text: "Edit patch", cls: "buena-edit-title-text" });
    title.createSpan({
      text: shortId(this.patch.id),
      cls: "buena-edit-shortid",
    });

    // Pills row (section / unit / confidence)
    const pills = root.createDiv({ cls: "buena-edit-pills" });
    if (this.patch.section) {
      pills.createSpan({
        text: this.patch.section,
        cls: "buena-pending-section",
      });
    }
    if (this.patch.unit) {
      pills.createSpan({ text: this.patch.unit, cls: "buena-unit-pill" });
    }
    if (typeof this.patch.confidence === "number") {
      pills.createSpan({
        text: `${(this.patch.confidence * 100).toFixed(0)}% conf`,
        cls: "buena-meta-pill",
      });
    }

    // ---------- Summary field ----------
    const summaryWrap = root.createDiv({ cls: "buena-edit-field" });
    summaryWrap.createDiv({ cls: "buena-edit-label", text: "What to record" });
    summaryWrap.createDiv({
      cls: "buena-edit-hint",
      text: "One short line. Goes into the vault on approve.",
    });
    const summaryInput = summaryWrap.createEl("textarea", {
      cls: "buena-edit-input buena-edit-summary",
    });
    summaryInput.value = this.patch.new;
    summaryInput.rows = 3;
    summaryInput.addEventListener("input", () => {
      this.patch.new = summaryInput.value;
    });

    // ---------- Target heading dropdown ----------
    const headingWrap = root.createDiv({ cls: "buena-edit-field" });
    headingWrap.createDiv({ cls: "buena-edit-label", text: "Where it goes" });
    headingWrap.createDiv({
      cls: "buena-edit-hint",
      text: "Pick the section in the property file.",
    });
    const headingSelect = headingWrap.createEl("select", {
      cls: "buena-edit-input buena-edit-select",
    });
    const headings = this.collectHeadings();
    const current =
      this.patch.target_heading ?? headings[0]?.value ?? "";
    let hasCurrent = false;
    for (const h of headings) {
      const opt = headingSelect.createEl("option", {
        text: h.label,
        value: h.value,
      });
      if (h.value === current) {
        opt.selected = true;
        hasCurrent = true;
      }
    }
    if (!hasCurrent && current) {
      const opt = headingSelect.createEl("option", {
        text: `${stripHeadingPrefix(current)} (current)`,
        value: current,
      });
      opt.selected = true;
    }
    this.patch.target_heading = current;
    headingSelect.addEventListener("change", () => {
      this.patch.target_heading = headingSelect.value;
    });

    // ---------- Optional note ----------
    const noteWrap = root.createDiv({ cls: "buena-edit-field" });
    noteWrap.createDiv({
      cls: "buena-edit-label",
      text: "Note (optional)",
    });
    noteWrap.createDiv({
      cls: "buena-edit-hint",
      text: "Why this change. Saved with the audit trail.",
    });
    const noteInput = noteWrap.createEl("textarea", {
      cls: "buena-edit-input buena-edit-note",
    });
    noteInput.value = this.patch.note ?? "";
    noteInput.rows = 2;
    noteInput.placeholder = "e.g. Confirmed with tenant on 25.04";
    noteInput.addEventListener("input", () => {
      this.patch.note = noteInput.value;
    });

    // ---------- Source preview ----------
    if (this.patch.snippet || this.patch.source) {
      const srcWrap = root.createDiv({ cls: "buena-edit-source" });
      srcWrap.createDiv({ cls: "buena-edit-label", text: "Source" });
      if (this.patch.source) {
        srcWrap.createDiv({
          cls: "buena-edit-source-path",
          text: this.patch.source,
        });
      }
      if (this.patch.snippet) {
        srcWrap.createDiv({
          cls: "buena-edit-source-snippet",
          text: this.patch.snippet,
        });
      }
    }

    // ---------- Actions ----------
    const actions = root.createDiv({ cls: "buena-edit-actions" });
    const cancel = actions.createEl("button", {
      text: "Cancel",
      cls: "buena-btn",
    });
    cancel.onclick = () => this.cb.onClose();

    const save = actions.createEl("button", {
      text: "Save changes",
      cls: "buena-btn buena-btn-primary",
    });
    save.onclick = async () => {
      try {
        // Always rebuild the inserted block from the structured fields.
        this.patch.new_block = buildBlock(this.patch);
        await rewritePendingBlock(
          this.app,
          this.filePath,
          this.patch.id,
          this.patch.new,
          this.patch.new_block,
          this.patch.target_heading,
          this.patch.note
        );
        new Notice(`[Buena] saved edits to ${shortId(this.patch.id)}`);
        this.cb.onSaved?.();
        this.cb.onClose();
      } catch (err) {
        console.error("[Buena] edit save failed", err);
        new Notice(`[Buena] save failed: ${err}`);
      }
    };

    setTimeout(() => summaryInput.focus(), 0);
  }

  private collectHeadings(): { label: string; value: string }[] {
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) return [];
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.headings) return [];
    return cache.headings
      .filter((h) => h.level >= 2 && h.level <= 3)
      .map((h) => ({
        // Saved value still carries the markdown prefix so it matches
        // the heading line verbatim when the patch is applied.
        value: `${"#".repeat(h.level)} ${h.heading}`,
        // Display label is just the human heading text — no #/##.
        label: h.heading,
      }));
  }
}

function stripHeadingPrefix(s: string): string {
  return s.replace(/^#{1,6}\s*/, "");
}

function shortId(id: string): string {
  if (!id) return "";
  return id.length <= 10 ? id : `…${id.slice(-8)}`;
}

function buildBlock(p: EditablePatch): string {
  const lines: string[] = [];
  lines.push(`- ${p.new}`);
  if (p.source) {
    const conf =
      typeof p.confidence === "number"
        ? ` | conf: ${p.confidence.toFixed(2)}`
        : "";
    lines.push(`  <!-- prov: ${p.source}${conf} | actor: human-edit -->`);
  }
  if (p.note && p.note.trim()) {
    lines.push(`  > Note: ${p.note.trim()}`);
  }
  return lines.join("\n");
}

async function rewritePendingBlock(
  app: App,
  filePath: string,
  patchId: string,
  newSummary: string,
  newBlock: string,
  targetHeading?: string,
  note?: string
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) throw new Error(`not a file: ${filePath}`);
  const text = await app.vault.read(file);
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  let touched = false;
  while (i < lines.length) {
    if (/^```buena-pending\s*$/.test(lines[i])) {
      const start = i;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        body.push(lines[j]);
        j += 1;
      }
      const idLine = body.find((l) => /^\s*id:\s*/.test(l));
      const idVal = idLine?.replace(/^\s*id:\s*/, "").trim();
      if (idVal === patchId) {
        const rewritten = rewriteFields(
          body,
          newSummary,
          newBlock,
          targetHeading,
          note
        );
        out.push(lines[start]);
        out.push(...rewritten);
        out.push(lines[j] ?? "```");
        i = j + 1;
        touched = true;
        continue;
      }
      for (let k = start; k <= j; k++) out.push(lines[k] ?? "");
      i = j + 1;
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  if (!touched) throw new Error(`patch ${patchId} not found in file`);
  await app.vault.modify(file, out.join("\n"));
}

function rewriteFields(
  body: string[],
  newSummary: string,
  newBlock: string,
  targetHeading?: string,
  note?: string
): string[] {
  const out: string[] = [];
  let i = 0;
  let sawHeading = false;
  let sawNote = false;
  while (i < body.length) {
    const line = body[i];
    if (/^new\s*:/.test(line)) {
      out.push(`new: ${quoteYaml(newSummary)}`);
      i = skipScalar(body, i);
      continue;
    }
    if (/^new_block\s*:/.test(line)) {
      out.push("new_block: |-");
      for (const bl of newBlock.split("\n")) out.push(`  ${bl}`);
      i = skipScalar(body, i);
      continue;
    }
    if (/^target_heading\s*:/.test(line)) {
      sawHeading = true;
      if (targetHeading !== undefined) {
        out.push(`target_heading: ${quoteYaml(targetHeading)}`);
      } else {
        out.push(line);
      }
      i = skipScalar(body, i);
      continue;
    }
    if (/^note\s*:/.test(line)) {
      sawNote = true;
      if (note !== undefined && note !== "") {
        out.push(`note: ${quoteYaml(note)}`);
      } else if (note === "") {
        // user cleared it: drop the field
      } else {
        out.push(line);
      }
      i = skipScalar(body, i);
      continue;
    }
    out.push(line);
    i += 1;
  }
  if (!sawHeading && targetHeading !== undefined && targetHeading !== "") {
    out.push(`target_heading: ${quoteYaml(targetHeading)}`);
  }
  if (!sawNote && note !== undefined && note !== "") {
    out.push(`note: ${quoteYaml(note)}`);
  }
  return out;
}

function skipScalar(body: string[], start: number): number {
  let i = start + 1;
  while (i < body.length) {
    const line = body[i];
    if (line === "" || /^\s/.test(line)) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

function quoteYaml(s: string): string {
  if (/[:#'"\n]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}
