import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type BuenaPlugin from "../main";

export const BUENA_SIDEBAR_VIEW_TYPE = "buena-sidebar";

interface PendingPatch {
  id: string;
  section: string;
  oldValue?: string;
  newValue: string;
  source: string;
  confidence: number;
  actor: string;
}

interface HistoryEntry {
  id: string;
  section: string;
  oldValue?: string;
  newValue: string;
  decision: "auto" | "approved" | "rejected";
  timestamp: string;
  actor: string;
}

// Mock data so the sidebar has something to render before the Worker exists.
const MOCK_PENDING: PendingPatch[] = [
  {
    id: "p-001",
    section: "Units / EH-014",
    newValue: "Tenant withholding 10% rent due to broken hot water (since 2026-01-15)",
    source: "emails/2026-01-15/EMAIL-12891.eml",
    confidence: 0.91,
    actor: "gemini-flash",
  },
  {
    id: "p-002",
    section: "Service providers / Hausmeister",
    oldValue: "650 EUR/Monat",
    newValue: "720 EUR/Monat (price increase notice)",
    source: "briefe/2026-04-10/BRIEF-00781.pdf",
    confidence: 0.87,
    actor: "gemini-2.5-pro",
  },
];

const MOCK_HISTORY: HistoryEntry[] = [
  {
    id: "h-001",
    section: "Open issues",
    newValue: "Wartungstermin Heizung bestätigt für 06.10.2024 um 10:00",
    decision: "auto",
    timestamp: "2026-04-22T08:14:00Z",
    actor: "gemini-flash",
  },
  {
    id: "h-002",
    section: "Bank",
    oldValue: "DE02 1001 0010 0123 4567 89",
    newValue: "DE02 1001 0010 0123 4567 89 (Postbank Berlin)",
    decision: "approved",
    timestamp: "2026-04-20T11:02:00Z",
    actor: "human",
  },
];

export class BuenaSidebarView extends ItemView {
  plugin: BuenaPlugin;

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
    return "building-2";
  }

  async onOpen() {
    this.render();
  }

  async onClose() {
    this.contentEl.empty();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("buena-sidebar");

    // Header
    const header = root.createDiv({ cls: "buena-sidebar-header" });
    const titleRow = header.createDiv({ cls: "buena-sidebar-title-row" });
    const titleIcon = titleRow.createSpan({ cls: "buena-sidebar-title-icon" });
    setIcon(titleIcon, "building-2");
    titleRow.createEl("h3", { text: "Buena", cls: "buena-sidebar-title" });
    header.createEl("div", {
      text: this.plugin.settings.propertyId,
      cls: "buena-sidebar-subtitle",
    });

    // Pending queue
    const pendingSection = root.createDiv({ cls: "buena-section" });
    const pendingHeader = pendingSection.createDiv({ cls: "buena-section-header" });
    pendingHeader.createEl("h4", { text: "Pending queue" });
    pendingHeader.createEl("span", {
      text: `${MOCK_PENDING.length}`,
      cls: "buena-badge",
    });

    if (MOCK_PENDING.length === 0) {
      pendingSection.createEl("div", {
        text: "No pending patches.",
        cls: "buena-empty",
      });
    } else {
      for (const p of MOCK_PENDING) {
        this.renderPendingCard(pendingSection, p);
      }
    }

    // History
    const historySection = root.createDiv({ cls: "buena-section" });
    historySection.createEl("h4", { text: "Recent changes" });
    if (MOCK_HISTORY.length === 0) {
      historySection.createEl("div", {
        text: "No changes yet.",
        cls: "buena-empty",
      });
    } else {
      for (const h of MOCK_HISTORY) {
        this.renderHistoryCard(historySection, h);
      }
    }
  }

  private renderPendingCard(parent: HTMLElement, p: PendingPatch) {
    const card = parent.createDiv({ cls: "buena-card buena-card-pending" });
    card.createDiv({ text: p.section, cls: "buena-card-section" });
    if (p.oldValue) {
      card.createDiv({ text: `was: ${p.oldValue}`, cls: "buena-card-old" });
    }
    card.createDiv({ text: p.newValue, cls: "buena-card-new" });

    const meta = card.createDiv({ cls: "buena-card-meta" });
    meta.createSpan({ text: `conf ${(p.confidence * 100).toFixed(0)}%`, cls: "buena-meta-pill" });
    meta.createSpan({ text: p.actor, cls: "buena-meta-pill" });
    meta.createSpan({ text: p.source, cls: "buena-meta-source" });

    const actions = card.createDiv({ cls: "buena-card-actions" });
    const approve = actions.createEl("button", { text: "Approve", cls: "buena-btn buena-btn-primary" });
    approve.onclick = () => this.handleApprove(p.id);
    const reject = actions.createEl("button", { text: "Reject", cls: "buena-btn" });
    reject.onclick = () => this.handleReject(p.id);
    const edit = actions.createEl("button", { text: "Edit", cls: "buena-btn" });
    edit.onclick = () => this.handleEdit(p.id);
  }

  private renderHistoryCard(parent: HTMLElement, h: HistoryEntry) {
    const card = parent.createDiv({ cls: "buena-card buena-card-history" });
    card.createDiv({ text: h.section, cls: "buena-card-section" });
    if (h.oldValue) {
      card.createDiv({ text: `was: ${h.oldValue}`, cls: "buena-card-old" });
    }
    card.createDiv({ text: h.newValue, cls: "buena-card-new" });
    const meta = card.createDiv({ cls: "buena-card-meta" });
    meta.createSpan({ text: h.decision, cls: `buena-meta-pill buena-decision-${h.decision}` });
    meta.createSpan({ text: h.actor, cls: "buena-meta-pill" });
    meta.createSpan({ text: new Date(h.timestamp).toLocaleString(), cls: "buena-meta-source" });
  }

  private handleApprove(id: string) {
    console.log("[Buena] approve patch", id);
    this.plugin.statusBar.bumpPendingCount(-1);
    this.plugin.statusBar.markPatchReceived();
  }

  private handleReject(id: string) {
    console.log("[Buena] reject patch", id);
    this.plugin.statusBar.bumpPendingCount(-1);
  }

  private handleEdit(id: string) {
    console.log("[Buena] edit patch", id);
  }
}
