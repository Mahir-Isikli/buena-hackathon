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
  removeHistoryEntry,
} from "./history";
import {
  applyPatchToVault,
  findHeadingLine,
  findPendingBlocks,
  revealLineInActiveView,
  reverseHistoryEntry,
  stripPendingBlockById,
} from "./vault-patch";
import {
  fetchHistory,
  fetchPending,
  postDecision,
  RemotePendingPatch,
} from "./api";
import { pullPendingOnce, resolvePropertyFile } from "./sync";

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

type SidebarTab = "queue" | "history";

export class BuenaSidebarView extends ItemView {
  plugin: BuenaPlugin;
  private pending: PendingPatch[] = [];
  private history: HistoryEntry[] = [];
  private currentFile: TFile | null = null;
  // Filter modes: "__all__" | "__review__" | "unit:<EH-XXX>"
  private filter: string = "__all__";
  private activeTab: SidebarTab = "queue";
  // History table sort
  private historySortBy: "when" | "section" | "unit" | "decision" = "when";
  private historySortDir: "asc" | "desc" = "desc";
  // History table search-by-decision filter
  private historyDecisionFilter: "all" | "approved" | "rejected" | "auto" = "all";

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

  async refresh() {
    const resolvedFile = await resolvePropertyFile(this.app, this.plugin);
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = activeView?.file ?? null;
    const nextFile = resolvedFile ?? activeFile ?? null;

    if (nextFile && nextFile !== this.currentFile) {
      this.currentFile = nextFile;
    } else if (
      this.currentFile &&
      !this.app.vault.getAbstractFileByPath(this.currentFile.path)
    ) {
      this.currentFile = null;
    }

    this.pending = await this.loadPending(this.currentFile);
    if (this.currentFile) {
      const local = await loadHistory(this.plugin, this.currentFile.path);
      let remote = [] as Awaited<ReturnType<typeof fetchHistory>>;
      if (this.plugin.settings.workerUrl) {
        try {
          remote = await fetchHistory(this.plugin.settings);
        } catch (err) {
          console.warn("[Buena] remote history fetch failed", err);
        }
      }
      this.history = mergeHistory(local, remote);
    } else {
      this.history = [];
    }
    this.plugin.statusBar.setPendingCount(this.pending.length);
    this.plugin.statusBar.setStreak(computeStreak(this.history));
    this.plugin.statusBar.setVelocity(computeVelocity(this.history));
    this.render();
  }

  private async loadPending(file: TFile | null): Promise<PendingPatch[]> {
    if (this.plugin.settings.workerUrl) {
      try {
        const remote = await fetchPending(this.plugin.settings);
        return remote
          .map((patch) => this.fromRemotePending(patch))
          .sort(comparePendingByRecency);
      } catch (err) {
        console.warn("[Buena] remote pending fetch failed, falling back to local blocks", err);
      }
    }
    return this.scanPending(file);
  }

  private fromRemotePending(patch: RemotePendingPatch): PendingPatch {
    return {
      id: patch.id,
      section: patch.section,
      unit: patch.unit,
      oldValue: patch.old,
      newValue: patch.new,
      source: patch.source ?? "",
      sourceSnippet: patch.snippet,
      confidence: patch.confidence ?? 0,
      actor: patch.actor ?? "unknown",
      receivedAt: patch.addedAt,
      target_heading: patch.target_heading,
      new_block: patch.new_block,
    };
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

    // Compact header: wordmark + property name + sync.
    const header = root.createDiv({ cls: "buena-sidebar-header" });
    const titleRow = header.createDiv({ cls: "buena-sidebar-title-row" });
    const wordmark = titleRow.createDiv({ cls: "buena-sidebar-wordmark" });
    wordmark.createSpan({ text: "Buena", cls: "buena-wordmark-text" });
    wordmark.createSpan({ text: "/", cls: "buena-wordmark-dot" });
    titleRow.createEl("span", {
      text: this.currentFile?.basename ?? this.plugin.settings.propertyId ?? "",
      cls: "buena-sidebar-property",
    });
    
    const syncBtn = header.createEl("button", {
      cls: "buena-sync-btn",
      attr: { "aria-label": "Sync pending from worker" },
    });
    setIcon(syncBtn, "refresh-cw");
    syncBtn.onclick = async () => {
      syncBtn.addClass("buena-syncing");
      try {
        const { pullPropertySnapshotOnce } = await import("./sync");
        await pullPropertySnapshotOnce(this.plugin);
        const r = await pullPendingOnce(this.plugin);
        new Notice(`[Buena] synced property, state, and ${r.total} remote queue items`);
        await this.refresh();
      } catch (err) {
        console.error("[Buena] sync failed", err);
        new Notice(`[Buena] sync failed: ${err}`);
      } finally {
        syncBtn.removeClass("buena-syncing");
      }
    };

    // Tab strip
    const tabStrip = root.createDiv({ cls: "buena-tabs" });
    this.renderTab(tabStrip, "queue", "Queue", "inbox", this.pending.length);
    this.renderTab(
      tabStrip,
      "history",
      "Change history",
      "history",
      this.history.length
    );

    // Body switches based on active tab.
    const content = root.createDiv({ cls: "buena-sidebar-content" });
    if (this.activeTab === "queue") {
      this.renderQueueTab(content);
    } else {
      this.renderHistoryTab(content);
    }

    // Sticky in-sidebar status bar.
    const statusHost = root.createDiv({ cls: "buena-statusbar" });
    this.plugin.statusBar.attach(statusHost);
  }

