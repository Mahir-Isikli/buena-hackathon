import type BuenaPlugin from "../main";

/**
 * Custom status bar pinned to the bottom of the Buena sidebar.
 * Shows three signals tuned for property-manager flow:
 *   - Streak: consecutive days where the PM processed at least one patch
 *   - Queue: pending patches waiting on the user
 *   - Velocity: today's approvals + delta vs yesterday
 */
export class BuenaStatusBar {
  private plugin: BuenaPlugin;
  private host: HTMLElement | null = null;
  private pendingCount = 0;
  private streakDays = 0;
  private velocityToday = 0;
  private velocityDelta = 0;
  private connected = true;

  constructor(plugin: BuenaPlugin) {
    this.plugin = plugin;
  }

  mount() {
    /* nothing periodic for now, render is push-driven */
  }

  unmount() {
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

  setPendingCount(count: number) {
    this.pendingCount = Math.max(0, count);
    this.render();
  }

  setStreak(days: number) {
    this.streakDays = Math.max(0, days);
    this.render();
  }

  setVelocity(v: { today: number; delta: number }) {
    this.velocityToday = Math.max(0, v.today);
    this.velocityDelta = v.delta;
    this.render();
  }

  // Kept as no-ops so the rest of the codebase keeps compiling without
  // blowing up if anything still calls these. Safe to remove later.
  setReviewCount(_count: number) {}
  markPatchReceived() {}
  bumpPendingCount(delta: number) {
    this.setPendingCount(this.pendingCount + delta);
  }

  private render() {
    const el = this.host;
    if (!el) return;
    el.empty();
    el.addClass("buena-statusbar");

    const left = el.createDiv({ cls: "buena-statusbar-cluster" });
    const dot = left.createSpan({ cls: "buena-statusbar-dot" });
    dot.toggleClass("buena-statusbar-dot-on", this.connected);
    dot.toggleClass("buena-statusbar-dot-off", !this.connected);
    left.createSpan({
      text: this.connected ? "Real time." : "Offline.",
      cls: "buena-statusbar-label",
    });

    const right = el.createDiv({ cls: "buena-statusbar-cluster buena-statusbar-summary" });

    if (this.streakDays > 0) {
      const streak = right.createSpan({ cls: "buena-statusbar-streak" });
      streak.createSpan({ text: "🔥", cls: "buena-statusbar-emoji" });
      streak.createSpan({ text: `${this.streakDays}d`, cls: "buena-statusbar-num" });
    }

    right.createSpan({
      text: `${this.pendingCount} Queue`,
      cls: "buena-statusbar-meta buena-statusbar-queue-text",
    });
  }
}
