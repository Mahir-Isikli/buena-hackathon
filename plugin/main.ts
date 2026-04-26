import { MarkdownView, Plugin, WorkspaceLeaf, Notice } from "obsidian";
import { BuenaSidebarView, BUENA_SIDEBAR_VIEW_TYPE } from "./src/sidebar";
import { registerProvenanceProcessor } from "./src/popover";
import { registerErpReferenceProcessors } from "./src/erp-references";
import { registerPropertyHeaderProcessor } from "./src/property-header";
import { registerHumanEditTracking } from "./src/human-edits";
import { registerUnitsCollapseProcessor } from "./src/units-collapse";
import { registerPendingInlineProcessor } from "./src/pending-inline";
import { initErpStore, watchErpFile } from "./src/erp";
import {
  registerErpProjectionProcessor,
  invalidateErpProjectionCache,
  prewarmErpProjection,
} from "./src/erp-projection";
import { BuenaStatusBar } from "./src/statusbar";
import { BuenaSettingTab, DEFAULT_SETTINGS, BuenaSettings } from "./src/settings";
import {
  connectEvents,
  EventClient,
  fetchHistory,
  fetchPending,
  RemoteHistoryEntry,
  RemotePendingPatch,
} from "./src/api";
import { pullPendingOnce, pullPropertySnapshotOnce } from "./src/sync";

export default class BuenaPlugin extends Plugin {
  settings: BuenaSettings = DEFAULT_SETTINGS;
  statusBar!: BuenaStatusBar;
  pendingCache: RemotePendingPatch[] = [];
  private eventClient: EventClient | null = null;

  async onload() {
    console.log("[Buena] loading plugin");

    await this.loadSettings();

    // Register the sidebar view (right leaf)
    this.registerView(
      BUENA_SIDEBAR_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new BuenaSidebarView(leaf, this)
    );

    // Status bar
    this.statusBar = new BuenaStatusBar(this);
    this.statusBar.mount();
    this.statusBar.setConnected(false);

    // ERP store: load erp.json and watch it for changes
    const erpStore = initErpStore(this.app);
    await erpStore.load();
    const unwatch = watchErpFile(this.app, () => {
      erpStore.load().catch((err) => console.warn("[Buena] erp reload failed", err));
    });
    this.register(unwatch);

    // Provenance hover popovers
    registerProvenanceProcessor(this);

    // Rich ERP reference rendering: inline `@ID` chips and ```buena-erp``` cards
    registerErpReferenceProcessors(this);

    // Property header pills (copy inbox address, etc.)
    registerPropertyHeaderProcessor(this);

    // Collapse / expand affordance for per-building unit tables.
    registerUnitsCollapseProcessor(this);

    // Inline pending rows under their target heading in reading view.
    registerPendingInlineProcessor(this);

    // Render-time projection: replace `{{erp.foo(LIE-001)}}` placeholders with
    // tables fetched live from the worker's D1-backed ERP endpoint.
    registerErpProjectionProcessor(this);

    // When the user opens a property markdown file, auto-switch the sidebar
    // to that property so the queue, history, and SSE stream follow what
    // they're looking at. We resolve via frontmatter `property_id` only —
    // basename matching would be too aggressive (e.g. a notes file named
    // "LIE-001 thoughts" should not switch).
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || !file.path.endsWith(".md")) return;

        // Auto-switch first, before pre-warming ERP, since the switch may
        // pull a fresh property.md whose erp placeholders we want to warm.
        const cached = this.app.metadataCache.getFileCache(file);
        const fm = cached?.frontmatter as Record<string, unknown> | undefined;
        const propertyId =
          typeof fm?.property_id === "string" ? fm.property_id.trim() : "";
        if (propertyId && propertyId !== this.settings.propertyId) {
          void this.switchProperty(propertyId).catch((err) =>
            console.warn("[Buena] auto-switch failed", err)
          );
        }

