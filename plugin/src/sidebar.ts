import {
  ItemView,
  MarkdownView,
  Notice,
  parseYaml,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import type BuenaPlugin from "../main";
import { attachHoverPopover, HoverField } from "./hover";
import {
  addHistoryEntry,
  HistoryEntry,
  loadHistory,
} from "./history";
import {
  applyPatchToVault,
  findPendingBlocks,
  revealLineInActiveView,
  stripPendingBlockById,
} from "./vault-patch";

export const BUENA_SIDEBAR_VIEW_TYPE = "buena-sidebar";

interface PendingPatch {
  id: string;
  section: string;
  unit?: string;
  oldValue?: string;
  newValue: string;
  source: string;
  sourceSnippet?: string;
  confidence: number;
  actor: string;
  receivedAt?: string;
  target_heading?: string;
  new_block?: string;
}

export class BuenaSidebarView extends ItemView {
  plugin: BuenaPlugin;
  private pending: PendingPatch[] = [];
  private history: HistoryEntry[] = [];
  private currentFile: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: BuenaPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return BUENA_SIDEBAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Buena";
  }

  getIcon(): string {
    return "inbox";
  }

  async onOpen() {
    // Refresh when the active file changes or its content is modified.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.refresh())
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file === this.currentFile) {
          this.refresh();
        }
      })
    );
    await this.refresh();
  }

  async onClose() {
    this.contentEl.empty();
  }

  /**
   * Re-scan the active markdown file for buena-pending blocks and re-render.
   */
  async refresh() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    this.currentFile = view?.file ?? null;
    this.pending = await this.scanPending(this.currentFile);
    this.history = this.currentFile
      ? await loadHistory(this.plugin, this.currentFile.path)
      : [];
    this.plugin.statusBar.setPendingCount(this.pending.length);
    this.render();
  }

  private async scanPending(file: TFile | null): Promise<PendingPatch[]> {
    if (!file) return [];
    const text = await this.app.vault.read(file);
    const blocks = findPendingBlocks(text);
    const out: PendingPatch[] = [];
    for (const yamlSrc of blocks) {
      try {
        const spec = (parseYaml(yamlSrc) as Record<string, unknown>) ?? {};
        if (!spec.id) continue;
        out.push({
          id: String(spec.id),
          section: String(spec.section ?? "Unsorted"),
          unit: spec.unit ? String(spec.unit) : undefined,
          oldValue: spec.old ? String(spec.old) : undefined,
          newValue: String(spec.new ?? ""),
          source: String(spec.source ?? ""),
          sourceSnippet: spec.snippet ? String(spec.snippet) : undefined,
          confidence: typeof spec.confidence === "number" ? spec.confidence : 0,
          actor: String(spec.actor ?? "unknown"),
          target_heading: spec.target_heading
            ? String(spec.target_heading)
            : undefined,
          new_block: spec.new_block ? String(spec.new_block) : undefined,
        });
      } catch (err) {
        console.warn("[Buena] failed to parse pending block", err);
      }
    }
    return out;
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("buena-sidebar");

    // Wordmark header
    const header = root.createDiv({ cls: "buena-sidebar-header" });
    const wordmark = header.createDiv({ cls: "buena-sidebar-wordmark" });
    wordmark.createSpan({ text: "buena", cls: "buena-wordmark-text" });
    wordmark.createSpan({ text: "·", cls: "buena-wordmark-dot" });
    header.createEl("div", {
      text: "Context Engine",
      cls: "buena-sidebar-tagline",
    });
    header.createEl("div", {
      text: this.currentFile?.basename ?? this.plugin.settings.propertyId,
      cls: "buena-sidebar-subtitle",
    });

    // Pending queue
    const pendingSection = root.createDiv({ cls: "buena-section" });
    const pendingHeader = pendingSection.createDiv({ cls: "buena-section-header" });
    pendingHeader.createEl("h4", { text: "Pending queue" });
    pendingHeader.createEl("span", {
      text: `${this.pending.length}`,
      cls: "buena-badge",
    });

    if (!this.currentFile) {
      pendingSection.createEl("div", {
        text: "Open a property file to see its pending patches.",
        cls: "buena-empty",
      });
    } else if (this.pending.length === 0) {
      pendingSection.createEl("div", {
        text: "No pending patches in this file.",
        cls: "buena-empty",
      });
    } else {
      for (const p of this.pending) {
        this.renderPendingCard(pendingSection, p);
      }
    }

    // History
    const historySection = root.createDiv({ cls: "buena-section" });
    historySection.createEl("h4", { text: "Recent changes" });
    if (!this.currentFile) {
      historySection.createEl("div", {
        text: "Open a property file to see its history.",
        cls: "buena-empty",
      });
    } else if (this.history.length === 0) {
      historySection.createEl("div", {
        text: "No changes yet. Approve or reject a pending patch to start the log.",
        cls: "buena-empty",
      });
    } else {
      for (const h of this.history) {
        this.renderHistoryCard(historySection, h);
      }
    }
  }

  private renderPendingCard(parent: HTMLElement, p: PendingPatch) {
    const card = parent.createDiv({ cls: "buena-card buena-card-pending" });

    // Top row: section + unit pill
    const top = card.createDiv({ cls: "buena-card-top" });
    top.createDiv({ text: p.section, cls: "buena-card-section" });
    if (p.unit) {
      const unitPill = top.createSpan({ text: p.unit, cls: "buena-unit-pill" });
      attachHoverPopover(unitPill, () => [
        { label: "Unit", value: p.unit ?? "", mono: true },
        { label: "Section", value: p.section },
      ]);
    }

    if (p.oldValue) {
      card.createDiv({ text: p.oldValue, cls: "buena-card-old" });
    }
    card.createDiv({ text: p.newValue, cls: "buena-card-new" });

    // Source row with rich hover
    const meta = card.createDiv({ cls: "buena-card-meta" });
    if (p.confidence > 0) {
      meta.createSpan({
        text: `${(p.confidence * 100).toFixed(0)}% conf`,
        cls: "buena-meta-pill",
      });
    }
    meta.createSpan({ text: p.actor, cls: "buena-meta-pill" });
    if (p.source) {
      const sourcePill = meta.createSpan({
        text: shortSource(p.source),
        cls: "buena-meta-source",
      });
      attachHoverPopover(sourcePill, () => {
        const fields: HoverField[] = [
          { label: "Source", value: p.source, mono: true },
          { label: "Confidence", value: `${(p.confidence * 100).toFixed(0)}%` },
          { label: "Actor", value: p.actor },
        ];
        if (p.sourceSnippet) {
          fields.push({ label: "Snippet", value: p.sourceSnippet });
        }
        return fields;
      });
    }

    const actions = card.createDiv({ cls: "buena-card-actions" });
    const approve = actions.createEl("button", {
      text: "Approve",
      cls: "buena-btn buena-btn-primary",
    });
    approve.onclick = () => this.handleApprove(p);
    const reject = actions.createEl("button", { text: "Reject", cls: "buena-btn" });
    reject.onclick = () => this.handleReject(p);
    const edit = actions.createEl("button", { text: "Edit", cls: "buena-btn" });
    edit.onclick = () => this.handleEdit(p);
  }

  private renderHistoryCard(parent: HTMLElement, h: HistoryEntry) {
    const card = parent.createDiv({ cls: "buena-card buena-card-history" });

    const top = card.createDiv({ cls: "buena-card-top" });
    top.createDiv({ text: h.section, cls: "buena-card-section" });
    if (h.unit) {
      top.createSpan({ text: h.unit, cls: "buena-unit-pill" });
    }
    top.createSpan({
      text: h.decision,
      cls: `buena-meta-pill buena-decision-${h.decision}`,
    });

    if (h.oldValue) {
      card.createDiv({ text: h.oldValue, cls: "buena-card-old" });
    }
    card.createDiv({ text: h.newValue, cls: "buena-card-new" });

    const meta = card.createDiv({ cls: "buena-card-meta" });
    meta.createSpan({ text: h.actor, cls: "buena-meta-pill" });
    if (h.source) {
      const src = meta.createSpan({
        text: shortSource(h.source),
        cls: "buena-meta-source",
      });
      attachHoverPopover(src, () => [
        { label: "Source", value: h.source ?? "", mono: true },
        { label: "Actor", value: h.actor },
        { label: "Decision", value: h.decision },
        {
          label: "When",
          value: new Date(h.timestamp).toLocaleString(),
        },
      ]);
    } else {
      meta.createSpan({
        text: new Date(h.timestamp).toLocaleString(),
        cls: "buena-meta-source",
      });
    }
  }

  private async handleApprove(p: PendingPatch) {
    if (!this.currentFile) {
      new Notice("[Buena] no active file");
      return;
    }
    if (!p.target_heading || !p.new_block) {
      new Notice(
        `[Buena] cannot apply ${p.id}: missing target_heading or new_block`
      );
      return;
    }
    try {
      const insertedAt = await applyPatchToVault(
        this.app,
        this.currentFile.path,
        {
          id: p.id,
          target_heading: p.target_heading,
          new_block: p.new_block,
        }
      );
      if (insertedAt === null) {
        new Notice(
          `[Buena] approve failed: heading "${p.target_heading}" not found`
        );
        return;
      }
      new Notice(`[Buena] approved ${p.id}, written to vault`);
      this.plugin.statusBar.markPatchReceived();
      await addHistoryEntry(this.plugin, this.currentFile.path, {
        id: p.id,
        section: p.section,
        unit: p.unit,
        oldValue: p.oldValue,
        newValue: p.newValue,
        source: p.source,
        decision: "approved",
        timestamp: new Date().toISOString(),
        actor: p.actor,
      });
      await revealLineInActiveView(this.app, this.currentFile.path, insertedAt);
      // refresh() will be triggered by the vault.modify event.
    } catch (err) {
      console.error("[Buena] approve failed", err);
      new Notice(`[Buena] approve failed: ${err}`);
    }
  }

  private async handleReject(p: PendingPatch) {
    if (!this.currentFile) return;
    try {
      const text = await this.app.vault.read(this.currentFile);
      const stripped = stripPendingBlockById(text, p.id);
      if (stripped !== text) {
        await this.app.vault.modify(this.currentFile, stripped);
      }
      await addHistoryEntry(this.plugin, this.currentFile.path, {
        id: p.id,
        section: p.section,
        unit: p.unit,
        oldValue: p.oldValue,
        newValue: p.newValue,
        source: p.source,
        decision: "rejected",
        timestamp: new Date().toISOString(),
        actor: p.actor,
      });
      new Notice(`[Buena] rejected ${p.id}`);
    } catch (err) {
      console.error("[Buena] reject failed", err);
      new Notice(`[Buena] reject failed: ${err}`);
    }
  }

  private handleEdit(p: PendingPatch) {
    new Notice(`[Buena] edit not wired yet (${p.id})`);
  }
}

function shortSource(s: string): string {
  const parts = s.split("/");
  return parts[parts.length - 1];
}
