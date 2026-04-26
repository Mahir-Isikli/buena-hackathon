import {
  ItemView,
  MarkdownView,
  Menu,
  Notice,
  parseYaml,
  setIcon,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import type BuenaPlugin from "../main";
import { attachHoverPopover, HoverField } from "./hover";
import { isPreviewableSource, loadSourcePreview, openProvenanceSource } from "./provenance-open";
import {
  addHistoryEntry,
  HistoryEntry,
  loadHistory,
  removeHistoryEntry,
} from "./history";
import {
  findHeadingLine,
  findPendingBlocks,
  revealLineInActiveView,
  reverseHistoryEntry,
} from "./vault-patch";
import {
  fetchHistory,
  fetchPending,
  fetchVaults,
  postDecision,
  RemoteHistoryEntry,
  RemotePendingPatch,
  type RemoteVaultSummary,
} from "./api";
import { pullPendingOnce, resolvePropertyFile, pullPropertySnapshotOnce } from "./sync";
import { getErpStore } from "./erp";

export const BUENA_SIDEBAR_VIEW_TYPE = "buena-sidebar";

interface SenderInfo {
  email?: string;
  name?: string;
  erpId?: string;
  role?: "owner" | "tenant" | "provider" | "unknown";
  unitIds?: string[];
}

interface SourceMeta {
  kind?: "email" | "bulk" | "unknown";
  filename?: string;
  mimeType?: string;
  subject?: string;
  receivedAt?: string;
  recipient?: string;
  note?: string;
}

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
  sender?: SenderInfo;
  sourceMeta?: SourceMeta;
}

type SidebarTab = "queue" | "history";

export class BuenaSidebarView extends ItemView {
  plugin: BuenaPlugin;
  private pending: PendingPatch[] = [];
  private history: HistoryEntry[] = [];
  private currentFile: TFile | null = null;
  // Filter modes: "__all__" | "__conflict__" | "scope:unit" | "scope:building" | "scope:provider"
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