  private renderTab(
    parent: HTMLElement,
    id: SidebarTab,
    label: string,
    icon: string,
    count: number
  ) {
    const tab = parent.createEl("button", {
      cls: `buena-tab${this.activeTab === id ? " buena-tab-active" : ""}`,
    });
    setIcon(tab.createSpan({ cls: "buena-tab-icon" }), icon);
    tab.createSpan({ text: label, cls: "buena-tab-label" });
    if (count > 0) {
      tab.createSpan({ text: String(count), cls: "buena-tab-count" });
    }
    tab.onclick = () => {
      this.activeTab = id;
      this.render();
    };
  }

  // ---- Queue tab ------------------------------------------------------

  private renderQueueTab(content: HTMLElement) {
    const units = uniqueUnits(this.pending);
    const reviewCount = this.pending.filter(
      (p) => p.confidence > 0 && p.confidence < 0.85
    ).length;
    if (this.filter.startsWith("unit:")) {
      const u = this.filter.slice(5);
      if (!units.includes(u)) this.filter = "__all__";
    }
    const visiblePending = this.applyFilter(this.pending);

    const pendingSection = content.createDiv({
      cls: "buena-section buena-section-pending buena-section-fullheight",
    });

    if (this.pending.length > 0) {
      const subhead = pendingSection.createDiv({ cls: "buena-subhead" });
      const count = this.pending.length;
      const noun = count === 1 ? "update" : "updates";
      subhead.createSpan({
        text: `${count} pending ${noun}`,
        cls: "buena-subhead-text",
      });
      const filters = subhead.createDiv({ cls: "buena-filter-chips" });
      this.renderChip(filters, "All", "__all__", this.pending.length);
      if (reviewCount > 0) {
        this.renderChip(filters, "Needs review", "__review__", reviewCount);
      }
      for (const u of units) {
        const countForUnit = this.pending.filter((p) => p.unit === u).length;
        this.renderChip(filters, u, `unit:${u}`, countForUnit);
      }
    }

    const pendingBody = pendingSection.createDiv({ cls: "buena-section-body" });

    if (!this.currentFile) {
      pendingBody.createEl("div", {
        text: "Open a property file, for example WEG-Immanuelkirchstrasse-26.md, to see pending patches.",
        cls: "buena-empty",
      });
    } else if (this.pending.length === 0) {
      pendingBody.createEl("div", {
        text: "No pending patches for this property right now.",
        cls: "buena-empty",
      });
    } else if (visiblePending.length === 0) {
      pendingBody.createEl("div", {
        text: `No pending patches match \"${this.filterLabel()}\".`,
        cls: "buena-empty",
      });
    } else {
      for (const p of visiblePending) {
        this.renderPendingCard(pendingBody, p);
      }
    }
  }

  // ---- History tab (Notion-style table) ------------------------------