        // Pre-warm the ERP snapshot for whatever property IDs the file
        // references via `{{erp.foo(LIE-XXX)}}` placeholders.
        void this.app.vault
          .read(file)
          .then((text) => {
            const ids = new Set<string>();
            const re = /\{\{erp\.[a-zA-Z]+\(([A-Z0-9-]+)\)\}\}/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) ids.add(m[1]);
            for (const id of ids) {
              void prewarmErpProjection(this, id);
            }
          })
          .catch(() => {
            /* file read may fail for binary or unreadable files */
          });
      })
    );

    // Human edit tracking -> local state.json + worker marker.
    registerHumanEditTracking(this);

    // Ribbon icon to open the sidebar
    this.addRibbonIcon("landmark", "Buena: open pending queue", async () => {
      await this.activateSidebar();
    });

    // Command to open the sidebar
    this.addCommand({
      id: "buena-open-sidebar",
      name: "Open Buena sidebar",
      callback: async () => {
        await this.activateSidebar();
      },
    });

    // Command to simulate an incoming patch (handy for demo before backend exists)
    this.addCommand({
      id: "buena-simulate-patch",
      name: "Simulate incoming patch",
      callback: () => {
        new Notice("[Buena] Simulated patch added to queue");
        this.statusBar.bumpPendingCount(1);
        this.statusBar.markPatchReceived();
      },
    });

    // Manual full sync from worker: property.md + state.json + current pending queue.
    this.addCommand({
      id: "buena-pull-pending",
      name: "Full sync from worker",
      callback: async () => {
        try {
          await pullPropertySnapshotOnce(this);
          const { total } = await pullPendingOnce(this);
          this.statusBar.setPendingCount(total);
          await this.cachePending();
          invalidateErpProjectionCache();
          await this.refreshSidebarViews();
          new Notice(`[Buena] synced property + state, queue refreshed (${total} pending)`);
        } catch (err) {
          console.error("[Buena] pull failed", err);
          new Notice(`[Buena] pull failed: ${err}`);
        }
      },
    });

    // Reconnect SSE stream on demand
    this.addCommand({
      id: "buena-reconnect",
      name: "Reconnect live sync",
      callback: () => this.restartLiveSync(),
    });

    // Settings tab
    this.addSettingTab(new BuenaSettingTab(this.app, this));

    // Dedupe any stale Buena leaves, pull the latest property snapshot, then start live sync.
    this.app.workspace.onLayoutReady(() => {
      const leaves = this.app.workspace.getLeavesOfType(BUENA_SIDEBAR_VIEW_TYPE);
      for (let i = 1; i < leaves.length; i++) {
        leaves[i].detach();
      }
      void (async () => {
        try {
          await pullPropertySnapshotOnce(this);
          const { total } = await pullPendingOnce(this);
          this.statusBar.setPendingCount(total);
          await this.cachePending();
          await this.refreshSidebarViews();
        } catch (err) {
          console.warn("[Buena] initial pull failed", err);
        } finally {
          this.startLiveSync();
        }
      })();
    });
  }

  async onunload() {
    console.log("[Buena] unloading plugin");
    this.stopLiveSync();
    this.statusBar?.unmount();
  }

  async activateSidebar() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(BUENA_SIDEBAR_VIEW_TYPE)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (right) {
        await right.setViewState({ type: BUENA_SIDEBAR_VIEW_TYPE, active: true });
        leaf = right;
      }
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ---- Live sync (SSE) ------------------------------------------------

  startLiveSync() {
    this.stopLiveSync();
    if (!this.settings.liveSync) {
      this.statusBar.setConnected(false);
      return;
    }
    if (!this.settings.workerUrl) {
      this.statusBar.setConnected(false);
      return;
    }

    this.eventClient = connectEvents(this.settings, {
      onOpen: () => {
        console.log("[Buena] SSE open");
        this.statusBar.setConnected(true);
      },
      onClose: () => {
        this.statusBar.setConnected(false);
      },
      onError: (err) => {
        console.warn("[Buena] SSE error", err);
        this.statusBar.setConnected(false);
      },
      onReady: (info) => {
        console.log("[Buena] SSE ready", info);
        this.statusBar.setPendingCount(info.count);
        void this.refreshSidebarViews();
      },
      onPing: () => {
        // heartbeat, nothing to do
      },
      onPatch: async (patch) => {
        await this.handleIncomingPatch(patch);
      },
      onRemoved: async (id) => {
        await this.handleRemoteRemoval(id);
      },
    });
  }

  stopLiveSync() {
    this.eventClient?.close();
    this.eventClient = null;
  }

  restartLiveSync() {
    this.startLiveSync();
  }

  /**
   * Bind the plugin to a different property.
   * All four remote reads (property.md, state.json, pending, history) run in
   * one Promise.all batch so the switch finishes in roughly the time of the
   * slowest single request, not their sum. SSE reconnects last and does not
   * block the UI update.
   * Idempotent: no-op if newId is empty or already the active property.
   */
  async switchProperty(newId: string): Promise<void> {
    const target = (newId ?? "").trim();
    if (!target || target === this.settings.propertyId) return;
    const prev = this.settings.propertyId;
    this.settings.propertyId = target;
    // Clear explicit propertyFile so resolution falls back to frontmatter.
    this.settings.propertyFile = "";
    await this.saveSettings();
    invalidateErpProjectionCache();
    try {
      const [, pending, history] = await Promise.all([
        pullPropertySnapshotOnce(this),
        fetchPending(this.settings).catch((err) => {
          console.warn("[Buena] fetchPending failed during switch", err);
          return [] as RemotePendingPatch[];
        }),
        fetchHistory(this.settings).catch((err) => {
          console.warn("[Buena] fetchHistory failed during switch", err);
          return [] as RemoteHistoryEntry[];
        }),
      ]);
      this.setPendingCache(pending);
      this.statusBar.setPendingCount(pending.length);
      await this.refreshSidebarViews({ pending, history });
      // Fire and forget — the new SSE stream's onReady will refresh again.
      this.restartLiveSync();
    } catch (err) {
      console.error("[Buena] switchProperty failed", err);
      this.settings.propertyId = prev;
      await this.saveSettings();
      new Notice(`[Buena] switch to ${target} failed: ${err}`);
    }
  }

  setPendingCache(items: RemotePendingPatch[]) {
    this.pendingCache = items;
    this.rerenderPropertyView();
  }

  async cachePending() {
    if (!this.settings.workerUrl) {
      this.setPendingCache([]);
      return;
    }
    try {
      const items = await fetchPending(this.settings);
      this.setPendingCache(items);
    } catch (err) {
      console.warn("[Buena] cachePending failed", err);
    }
  }

  private rerenderPropertyView() {
    const target = this.settings.propertyFile;
    const targetBase = this.settings.propertyId;
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      const file = view.file;
      if (!file) return;
      const matches =
        (target && file.path === target) ||
        (Boolean(targetBase) && file.basename === targetBase);
      if (!matches) return;
      view.previewMode?.rerender(true);
    });
  }

  private async handleIncomingPatch(patch: RemotePendingPatch) {
    try {
      this.statusBar.markPatchReceived();
      this.statusBar.bumpPendingCount(1);
      new Notice(`[Buena] new patch: ${patch.section}`);
      this.setPendingCache([
        ...this.pendingCache.filter((p) => p.id !== patch.id),
        patch,
      ]);
      await this.refreshSidebarViews();
    } catch (err) {
      console.error("[Buena] handleIncomingPatch failed", err);
    }
  }

  private async handleRemoteRemoval(id: string) {
    try {
      this.statusBar.bumpPendingCount(-1);
      this.setPendingCache(this.pendingCache.filter((p) => p.id !== id));
      await this.refreshSidebarViews();
    } catch (err) {
      console.error("[Buena] handleRemoteRemoval failed", err);
    }
  }

  private async refreshSidebarViews(prefetched?: {
    pending?: RemotePendingPatch[];
    history?: RemoteHistoryEntry[];
  }): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(BUENA_SIDEBAR_VIEW_TYPE);
    await Promise.all(
      leaves.map(async (leaf) => {
        const view = leaf.view;
        if (view instanceof BuenaSidebarView) {
          await view.refresh(prefetched);
        }
      })
    );
  }
}
