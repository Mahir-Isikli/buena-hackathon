import { setIcon } from "obsidian";
import type BuenaPlugin from "../main";

/**
 * Custom status bar that lives at the bottom of the Buena sidebar
 * (NOT in Obsidian's global status bar). Sidebar provides a host
 * element via attach() on every render, this class fills it in.
 */
export class BuenaStatusBar {
  private plugin: BuenaPlugin;
  private host: HTMLElement | null = null;
  private pendingCount = 0;
  private reviewCount = 0;
  private connected = true;
  private lastPatchAt: number | null = null;
  private tickInterval: number | null = null;

  constructor(plugin: BuenaPlugin) {
    this.plugin = plugin;
  }

  mount() {
    // Tick every 30s to update "last patch Xm ago".
    if (this.tickInterval === null) {
      this.tickInterval = window.setInterval(() => this.render(), 30_000);
    }
  }

  unmount() {
    if (this.tickInterval !== null) {
      window.clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.host = null;
  }

  /**
   * Sidebar calls this on each render to bind its sticky footer.
   */
  attach(host: HTMLElement) {
    this.host = host;
    this.render();
  }

  setConnected(connected: boolean) {
    this.connected = connected;
    this.render();
  }

  bumpPendingCount(delta: number) {
    this.pendingCount = Math.max(0, this.pendingCount + delta);
    this.render();
  }

  setPendingCount(count: number) {
    this.pendingCount = Math.max(0, count);
    this.render();
  }

  setReviewCount(count: number) {
    this.reviewCount = Math.max(0, count);
    this.render();
  }

  markPatchReceived() {
    this.lastPatchAt = Date.now();
    this.render();
  }

  private render() {
    const el = this.host;
    if (!el) return;
    el.empty();
    el.addClass("buena-statusbar");

    // Left cluster: connection state.
    const left = el.createDiv({ cls: "buena-statusbar-cluster" });
    const dot = left.createSpan({ cls: "buena-statusbar-dot" });
    dot.toggleClass("buena-statusbar-dot-on", this.connected);
    dot.toggleClass("buena-statusbar-dot-off", !this.connected);
    left.createSpan({
      text: this.connected ? "Live" : "Offline",
      cls: "buena-statusbar-label",
    });

    // Center cluster: counts.
    const center = el.createDiv({ cls: "buena-statusbar-cluster" });

    const pendingChip = center.createSpan({ cls: "buena-statusbar-chip" });
    setIcon(pendingChip.createSpan({ cls: "buena-statusbar-icon" }), "inbox");
    pendingChip.createSpan({ text: `${this.pendingCount}`, cls: "buena-statusbar-num" });

    if (this.reviewCount > 0) {
      const reviewChip = center.createSpan({
        cls: "buena-statusbar-chip buena-statusbar-chip-warn",
      });
      setIcon(
        reviewChip.createSpan({ cls: "buena-statusbar-icon" }),
        "alert-triangle"
      );
      reviewChip.createSpan({
        text: `${this.reviewCount}`,
        cls: "buena-statusbar-num",
      });
    }

    // Right cluster: last patch.
    const right = el.createDiv({ cls: "buena-statusbar-cluster" });
    setIcon(right.createSpan({ cls: "buena-statusbar-icon" }), "clock");
    right.createSpan({
      text: this.lastPatchTimeLabel(),
      cls: "buena-statusbar-meta",
    });
  }

  private lastPatchTimeLabel(): string {
    if (!this.lastPatchAt) return "no patches yet";
    const mins = Math.floor((Date.now() - this.lastPatchAt) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
}
