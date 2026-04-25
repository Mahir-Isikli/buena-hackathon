import { ItemView, WorkspaceLeaf } from "obsidian";
import type BuenaPlugin from "../main";
import { attachHoverPopover, HoverField } from "./hover";

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
  receivedAt: string;
}

interface HistoryEntry {
  id: string;
  section: string;
  unit?: string;
  oldValue?: string;
  newValue: string;
  source?: string;
  decision: "auto" | "approved" | "rejected";
  timestamp: string;
  actor: string;
}

const MOCK_PENDING: PendingPatch[] = [
  {
    id: "p-001",
    section: "Open issues",
    unit: "EH-014",
    newValue:
      "Tenant withholding 10% rent due to broken hot water (since 2026-01-15)",
    source: "emails/2026-01-15/EMAIL-12891.eml",
    sourceSnippet:
      "Sehr geehrte Damen und Herren, seit dem 15. Januar gibt es in unserer Wohnung kein Warmwasser mehr...",
    confidence: 0.91,
    actor: "gemini-flash",
    receivedAt: "2026-04-25T09:14:00Z",
  },
  {
    id: "p-002",
    section: "Service providers",
    unit: "Hausmeister",
    oldValue: "650 EUR/Monat",
    newValue: "720 EUR/Monat (price increase notice)",
    source: "briefe/2026-04-10/BRIEF-00781.pdf",
    sourceSnippet:
      "Aufgrund gestiegener Lohn- und Materialkosten passen wir den Pauschalbetrag ab dem 01.05.2026 an...",
    confidence: 0.87,
    actor: "gemini-2.5-pro",
    receivedAt: "2026-04-25T08:02:00Z",
  },
];

const MOCK_HISTORY: HistoryEntry[] = [
  {
    id: "h-001",
    section: "Open issues",
    newValue: "Wartungstermin Heizung bestätigt für 06.10.2024 um 10:00",
    source: "emails/2024-09/EMAIL-02443.eml",
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
    return "inbox";
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
    meta.createSpan({
      text: `${(p.confidence * 100).toFixed(0)}% conf`,
      cls: "buena-meta-pill",
    });
    meta.createSpan({ text: p.actor, cls: "buena-meta-pill" });
    const sourcePill = meta.createSpan({
      text: shortSource(p.source),
      cls: "buena-meta-source",
    });
    attachHoverPopover(sourcePill, () => {
      const fields: HoverField[] = [
        { label: "Source", value: p.source, mono: true },
        { label: "Confidence", value: `${(p.confidence * 100).toFixed(0)}%` },
        { label: "Actor", value: p.actor },
        {
          label: "Received",
          value: new Date(p.receivedAt).toLocaleString(),
        },
      ];
      if (p.sourceSnippet) {
        fields.push({ label: "Snippet", value: p.sourceSnippet });
      }
      return fields;
    });

    const actions = card.createDiv({ cls: "buena-card-actions" });
    const approve = actions.createEl("button", {
      text: "Approve",
      cls: "buena-btn buena-btn-primary",
    });
    approve.onclick = () => this.handleApprove(p.id);
    const reject = actions.createEl("button", { text: "Reject", cls: "buena-btn" });
    reject.onclick = () => this.handleReject(p.id);
    const edit = actions.createEl("button", { text: "Edit", cls: "buena-btn" });
    edit.onclick = () => this.handleEdit(p.id);
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

function shortSource(s: string): string {
  // Show only the last segment so the meta line doesn't wrap.
  const parts = s.split("/");
  return parts[parts.length - 1];
}