  async refresh(prefetched?: {
    pending?: RemotePendingPatch[];
    history?: RemoteHistoryEntry[];
  }): Promise<void> {
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

    if (prefetched?.pending) {
      this.plugin.setPendingCache(prefetched.pending);
      this.pending = prefetched.pending
        .map((patch) => this.fromRemotePending(patch))
        .sort(comparePendingByRecency);
    } else {
      this.pending = await this.loadPending(this.currentFile);
    }

    if (this.currentFile) {
      // Local history is fast (plugin data), do it in parallel with the
      // optional remote fetch.
      const localPromise = loadHistory(this.plugin, this.currentFile.path);
      const remotePromise = prefetched?.history
        ? Promise.resolve(prefetched.history)
        : this.plugin.settings.workerUrl
          ? fetchHistory(this.plugin.settings).catch((err) => {
              console.warn("[Buena] remote history fetch failed", err);
              return [] as RemoteHistoryEntry[];
            })
          : Promise.resolve([] as RemoteHistoryEntry[]);
      const [local, remote] = await Promise.all([localPromise, remotePromise]);
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
        this.plugin.setPendingCache(remote);
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
      sender: patch.sender,
      sourceMeta: patch.sourceMeta,
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
    const kontextMark = wordmark.createSpan({ cls: "buena-kontext-mark", attr: { "aria-hidden": "true" } });
    kontextMark.innerHTML = `<svg viewBox="0 0 315 394" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M104.5 170.152V248.257C104.5 252.617 108.034 256.152 112.394 256.152C114.684 256.152 116.861 255.157 118.361 253.426L190.5 170.152H313L212 271.152H95C63.5 268.485 0.5 244.552 0.5 170.152V28.5183L104.5 0.651611V170.152Z"/><path d="M0.5 170.152H104.5M0.5 170.152C0.5 244.552 63.5 268.485 95 271.152H212L313 170.152H190.5L118.361 253.426C116.861 255.157 114.684 256.152 112.394 256.152C108.034 256.152 104.5 252.617 104.5 248.257V170.152M0.5 170.152V28.5183L104.5 0.651611V170.152" stroke="currentColor"/><path d="M104.5 393.152H0.5C0.5 318.752 63.5 294.818 95 292.152H212L313 393.152H190.5L118.361 309.877C116.861 308.146 114.684 307.152 112.394 307.152C108.034 307.152 104.5 310.686 104.5 315.046V393.152Z" stroke="currentColor"/></svg>`;
    wordmark.createSpan({ cls: "buena-wordmark-divider" });
    wordmark.createSpan({ text: "Buena", cls: "buena-wordmark-text" });
    titleRow.createSpan({ cls: "buena-wordmark-divider" });
    const propertyPicker = titleRow.createEl("button", {
      cls: "buena-sidebar-property buena-property-picker",
      attr: { "aria-label": "Switch property" },
    });
    propertyPicker.createSpan({
      text: this.plugin.settings.propertyId || this.currentFile?.basename || "",
      cls: "buena-property-picker-label",
    });
    setIcon(propertyPicker.createSpan({ cls: "buena-property-picker-caret" }), "chevron-down");
    propertyPicker.onclick = (evt) => this.openPropertyPicker(evt);
    
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

  private async openPropertyPicker(evt: MouseEvent): Promise<void> {
    let vaults: RemoteVaultSummary[] = [];
    try {
      vaults = await fetchVaults(this.plugin.settings);
    } catch (err) {
      console.warn("[Buena] fetchVaults failed", err);
      new Notice(`[Buena] could not load properties: ${err}`);
      return;
    }
    const menu = new Menu();
    const current = this.plugin.settings.propertyId;
    if (vaults.length === 0) {
      menu.addItem((item) => item.setTitle("No properties found").setDisabled(true));
    } else {
      for (const v of vaults) {
        const label = v.name ? `${v.id} · ${v.name}` : v.id;
        menu.addItem((item) => {
          item.setTitle(label);
          if (v.id === current) item.setIcon("check");
          item.onClick(async () => {
            if (v.id === current) return;
            await this.switchProperty(v.id);
          });
        });
      }
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("Refresh property list").setIcon("refresh-cw").onClick(async () => {
        await this.refresh();
      })
    );
    menu.showAtMouseEvent(evt);
  }

  private async switchProperty(newId: string): Promise<void> {
    if (newId === this.plugin.settings.propertyId) return;
    new Notice(`[Buena] switching to ${newId}…`);
    await this.plugin.switchProperty(newId);
    if (this.plugin.settings.propertyId === newId) {
      new Notice(`[Buena] switched to ${newId}`);
    }
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
    const counts = countByScope(this.pending);
    // If the active filter no longer has any matching items, fall back to All.
    if (this.filter !== "__all__" && filterCount(this.filter, counts) === 0) {
      this.filter = "__all__";
    }
    const visiblePending = this.applyFilter(this.pending);

    const pendingSection = content.createDiv({
      cls: "buena-section buena-section-pending buena-section-fullheight",
    });

    if (this.pending.length > 0) {
      const subhead = pendingSection.createDiv({ cls: "buena-subhead" });
      const filters = subhead.createDiv({ cls: "buena-filter-chips" });
      this.renderChip(filters, "All", "__all__", this.pending.length);
      if (counts.conflict > 0) {
        this.renderChip(filters, "Conflicts", "__conflict__", counts.conflict);
      }
      if (counts.unit > 0) {
        this.renderChip(filters, "Units", "scope:unit", counts.unit);
      }
      if (counts.building > 0) {
        this.renderChip(filters, "Buildings", "scope:building", counts.building);
      }
      if (counts.provider > 0) {
        this.renderChip(filters, "Providers", "scope:provider", counts.provider);
      }
    }

    const pendingBody = pendingSection.createDiv({ cls: "buena-section-body" });

    if (!this.currentFile) {
      pendingBody.createEl("div", {
        text: "Open a property file to see pending patches.",
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
        text: "Open a property file to see change history.",
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
    headRow.createEl("th", { text: "Source", cls: "buena-th" });
    this.renderHistoryHeader(headRow, "decision", "Outcome");
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

    // Source (own column)
    const sourceTd = tr.createEl("td", { cls: "buena-td buena-td-source" });
    if (h.source) {
      const src = h.source;
      const hSender = h.sender;
      const hSourceMeta = h.sourceMeta;
      const sourcePill = sourceTd.createEl("button", {
        text: senderDisplayName(hSender) ?? sourceChipLabel(src),
        cls: "buena-source-pill buena-source-pill-sm",
      });
      // No native title here — the custom hover popover shows the same info
      // and we don't want both browser tooltip and popover firing at once.
      attachHoverPopover(
        sourcePill,
        () =>
          buildSourceFields(src, hSender, hSourceMeta, [
            { label: "When", value: new Date(h.timestamp).toLocaleString() },
          ]),
        isPreviewableSource(src)
          ? {
              title: previewTitle(src),
              load: () => loadSourcePreview(this.plugin, src),
            }
          : undefined
      );
      sourcePill.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void openProvenanceSource(this.plugin, src);
      };
    }

    // Decision
    const decTd = tr.createEl("td", { cls: "buena-td buena-td-decision" });
    const pill = decTd.createSpan({
      cls: `buena-decision-pill buena-decision-${h.decision}`,
    });
    const iconName =
      h.decision === "approved" ? "check" : h.decision === "rejected" ? "x" : "zap";
    setIcon(pill.createSpan({ cls: "buena-decision-icon" }), iconName);
    pill.title =
      h.decision === "approved"
        ? "Approved"
        : h.decision === "rejected"
        ? "Rejected"
        : "Auto-applied";

    // Actions (hover-only)
    const actionsTd = tr.createEl("td", { cls: "buena-td buena-td-actions" });
    const canReverse = !!h.originalBlock?.target_heading && !!h.originalBlock?.new_block;
    if (canReverse) {
      const reverseBtn = actionsTd.createEl("button", {
        cls: "buena-row-reverse",
        attr: { "aria-label": "Reverse and re-queue this change" },
      });
      setIcon(reverseBtn, "undo-2");
      reverseBtn.title = "Move this entry back to the pending queue";
      reverseBtn.onclick = (ev) => {
        ev.stopPropagation();
        void this.handleReverse(h);
      };
    }

    const whatTextEl = whatTd.querySelector(".buena-td-what-text") as HTMLElement | null;
    if (whatTextEl) {
      whatTextEl.addClass("buena-history-hover-target");
      attachHoverPopover(whatTextEl, () => {
        const fields: HoverField[] = [
          { label: "When", value: new Date(h.timestamp).toLocaleString() },
        ];
        if (h.oldValue) fields.push({ label: "Was", value: h.oldValue });
        fields.push({ label: "Now", value: h.newValue });
        if (h.rejectionReason) {
          fields.push({ label: "Reason", value: h.rejectionReason });
        }
        return fields;
      });
    }
  }

  // ---- Pending card (used by Queue tab) ------------------------------

  private renderChip(
    parent: HTMLElement,
    label: string,
    value: string,
    count: number
  ) {
    const isActive = this.filter === value;
    const accentCls = value === "__conflict__" ? " buena-chip-conflict" : "";
    const chip = parent.createEl("button", {
      cls: `buena-chip buena-queue-chip${accentCls}${isActive ? " buena-chip-active" : ""}`,
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
    if (this.filter === "__conflict__") {
      return items.filter((p) => Boolean(p.oldValue));
    }
    if (this.filter.startsWith("scope:")) {
      const want = this.filter.slice(6) as "unit" | "building" | "provider";
      return items.filter((p) => derivePendingScope(p)?.kind === want);
    }
    return items;
  }

  private filterLabel(): string {
    if (this.filter === "__all__") return "All";
    if (this.filter === "__conflict__") return "Conflicts";
    if (this.filter === "scope:unit") return "Units";
    if (this.filter === "scope:building") return "Buildings";
    if (this.filter === "scope:provider") return "Providers";
    return this.filter;
  }

  private renderPendingCard(parent: HTMLElement, p: PendingPatch) {
    const card = parent.createDiv({ cls: "buena-card buena-card-pending" });

    const top = card.createDiv({ cls: "buena-card-top" });
    const idLine = top.createDiv({ cls: "buena-card-section" });
    const scope = derivePendingScope(p);
    if (scope) {
      idLine.createSpan({
        text: scope.label,
        cls: `buena-card-scope buena-card-scope-${scope.kind}`,
      });
    } else {
      // No resolvable scope, fall back to the section name so the header isn't empty.
      idLine.createSpan({ text: p.section, cls: "buena-card-section-name" });
    }

    const topIndicators = top.createDiv({ cls: "buena-card-indicators" });

    if (p.source) {
      const sourcePill = topIndicators.createEl("button", {
        cls: `buena-source-icon buena-source-icon-${sourceKind(p.source)}`,
        attr: { "aria-label": "View source" },
      });
      setIcon(sourcePill, sourceIconName(p.source));
      // No native title here — the custom hover popover replaces it.
      const pSrc = p.source;
      const pSender = p.sender;
      const pSourceMeta = p.sourceMeta;
      attachHoverPopover(
        sourcePill,
        () => buildSourceFields(pSrc, pSender, pSourceMeta),
        isPreviewableSource(pSrc)
          ? {
              title: previewTitle(pSrc),
              load: () => loadSourcePreview(this.plugin, pSrc),
            }
          : undefined
      );
      sourcePill.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void openProvenanceSource(this.plugin, p.source);
      };
    }

    if (p.confidence > 0) {
      topIndicators.createSpan({
        text: `${(p.confidence * 100).toFixed(0)}%`,
        cls: "buena-confidence-pill",
      });
    }

    const senderName = senderDisplayName(p.sender);
    const roleLabel = senderRoleLabel(p.sender?.role);
    if (senderName) {
      const senderRow = card.createDiv({ cls: "buena-card-sender" });
      senderRow.createSpan({ text: "From", cls: "buena-card-sender-label" });
      senderRow.createSpan({ text: senderName, cls: "buena-card-sender-name" });
      const meta: string[] = [];
      if (roleLabel) meta.push(roleLabel);
      if (p.sender?.erpId) meta.push(p.sender.erpId);
      if (meta.length) {
        senderRow.createSpan({ text: meta.join(" · "), cls: "buena-card-sender-role" });
      }
    }

    const diff = card.createDiv({ cls: `buena-card-diff${p.oldValue ? " has-old" : ""}` });
    if (p.oldValue) {
      diff.createDiv({ text: p.oldValue, cls: "buena-card-old" });
    }
    const newRow = diff.createDiv({ cls: "buena-card-new" });
    newRow.createSpan({ text: p.newValue, cls: "buena-card-new-text" });

    if (p.sourceSnippet) {
      const sourceBlock = card.createDiv({ cls: "buena-card-source" });
      sourceBlock.createDiv({
        text: `“${p.sourceSnippet}”`,
        cls: "buena-card-source-quote",
      });
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
          pill.disabled = false;
          if (lineIdx === null) {
            pill.title = `Open property file, ${heading} will be created on approval`;
            pill.onclick = () => {
              revealLineInActiveView(this.app, filePath, 0).catch((err) =>
                console.warn("[Buena] open-property failed", err)
              );
            };
            return;
          }
          pill.title = `Jump to ${heading}`;
          pill.onclick = () => {
            revealLineInActiveView(this.app, filePath, lineIdx).catch((err) =>
              console.warn("[Buena] go-to-section failed", err)
            );
          };
        })
        .catch(() => {
          pill.disabled = false;
          pill.onclick = () => {
            revealLineInActiveView(this.app, filePath, 0).catch((err) =>
              console.warn("[Buena] open-property failed", err)
            );
          };
        });
    }

    const actions = card.createDiv({ cls: "buena-card-actions" });
    const approve = actions.createEl("button", {
      cls: "buena-btn-icon-circle buena-btn-icon-approve",
    });
    approve.setAttr("aria-label", "Approve");
    approve.setAttr("title", "Approve");
    approve.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3.5 8.5 6.5 11.5 12.5 5"/></svg>`;
    approve.onclick = () => this.handleApprove(p);

    const reject = actions.createEl("button", {
      cls: "buena-btn-icon-circle buena-btn-icon-reject",
    });
    reject.setAttr("aria-label", "Reject");
    reject.setAttr("title", "Reject");
    reject.innerHTML = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;
    const reasonHost = card.createDiv({
      cls: "buena-reject-reason buena-reject-reason-hidden",
    });
    reject.onclick = () => this.toggleRejectReason(p, reasonHost);
  }

  private toggleRejectReason(p: PendingPatch, host: HTMLElement) {
    const card = host.closest(".buena-card-pending");
    if (!host.hasClass("buena-reject-reason-hidden")) {
      host.addClass("buena-reject-reason-hidden");
      host.empty();
      card?.removeClass("is-rejecting");
      return;
    }
    host.removeClass("buena-reject-reason-hidden");
    host.empty();
    card?.addClass("is-rejecting");
    const headRow = host.createDiv({ cls: "buena-reject-reason-head" });
    headRow.createEl("label", {
      text: "Why reject this update?",
      cls: "buena-reject-reason-label",
    });
    const actions = headRow.createDiv({ cls: "buena-reject-reason-row" });
    const cancel = actions.createEl("button", {
      text: "Cancel",
      cls: "buena-reject-cancel",
    });
    cancel.onclick = () => {
      host.addClass("buena-reject-reason-hidden");
      host.empty();
      card?.removeClass("is-rejecting");
    };
    const confirm = actions.createEl("button", {
      cls: "buena-reject-confirm",
    });
    const ta = host.createEl("textarea", {
      cls: "buena-reject-reason-input",
      attr: {
        placeholder: "e.g. Duplicate, already filed, wrong unit...",
        rows: "2",
      },
    });
    confirm.innerHTML = `<span class="buena-reject-confirm-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg></span><span>Reject</span>`;
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
        sender: p.sender,
        sourceMeta: p.sourceMeta,
        originalBlock: {
          target_heading: p.target_heading,
          new_block: p.new_block,
          confidence: p.confidence,
          snippet: p.sourceSnippet,
        },
      });
      await pullPropertySnapshotOnce(this.plugin);
      this.plugin.statusBar.markPatchReceived();
      new Notice(`[Buena] approved ${p.id}`);
      const lineIdx = await findHeadingLine(
        this.app,
        this.currentFile.path,
        p.target_heading
      );
      await this.refresh();
      if (lineIdx !== null) {
        await revealLineInActiveView(this.app, this.currentFile.path, lineIdx);
      }
    } catch (err) {
      console.error("[Buena] approve failed", err);
      new Notice(`[Buena] approve failed: ${err}`);
    }
  }

