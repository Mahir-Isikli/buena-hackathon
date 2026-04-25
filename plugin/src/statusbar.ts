import { setIcon } from "obsidian";
import type BuenaPlugin from "../main";

export class BuenaStatusBar {
  private plugin: BuenaPlugin;
  private el: HTMLElement | null = null;
  private pendingCount = 2; // matches MOCK_PENDING in sidebar
  private connected = true; // mock: SSE not wired yet, show "on" state for demo
  private lastPatchAt: number | null = null;
  private tickInterval: number | null = null;

  constructor(plugin: BuenaPlugin) {
    this.plugin = plugin;
  }

  mount() {
    this.el = this.plugin.addStatusBarItem();
    this.el.addClass("buena-status");
    this.render();
    // Tick every 30s to update "last patch Xm ago"
    this.tickInterval = window.setInterval(() => this.render(), 30_000);
  }

  unmount() {
    if (this.tickInterval !== null) {
      window.clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.el?.remove();
    this.el = null;
  }

  setConnected(connected: boolean) {
    this.connected = connected;
    this.render();
  }

  bumpPendingCount(delta: number) {
    this.pendingCount = Math.max(0, this.pendingCount + delta);
    this.render();
  }

  markPatchReceived() {
    this.lastPatchAt = Date.now();
    this.render();
  }

  private render() {
    if (!this.el) return;
    this.el.empty();

    const dot = this.el.createSpan({ cls: "buena-status-dot" });
    dot.toggleClass("buena-status-dot-on", this.connected);
    dot.toggleClass("buena-status-dot-off", !this.connected);

    const icon = this.el.createSpan({ cls: "buena-status-icon" });
    setIcon(icon, "building-2");

    this.el.createSpan({
      text: `Buena: ${this.pendingCount} pending`,
      cls: "buena-status-text",
    });

    if (this.lastPatchAt) {
      const mins = Math.floor((Date.now() - this.lastPatchAt) / 60_000);
      const label = mins < 1 ? "just now" : `${mins}m ago`;
      this.el.createSpan({
        text: ` · last ${label}`,
        cls: "buena-status-meta",
      });
    }
  }
}