  private renderHistoryTab(content: HTMLElement) {
    const section = content.createDiv({
      cls: "buena-section buena-section-history-full buena-section-fullheight",
    });

    if (!this.currentFile) {
      section.createEl("div", {
        text: "Open a property file, for example WEG-Immanuelkirchstrasse-26.md, to see change history.",
        cls: "buena-empty",
      });
      return;
    }
    if (this.history.length === 0) {
      section.createEl("div", {
        text: "No changes yet. Approve or reject a pending patch to start the log.",
        cls: "buena-empty",
      });
      return;
    }

    const counts = {
      all: this.history.length,
      approved: this.history.filter((h) => h.decision === "approved").length,
      rejected: this.history.filter((h) => h.decision === "rejected").length,
      auto: this.history.filter((h) => h.decision === "auto").length,
    };

    const subhead = section.createDiv({ cls: "buena-subhead buena-subhead-history" });
    const filters = subhead.createDiv({ cls: "buena-filter-chips buena-filter-chips-history" });
    this.renderHistoryFilterChip(filters, "All", "all", counts.all);
    if (counts.approved > 0) {
      this.renderHistoryFilterChip(filters, "Approved", "approved", counts.approved);
    }
    if (counts.rejected > 0) {
      this.renderHistoryFilterChip(filters, "Rejected", "rejected", counts.rejected);
    }
    if (counts.auto > 0) {
      this.renderHistoryFilterChip(filters, "Auto", "auto", counts.auto);
    }

    const visible = this.applyHistoryFilters(this.history);

    const tableWrap = section.createDiv({ cls: "buena-history-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "buena-history-table" });
    const thead = table.createEl("thead");
    const headRow = thead.createEl("tr");
    this.renderHistoryHeader(headRow, "section", "Section");
    this.renderHistoryHeader(headRow, "unit", "Unit");
    headRow.createEl("th", { text: "What", cls: "buena-th" });
    this.renderHistoryHeader(headRow, "decision", "Decision");
    headRow.createEl("th", { text: "", cls: "buena-th buena-th-actions" });

    const tbody = table.createEl("tbody");
    for (const h of visible) {
      this.renderHistoryRow(tbody, h);
    }
  }

  private renderHistoryHeader(
    row: HTMLElement,
    key: "when" | "section" | "unit" | "decision",
    label: string
  ) {
    const th = row.createEl("th", { cls: "buena-th buena-th-sortable" });
    th.createSpan({ text: label });
    if (this.historySortBy === key) {
      const dirIcon = th.createSpan({ cls: "buena-th-sort-icon" });
      setIcon(dirIcon, this.historySortDir === "asc" ? "chevron-up" : "chevron-down");
    }
    th.onclick = () => {
      if (this.historySortBy === key) {
        this.historySortDir = this.historySortDir === "asc" ? "desc" : "asc";
      } else {
        this.historySortBy = key;
        this.historySortDir = "desc";
      }
      this.render();
    };
  }

  private renderHistoryFilterChip(
    parent: HTMLElement,
    label: string,
    value: "all" | "approved" | "rejected" | "auto",
    count: number
  ) {
    const isActive = this.historyDecisionFilter === value;
    const chip = parent.createEl("button", {
      cls: `buena-chip buena-history-chip buena-history-chip-${value}${isActive ? " buena-chip-active" : ""}`,
    });
    chip.createSpan({ text: label, cls: "buena-chip-label" });
    chip.createSpan({ text: String(count), cls: "buena-chip-count" });
    chip.onclick = () => {
      this.historyDecisionFilter = value;
      this.render();
    };
  }

  private applyHistoryFilters(items: HistoryEntry[]): HistoryEntry[] {
    let filtered = items;
    if (this.historyDecisionFilter !== "all") {
      filtered = filtered.filter(
        (h) => h.decision === this.historyDecisionFilter
      );
    }
    const dir = this.historySortDir === "asc" ? 1 : -1;
    filtered = filtered.slice().sort((a, b) => {
      switch (this.historySortBy) {
        case "when":
          return (
            (new Date(a.timestamp).getTime() -
              new Date(b.timestamp).getTime()) *
            dir
          );
        case "section":
          return a.section.localeCompare(b.section) * dir;
        case "unit":
          return (a.unit ?? "").localeCompare(b.unit ?? "") * dir;
        case "decision":
          return a.decision.localeCompare(b.decision) * dir;
        default:
          return 0;
      }
    });
    return filtered;
  }

  private renderHistoryRow(tbody: HTMLElement, h: HistoryEntry) {
    const tr = tbody.createEl("tr", { cls: `buena-history-row buena-history-${h.decision}` });

    // Section, with inline time meta
    const sectionTd = tr.createEl("td", { cls: "buena-td buena-td-section" });
    const sectionMeta = sectionTd.createDiv({ cls: "buena-history-row-meta" });
    const timeEl = sectionMeta.createSpan({
      text: timeAgo(h.timestamp),
      cls: "buena-history-row-time",
    });
    timeEl.title = new Date(h.timestamp).toLocaleString();
    sectionTd.createDiv({ text: h.section, cls: "buena-history-row-section" });

    // Unit
    const unitTd = tr.createEl("td", { cls: "buena-td buena-td-unit" });
    if (h.unit) {
      unitTd.createSpan({ text: h.unit, cls: "buena-unit-pill" });
    }

    // What
    const whatTd = tr.createEl("td", { cls: "buena-td buena-td-what" });
    whatTd.createDiv({
      text: h.newValue,
      cls: `buena-td-what-text${h.decision === "rejected" ? " buena-strike" : ""}`,
    });
    if (h.decision === "rejected" && h.rejectionReason) {
      whatTd.createDiv({
        text: h.rejectionReason,
        cls: "buena-td-reason",
      });
    }

    // Decision
    const decTd = tr.createEl("td", { cls: "buena-td buena-td-decision" });
    const pill = decTd.createSpan({
      cls: `buena-decision-pill buena-decision-${h.decision}`,
    });
    setIcon(
      pill.createSpan({ cls: "buena-decision-icon" }),
      h.decision === "approved" ? "check" : h.decision === "rejected" ? "x" : "zap"
    );
    pill.createSpan({ 
      text: h.decision.charAt(0).toUpperCase() + h.decision.slice(1), 
      cls: "buena-decision-label" 
    });

    // Actions (hover-only)
    const actionsTd = tr.createEl("td", { cls: "buena-td buena-td-actions" });
    const canReverse = !!h.originalBlock?.target_heading && !!h.originalBlock?.new_block;
    if (canReverse) {
      const reverseBtn = actionsTd.createEl("button", {
        cls: "buena-row-reverse",
        attr: { "aria-label": "Reverse and re-queue this change" },
      });
      setIcon(reverseBtn, "undo-2");
      reverseBtn.title = "Reverse: strip from .md and put back into the pending queue";
      reverseBtn.onclick = (ev) => {
        ev.stopPropagation();
        void this.handleReverse(h);
      };
    }

    whatTd.addClass("buena-history-hover-target");
    attachHoverPopover(whatTd, () => {
      const fields: HoverField[] = [
        { label: "Decision", value: h.decision },
        { label: "When", value: new Date(h.timestamp).toLocaleString() },
        { label: "Actor", value: h.actor },
      ];
      if (h.source) fields.push({ label: "Source", value: h.source, mono: true });
      if (h.oldValue) fields.push({ label: "Was", value: h.oldValue });
      fields.push({ label: "Now", value: h.newValue });
      if (h.rejectionReason) {
        fields.push({ label: "Reason", value: h.rejectionReason });
      }
      return fields;
    });
  }

  // ---- Pending card (used by Queue tab) ------------------------------

  private renderChip(
    parent: HTMLElement,
    label: string,
    value: string,
    count: number
  ) {
    const isActive = this.filter === value;
    const reviewCls = value === "__review__" ? " buena-chip-review" : "";
    const chip = parent.createEl("button", {
      cls: `buena-chip buena-queue-chip${reviewCls}${isActive ? " buena-chip-active" : ""}`,
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

    const top = card.createDiv({ cls: "buena-card-top" });
    const idLine = top.createDiv({ cls: "buena-card-section" });
    const scope = derivePendingScope(p);
    if (scope) {
      const scopeSpan = idLine.createSpan({
        text: scope.label,
        cls: `buena-card-scope buena-card-scope-${scope.kind}`,
      });
      attachHoverPopover(scopeSpan, () => [
        { label: "Scope", value: scope.kind },
        { label: "Value", value: scope.label, mono: true },
        { label: "Section", value: p.section },
      ]);
      idLine.createSpan({ text: " · ", cls: "buena-card-sep" });
    }
    idLine.createSpan({ text: p.section, cls: "buena-card-section-name" });

    if (p.confidence > 0) {
      top.createSpan({
        text: `${(p.confidence * 100).toFixed(0)}% Confidence`,
        cls: "buena-confidence-pill",
      });
    }

    if (p.oldValue) {
      card.createDiv({ text: p.oldValue, cls: "buena-card-old" });
    }
    card.createDiv({ text: p.newValue, cls: "buena-card-new" });

    if (p.sourceSnippet || p.source) {
      const sourceBlock = card.createDiv({ cls: "buena-card-source" });
      if (p.sourceSnippet) {
        sourceBlock.createDiv({
          text: `“${p.sourceSnippet}”`,
          cls: "buena-card-source-quote",
        });
      }
      if (p.source) {
        const sourceMeta = sourceBlock.createDiv({ cls: "buena-card-source-meta" });
        sourceMeta.createSpan({ text: "Source: ", cls: "buena-card-source-label" });
        const sourceValue = sourceMeta.createSpan({
          text: shortSource(p.source),
          cls: "buena-card-source-id",
        });
        attachHoverPopover(sourceValue, () => {
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
    }

    if (p.target_heading && this.currentFile) {
      const goToWrap = card.createDiv({ cls: "buena-goto-wrap" });
      const pill = goToWrap.createEl("button", { cls: "buena-goto-pill" });
      setIcon(pill.createSpan({ cls: "buena-goto-icon" }), "arrow-right");
      pill.createSpan({ text: "Go to section", cls: "buena-goto-label" });
      pill.disabled = true;
      const filePath = this.currentFile.path;
      const heading = p.target_heading;
      findHeadingLine(this.app, filePath, heading)
        .then((lineIdx) => {
          if (lineIdx === null) {
            goToWrap.remove();
            return;
          }
          pill.disabled = false;
          pill.title = `Jump to ${heading}`;
          pill.onclick = () => {
            revealLineInActiveView(this.app, filePath, lineIdx).catch((err) =>
              console.warn("[Buena] go-to-section failed", err)
            );
          };
        })
        .catch(() => goToWrap.remove());
    }

    const actions = card.createDiv({ cls: "buena-card-actions" });
    const approve = actions.createEl("button", {
      text: "Approve",
      cls: "buena-btn buena-btn-primary",
    });
    approve.onclick = () => this.handleApprove(p);

    const reject = actions.createEl("button", {
      text: "Reject",
      cls: "buena-btn",
    });
    const reasonHost = card.createDiv({
      cls: "buena-reject-reason buena-reject-reason-hidden",
    });
    reject.onclick = () => this.toggleRejectReason(p, reasonHost);
  }

  private toggleRejectReason(p: PendingPatch, host: HTMLElement) {
    if (!host.hasClass("buena-reject-reason-hidden")) {
      host.addClass("buena-reject-reason-hidden");
      host.empty();
      return;
    }
    host.removeClass("buena-reject-reason-hidden");
    host.empty();
    host.createEl("label", {
      text: "Why reject this update?",
      cls: "buena-reject-reason-label",
    });
    const ta = host.createEl("textarea", {
      cls: "buena-reject-reason-input",
      attr: {
        placeholder: "e.g. Duplicate issue...",
        rows: "2",
      },
    });
    const row = host.createDiv({ cls: "buena-reject-reason-row" });
    const cancel = row.createEl("button", {
      text: "Cancel",
      cls: "buena-btn",
    });
    cancel.onclick = () => {
      host.addClass("buena-reject-reason-hidden");
      host.empty();
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
      await this.handleRejectWithReason(p, reason);
    };
    confirm.onclick = submit;
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        void submit();
      }
    });
    ta.focus();
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
      const approvedAt = new Date().toISOString();
      const annotatedBlock = annotateApprovedBlock(
        p.new_block,
        approvedAt,
        p.actor,
        p.source,
        p.confidence
      );
      const insertedAt = await applyPatchToVault(
        this.app,
        this.currentFile.path,
        {
          id: p.id,
          target_heading: p.target_heading,
          new_block: annotatedBlock,
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
      await this.notifyWorker(p.id, "approved", p.actor);
      await addHistoryEntry(this.plugin, this.currentFile.path, {
        id: p.id,
        section: p.section,
        unit: p.unit,
        oldValue: p.oldValue,
        newValue: p.newValue,
        source: p.source,
        decision: "approved",
        timestamp: approvedAt,
        actor: p.actor,
        originalBlock: {
          target_heading: p.target_heading,
          new_block: annotatedBlock,
          confidence: p.confidence,
          snippet: p.sourceSnippet,
        },
      });
      await revealLineInActiveView(this.app, this.currentFile.path, insertedAt);
      await this.refresh();
    } catch (err) {
      console.error("[Buena] approve failed", err);
      new Notice(`[Buena] approve failed: ${err}`);
    }
  }

  private async handleRejectWithReason(p: PendingPatch, reason: string) {
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
        rejectionReason: reason,
        originalBlock: {
          target_heading: p.target_heading,
          new_block: p.new_block,
          confidence: p.confidence,
          snippet: p.sourceSnippet,
        },
      });
      new Notice(`[Buena] rejected ${p.id}`);
      await this.notifyWorker(p.id, "rejected", p.actor, reason);
      await this.refresh();
    } catch (err) {
      console.error("[Buena] reject failed", err);
      new Notice(`[Buena] reject failed: ${err}`);
    }
  }

  private async handleReverse(h: HistoryEntry) {
    if (!this.currentFile) return;
    try {
      const ok = await reverseHistoryEntry(this.app, this.currentFile.path, {
        id: h.id,
        section: h.section,
        unit: h.unit,
        newValue: h.newValue,
        source: h.source,
        actor: h.actor,
        originalBlock: h.originalBlock,
      });
      if (!ok) {
        new Notice(`[Buena] reverse failed for ${h.id}`);
        return;
      }
      await removeHistoryEntry(this.plugin, this.currentFile.path, h.id);
      new Notice(`[Buena] reversed ${h.id}, back in queue`);
      await this.refresh();
    } catch (err) {
      console.error("[Buena] reverse failed", err);
      new Notice(`[Buena] reverse failed: ${err}`);
    }
  }

  private async notifyWorker(
    patchId: string,
    decision: "approved" | "rejected",
    actor: string,
    reason?: string
  ) {
    if (!this.plugin.settings.workerUrl) return;
    await postDecision(
      this.plugin.settings,
      patchId,
      decision,
      actor || "human",
      reason
    );
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

function computeStreak(history: HistoryEntry[]): number {
  if (history.length === 0) return 0;
  const days = new Set<string>();
  for (const h of history) {
    const t = new Date(h.timestamp);
    if (!Number.isFinite(t.getTime())) continue;
    days.add(dayKey(t));
  }
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function computeVelocity(history: HistoryEntry[]): {
  today: number;
  delta: number;
} {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const todayKey = dayKey(today);
  const yesterdayKey = dayKey(yesterday);
  let t = 0;
  let y = 0;
  for (const h of history) {
    if (h.decision !== "approved") continue;
    const k = dayKey(new Date(h.timestamp));
    if (k === todayKey) t += 1;
    else if (k === yesterdayKey) y += 1;
  }
  return { today: t, delta: t - y };
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function comparePendingByRecency(a: PendingPatch, b: PendingPatch): number {
  const at = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
  const bt = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
  if (at !== bt) return bt - at;
  return a.id.localeCompare(b.id);
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

function derivePendingScope(
  p: Pick<PendingPatch, "unit" | "newValue" | "sourceSnippet" | "new_block">
): { kind: "unit" | "building" | "provider"; label: string } | null {
  if (p.unit) return { kind: "unit", label: p.unit };
  const hay = [p.newValue, p.sourceSnippet, p.new_block].filter(Boolean).join(" \n ");
  const building = /\b(HAUS-\d+)\b/i.exec(hay);
  if (building) return { kind: "building", label: building[1].toUpperCase() };
  const provider = /\b(DL-\d+)\b/i.exec(hay);
  if (provider) return { kind: "provider", label: provider[1].toUpperCase() };
  return null;
}

function annotateApprovedBlock(
  block: string,
  approvedAt: string,
  actor: string,
  source?: string,
  confidence?: number
): string {
  const prov = source
    ? ` {prov: ${source}${typeof confidence === "number" ? ` | conf: ${confidence}` : ""} | actor: ${actor}}`
    : "";
  const changed = ` {changed: ${approvedAt} | actor: ${actor}${source ? ` | src: ${source}` : ""}}`;
  return `${block}${prov}${changed}`;
}

function mergeHistory(
  local: HistoryEntry[],
  remote: Array<{
    id: string;
    section: string;
    unit?: string;
    oldValue?: string;
    newValue: string;
    source?: string;
    decision: "approved" | "rejected" | "auto";
    timestamp: string;
    actor: string;
    reason?: string;
  }>
): HistoryEntry[] {
  const byKey = new Map<string, HistoryEntry>();

  for (const item of remote) {
    const key = `${item.id}:${item.decision}`;
    byKey.set(key, {
      id: item.id,
      section: item.section,
      unit: item.unit,
      oldValue: item.oldValue,
      newValue: item.newValue,
      source: item.source,
      decision: item.decision,
      timestamp: item.timestamp,
      actor: item.actor,
      rejectionReason: item.reason,
    });
  }

  for (const item of local) {
    const key = `${item.id}:${item.decision}`;
    // Local wins because it has originalBlock metadata needed for reverse.
    byKey.set(key, item);
  }

  return [...byKey.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
