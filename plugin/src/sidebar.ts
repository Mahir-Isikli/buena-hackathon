import {
  ItemView,
  MarkdownView,
  Notice,
  parseYaml,
  setIcon,
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
  // Filter modes: "__all__" | "__review__" | "unit:<EH-XXX>"
  private filter: string = "__all__";
  private historyExpanded: boolean = false;

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
    const newFile = view?.file ?? null;
    // Sticky behavior: only switch when a different markdown file is active.
    // If the user clicks into settings, graph, canvas, etc., keep the last
    // property file pinned in the sidebar.
    if (newFile && newFile !== this.currentFile) {
      this.currentFile = newFile;
    } else if (this.currentFile && !this.app.vault.getAbstractFileByPath(this.currentFile.path)) {
      // The pinned file was deleted/renamed, drop it.
      this.currentFile = null;
    }
    this.pending = await this.scanPending(this.currentFile);
    this.history = this.currentFile
      ? await loadHistory(this.plugin, this.currentFile.path)
      : [];
    this.plugin.statusBar.setPendingCount(this.pending.length);
    this.plugin.statusBar.setReviewCount(
      this.pending.filter((p) => p.confidence > 0 && p.confidence < 0.85).length
    );
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

    // Compact header: wordmark + property name on one row.
    const header = root.createDiv({ cls: "buena-sidebar-header" });
    const wordmark = header.createDiv({ cls: "buena-sidebar-wordmark" });
    wordmark.createSpan({ text: "buena", cls: "buena-wordmark-text" });
    wordmark.createSpan({ text: "·", cls: "buena-wordmark-dot" });
    header.createEl("span", {
      text:
        this.currentFile?.basename ?? this.plugin.settings.propertyId ?? "",
      cls: "buena-sidebar-property",
    });

    // Shared content wrapper so both panes share the same width context.
    const content = root.createDiv({ cls: "buena-sidebar-content" });
    if (this.historyExpanded) {
      content.addClass("buena-content-history-expanded");
    }

    // Build available unit chips and apply current filter.
    const units = uniqueUnits(this.pending);
    const reviewCount = this.pending.filter(
      (p) => p.confidence > 0 && p.confidence < 0.85
    ).length;
    if (this.filter.startsWith("unit:")) {
      const u = this.filter.slice(5);
      if (!units.includes(u)) this.filter = "__all__";
    }
    const visiblePending = this.applyFilter(this.pending);

    // Pending queue (fills remaining space, scrolls internally)
    const pendingSection = content.createDiv({
      cls: "buena-section buena-section-pending",
    });
    const pendingHeader = pendingSection.createDiv({
      cls: "buena-section-header",
    });
    const pendingTitle = pendingHeader.createDiv({ cls: "buena-section-title" });
    setIcon(
      pendingTitle.createSpan({ cls: "buena-section-icon" }),
      "inbox"
    );
    pendingTitle.createEl("h4", { text: "Pending queue" });
    pendingHeader.createEl("span", {
      text: `${this.pending.length}`,
      cls: "buena-badge",
    });

    if (this.pending.length > 0) {
      const filters = pendingSection.createDiv({ cls: "buena-filter-chips" });
      this.renderChip(filters, "All", "__all__", this.pending.length);
      if (reviewCount > 0) {
        this.renderChip(filters, "Needs review", "__review__", reviewCount);
      }
      for (const u of units) {
        const count = this.pending.filter((p) => p.unit === u).length;
        this.renderChip(filters, u, `unit:${u}`, count);
      }
    }

    const pendingBody = pendingSection.createDiv({
      cls: "buena-section-body",
    });

    if (!this.currentFile) {
      pendingBody.createEl("div", {
        text: "Open a property file to see its pending patches.",
        cls: "buena-empty",
      });
    } else if (this.pending.length === 0) {
      pendingBody.createEl("div", {
        text: "No pending patches in this file.",
        cls: "buena-empty",
      });
    } else if (visiblePending.length === 0) {
      pendingBody.createEl("div", {
        text: `No pending patches match “${this.filterLabel()}”.`,
        cls: "buena-empty",
      });
    } else {
      for (const p of visiblePending) {
        this.renderPendingCard(pendingBody, p);
      }
    }

    // Recent changes (pinned to bottom 20%, scrolls internally)
    const historySection = content.createDiv({
      cls: "buena-section buena-section-history",
    });
    const historyHeader = historySection.createDiv({
      cls: "buena-section-header",
    });
    const historyTitle = historyHeader.createDiv({ cls: "buena-section-title" });
    setIcon(
      historyTitle.createSpan({ cls: "buena-section-icon" }),
      "history"
    );
    historyTitle.createEl("h4", { text: "Recent changes" });
    const historyRight = historyHeader.createDiv({
      cls: "buena-section-right",
    });
    if (this.currentFile && this.history.length > 0) {
      historyRight.createEl("span", {
        text: `${this.history.length}`,
        cls: "buena-badge",
      });
    }
    const expandBtn = historyRight.createEl("button", {
      cls: "buena-section-toggle",
      attr: {
        "aria-label": this.historyExpanded
          ? "Collapse recent changes"
          : "Expand recent changes",
      },
    });
    setIcon(expandBtn, this.historyExpanded ? "chevrons-down" : "chevrons-up");
    expandBtn.onclick = () => {
      this.historyExpanded = !this.historyExpanded;
      this.render();
    };
    const historyBody = historySection.createDiv({
      cls: "buena-section-body",
    });
    if (!this.currentFile) {
      historyBody.createEl("div", {
        text: "Open a property file to see its history.",
        cls: "buena-empty",
      });
    } else if (this.history.length === 0) {
      historyBody.createEl("div", {
        text: "No changes yet. Approve or reject a pending patch to start the log.",
        cls: "buena-empty",
      });
    } else {
      for (const h of this.history) {
        this.renderHistoryCard(historyBody, h);
      }
    }

    // Sticky in-sidebar status bar (always visible, below Recent changes).
    const statusHost = root.createDiv({ cls: "buena-statusbar" });
    this.plugin.statusBar.attach(statusHost);
  }

  private renderChip(
    parent: HTMLElement,
    label: string,
    value: string,
    count: number
  ) {
    const isActive = this.filter === value;
    const reviewCls = value === "__review__" ? " buena-chip-review" : "";
    const chip = parent.createEl("button", {
      cls: `buena-chip${reviewCls}${isActive ? " buena-chip-active" : ""}`,
    });
    const iconName = chipIcon(value);
    if (iconName) {
      setIcon(chip.createSpan({ cls: "buena-chip-icon" }), iconName);
    }
    chip.createSpan({ text: label, cls: "buena-chip-label" });
    chip.createSpan({ text: String(count), cls: "buena-chip-count" });
    chip.onclick = () => {
      this.filter = value;
      this.render();
    };
  }

  private applyFilter(items: PendingPatch[]): PendingPatch[] {
    if (this.filter === "__all__") return items;
    if (this.filter === "__review__") {
      return items.filter((p) => p.confidence > 0 && p.confidence < 0.85);
    }
    if (this.filter.startsWith("unit:")) {
      const u = this.filter.slice(5);
      return items.filter((p) => p.unit === u);
    }
    return items;
  }

  private filterLabel(): string {
    if (this.filter === "__all__") return "All";
    if (this.filter === "__review__") return "Needs review";
    if (this.filter.startsWith("unit:")) return this.filter.slice(5);
    return this.filter;
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
    // Compact log/timeline row: status icon · section · value · time-ago.
    const row = parent.createDiv({
      cls: `buena-log-row buena-log-${h.decision}`,
    });

    // Status icon based on decision.
    const icon = row.createSpan({ cls: "buena-log-icon" });
    const iconName =
      h.decision === "approved"
        ? "check"
        : h.decision === "rejected"
          ? "x"
          : "zap";
    setIcon(icon, iconName);

    // Body: section label + value.
    const body = row.createDiv({ cls: "buena-log-body" });
    const top = body.createDiv({ cls: "buena-log-top" });
    top.createSpan({ text: h.section, cls: "buena-log-section" });
    if (h.unit) {
      top.createSpan({ text: h.unit, cls: "buena-log-unit" });
    }
    body.createDiv({ text: h.newValue, cls: "buena-log-value" });

    // Time-ago on the right (full timestamp on hover).
    const time = row.createSpan({
      text: timeAgo(h.timestamp),
      cls: "buena-log-time",
    });
    attachHoverPopover(time, () => {
      const fields: HoverField[] = [
        { label: "Decision", value: h.decision },
        { label: "When", value: new Date(h.timestamp).toLocaleString() },
        { label: "Actor", value: h.actor },
      ];
      if (h.source) {
        fields.push({ label: "Source", value: h.source, mono: true });
      }
      if (h.oldValue) {
        fields.push({ label: "Was", value: h.oldValue });
      }
      fields.push({ label: "Now", value: h.newValue });
      return fields;
    });
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

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const secs = Math.floor((Date.now() - t) / 1000);
  if (secs < 5) return "now";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function chipIcon(value: string): string | null {
  if (value === "__all__") return "layers";
  if (value === "__review__") return "alert-triangle";
  if (value.startsWith("unit:")) return "home";
  return null;
}

function uniqueUnits(pending: PendingPatch[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pending) {
    if (p.unit && !seen.has(p.unit)) {
      seen.add(p.unit);
      out.push(p.unit);
    }
  }
  return out.sort();
}