  private async handleRejectWithReason(p: PendingPatch, reason: string) {
    if (!this.currentFile) return;
    try {
      await this.notifyWorker(p.id, "rejected", p.actor, reason);
      await addHistoryEntry(this.plugin, this.currentFile.path, {
        id: p.id,
        section: p.section,
        unit: p.unit,
        oldValue: p.oldValue,
        newValue: p.newValue,
        source: p.source,
        decision: "rejected",
        timestamp: new Date().toISOString(),
        sender: p.sender,
        sourceMeta: p.sourceMeta,
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

function sourceChipLabel(source: string): string {
  const summary = sourceSummary(source);
  const lower = summary.toLowerCase();
  if (lower.endsWith(".eml")) return "Email";
  if (lower.endsWith(".pdf")) return "PDF";
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) {
    return "Image";
  }
  if (lower.endsWith(".docx")) return "DOCX";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "Sheet";
  return summary.length > 18 ? `${summary.slice(0, 18)}…` : summary;
}

function sourceSummary(source: string): string {
  return source
    .replace(/^r2:\/\/buena-raw\//, "")
    .trim();
}

function senderRoleLabel(role?: SenderInfo["role"]): string | null {
  switch (role) {
    case "owner": return "Owner";
    case "tenant": return "Tenant";
    case "provider": return "Service provider";
    case "unknown":
    default: return null;
  }
}

function senderDisplayName(sender?: SenderInfo): string | null {
  if (!sender) return null;
  if (sender.name && sender.name.length > 0) return sender.name;
  if (sender.email) return sender.email;
  if (sender.erpId) return sender.erpId;
  return null;
}

function buildSourceFields(
  source: string,
  sender?: SenderInfo,
  sourceMeta?: SourceMeta,
  extra?: HoverField[]
): HoverField[] {
  const fields: HoverField[] = [];
  const senderName = senderDisplayName(sender);
  if (senderName) {
    fields.push({ label: "From", value: senderName });
  }
  if (sender?.email && sender.email !== senderName) {
    fields.push({ label: "Email", value: sender.email, mono: true });
  }
  const role = senderRoleLabel(sender?.role);
  if (role || sender?.erpId) {
    const idPart = sender?.erpId ? ` (${sender.erpId})` : "";
    fields.push({ label: "Linked to", value: `${role ?? "Unknown"}${idPart}` });
  }
  if (sender?.unitIds && sender.unitIds.length) {
    fields.push({ label: "Units", value: sender.unitIds.join(", "), mono: true });
  }
  if (sourceMeta?.subject) {
    fields.push({ label: "Subject", value: sourceMeta.subject });
  }
  if (sourceMeta?.recipient) {
    fields.push({ label: "To", value: sourceMeta.recipient, mono: true });
  }
  if (extra) fields.push(...extra);
  if (fields.length === 0) {
    fields.push({ label: "Source", value: sourceSummary(source), mono: true });
  }
  return fields;
}

function sourceKind(source: string): "email" | "pdf" | "image" | "sheet" | "doc" | "file" {
  const lower = sourceSummary(source).toLowerCase();
  if (lower.endsWith(".eml")) return "email";
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpg|jpeg|webp|gif)$/.test(lower)) return "image";
  if (/\.(xlsx|xls|csv)$/.test(lower)) return "sheet";
  if (/\.(docx|doc|md|txt|html?)$/.test(lower)) return "doc";
  return "file";
}

function sourceIconName(source: string): string {
  switch (sourceKind(source)) {
    case "email": return "mail";
    case "pdf": return "file-text";
    case "image": return "image";
    case "sheet": return "sheet";
    case "doc": return "file";
    default: return "paperclip";
  }
}

function previewTitle(source: string): string {
  const lower = sourceSummary(source).toLowerCase();
  if (lower.endsWith(".eml")) return "Email body";
  if (lower.endsWith(".pdf")) return "PDF preview";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "Page preview";
  return "Source preview";
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
  if (value === "__conflict__") return "alert-triangle";
  if (value === "scope:unit") return "home";
  if (value === "scope:building") return "building-2";
  if (value === "scope:provider") return "wrench";
  return null;
}

interface ScopeCounts {
  conflict: number;
  unit: number;
  building: number;
  provider: number;
}

function countByScope(pending: PendingPatch[]): ScopeCounts {
  const out: ScopeCounts = { conflict: 0, unit: 0, building: 0, provider: 0 };
  for (const p of pending) {
    if (p.oldValue) out.conflict += 1;
    const scope = derivePendingScope(p);
    if (scope?.kind === "unit") out.unit += 1;
    else if (scope?.kind === "building") out.building += 1;
    else if (scope?.kind === "provider") out.provider += 1;
  }
  return out;
}

function filterCount(filter: string, counts: ScopeCounts): number {
  if (filter === "__conflict__") return counts.conflict;
  if (filter === "scope:unit") return counts.unit;
  if (filter === "scope:building") return counts.building;
  if (filter === "scope:provider") return counts.provider;
  return 0;
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

function derivePendingScope(
  p: Pick<PendingPatch, "unit" | "newValue" | "sourceSnippet" | "new_block">
): { kind: "unit" | "building" | "provider"; label: string } | null {
  const store = getErpStore();

  if (p.unit) {
    const r = store?.resolve(p.unit);
    return { kind: "unit", label: r ? r.label : p.unit };
  }

  const hay = [p.newValue, p.sourceSnippet, p.new_block].filter(Boolean).join(" \n ");

  const building = /\b(HAUS-\d+)\b/i.exec(hay);
  if (building) {
    const id = building[1].toUpperCase();
    const r = store?.resolve(id);
    return { kind: "building", label: r ? r.label : id };
  }

  const provider = /\b(DL-\d+)\b/i.exec(hay);
  if (provider) {
    const id = provider[1].toUpperCase();
    const r = store?.resolve(id);
    return { kind: "provider", label: r ? r.label : id };
  }

  return null;
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
    sender?: HistoryEntry["sender"];
    sourceMeta?: HistoryEntry["sourceMeta"];
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
      sender: item.sender,
      sourceMeta: item.sourceMeta,
    });
  }

  for (const item of local) {
    const key = `${item.id}:${item.decision}`;
    // Local wins because it has originalBlock metadata needed for reverse.
    byKey.set(key, item);
  }

  return [...byKey.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
