import { MarkdownView, Plugin, WorkspaceLeaf, Notice } from "obsidian";
import { BuenaSidebarView, BUENA_SIDEBAR_VIEW_TYPE } from "./src/sidebar";
import { registerProvenanceProcessor } from "./src/popover";
import { registerErpReferenceProcessors } from "./src/erp-references";
import { registerPropertyHeaderProcessor } from "./src/property-header";
import { registerHumanEditTracking } from "./src/human-edits";
import { registerUnitsCollapseProcessor } from "./src/units-collapse";
import { registerPendingInlineProcessor } from "./src/pending-inline";
import { initErpStore, ErpData } from "./src/erp";
import {
  registerErpProjectionProcessor,
  invalidateErpProjectionCache,
  loadErpForProperty,
} from "./src/erp-projection";
import { BuenaStatusBar } from "./src/statusbar";
import { BuenaSettingTab, DEFAULT_SETTINGS, BuenaSettings } from "./src/settings";
import {
  connectEvents,
  EventClient,
  fetchHistory,
  fetchPending,
  fetchPropertyMd,
  fetchStateJson,
  fetchVaults,
  RemoteHistoryEntry,
  RemotePendingPatch,
  RemoteVaultSummary,
} from "./src/api";
import {
  applyPropertySnapshotToVault,
  pullPendingOnce,
  pullPropertySnapshotOnce,
} from "./src/sync";

interface PropertySnapshot {
  propertyId: string;
  propertyMd: string | null;
  state: Record<string, unknown> | null;
  pending: RemotePendingPatch[];
  history: RemoteHistoryEntry[];
  fetchedAt: number;
}

export default class BuenaPlugin extends Plugin {
  settings: BuenaSettings = DEFAULT_SETTINGS;
  statusBar!: BuenaStatusBar;
  pendingCache: RemotePendingPatch[] = [];
  /** All known properties + their full snapshot, keyed by propertyId. */
  propertyCache = new Map<string, PropertySnapshot>();
  vaultsList: RemoteVaultSummary[] = [];
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

    // ERP store: in-memory cache of D1-backed master data. Hydrated on plugin
    // load with the current property and re-hydrated on property switch via
    // refreshErpStore. We no longer read a vault-local erp.json — D1 is the
    // single source of truth, and a stale local file would only cause
    // confusing chip mismatches.
    initErpStore();
    void this.refreshErpStore(this.settings.propertyId);

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
        // references via `{{erp.foo(LIE-XXX)}}` placeholders. This drives
        // both the projection tables and the inline @ID chip resolver.
        void this.app.vault
          .read(file)
          .then((text) => {
            const ids = new Set<string>();
            const re = /\{\{erp\.[a-zA-Z]+\(([A-Z0-9-]+)\)\}\}/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) ids.add(m[1]);
            for (const id of ids) {
              void loadErpForProperty(this, id).then((snap) => {
                // If this file's primary property is the currently active
                // one, mirror its data into ErpStore so chips resolve.
                if (snap && id === this.settings.propertyId) {
                  this.applyErpSnapshotToStore(snap.erp);
                }
              });
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
          await this.refreshErpStore(this.settings.propertyId);
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

    // Dedupe any stale Buena leaves, refresh the active property fast,
    // then prefetch every other property in the background so subsequent
    // switches are instant cache hits.
    this.app.workspace.onLayoutReady(() => {
      const leaves = this.app.workspace.getLeavesOfType(BUENA_SIDEBAR_VIEW_TYPE);
      for (let i = 1; i < leaves.length; i++) {
        leaves[i].detach();
      }
      void (async () => {
        try {
          const active = this.settings.propertyId;
          if (active) {
            const fresh = await this.refreshPropertyCache(active);
            if (fresh) await this.applyPropertySnapshot(fresh);
          }
        } catch (err) {
          console.warn("[Buena] initial pull failed", err);
        } finally {
          this.startLiveSync();
          // Background fan-out — populates cache for every property in /vaults
          // so the picker and auto-switch hit a warm cache.
          void this.prefetchAllProperties().catch((err) =>
            console.warn("[Buena] background prefetch failed", err)
          );
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
   *
   * Cache-first: if we already have a snapshot for the target in
   * `propertyCache`, apply it instantly (no network) and kick off a background
   * refresh so the cache stays warm. If there's no snapshot yet (first switch
   * to this property since plugin load), fetch on demand.
   *
   * Idempotent: no-op if newId is empty or already the active property.
   */
  async switchProperty(newId: string): Promise<void> {
    const target = (newId ?? "").trim();
    if (!target || target === this.settings.propertyId) return;
    const prev = this.settings.propertyId;
    this.settings.propertyId = target;
    this.settings.propertyFile = "";
    await this.saveSettings();
    invalidateErpProjectionCache();

    const cached = this.propertyCache.get(target);
    try {
      if (cached) {
        await this.applyPropertySnapshot(cached);
        // Refresh in the background so the next switch is still warm.
        void this.refreshPropertyCache(target).then((fresh) => {
          if (fresh && this.settings.propertyId === target) {
            void this.applyPropertySnapshot(fresh);
          }
        });
      } else {
        const fresh = await this.refreshPropertyCache(target);
        if (fresh) await this.applyPropertySnapshot(fresh);
      }
      this.restartLiveSync();
    } catch (err) {
      console.error("[Buena] switchProperty failed", err);
      this.settings.propertyId = prev;
      await this.saveSettings();
      new Notice(`[Buena] switch to ${target} failed: ${err}`);
    }
  }

  /**
   * Apply a snapshot to the active vault + UI. Pure local I/O, no network.
   * Safe to call repeatedly — vault writes are idempotent (only write if
   * content changed) and the sidebar render is cheap.
   */
  private async applyPropertySnapshot(s: PropertySnapshot): Promise<void> {
    if (s.propertyId !== this.settings.propertyId) return;
    await applyPropertySnapshotToVault(this, s.propertyMd, s.state);
    this.setPendingCache(s.pending);
    this.statusBar.setPendingCount(s.pending.length);
    await this.refreshSidebarViews({ pending: s.pending, history: s.history });
    // ERP for the active property always trails the snapshot, so chips and
    // the directory render against the matching dataset.
    void this.refreshErpStore(s.propertyId);
  }

  /**
   * Pull the ERP snapshot for `propertyId` from D1 (via the projection cache)
   * and feed it into ErpStore so inline `@EIG-001` chips and the sidebar
   * directory resolve. Idempotent and safe to call concurrently.
   */
  async refreshErpStore(propertyId: string): Promise<void> {
    if (!propertyId) return;
    try {
      const snap = await loadErpForProperty(this, propertyId);
      if (!snap) return;
      // Only mirror if this is still the active property; switching mid-fetch
      // would leak stale rows otherwise.
      if (this.settings.propertyId !== propertyId) return;
      this.applyErpSnapshotToStore(snap.erp);
    } catch (err) {
      console.warn("[Buena] refreshErpStore failed for", propertyId, err);
    }
  }

  /** Type-bridge: the worker returns a Record<string,Record<...>> shape that
   * maps cleanly onto our internal ErpData. Shaped this way to keep the cast
   * isolated to one place. */
  applyErpSnapshotToStore(
    erp: import("./src/api").RemoteErpSnapshot["erp"]
  ): void {
    const store = initErpStore();
    store.setData(erp as unknown as ErpData);
  }

  /**
   * Fetch all four remote pieces (property.md, state.json, pending, history)
   * for `propertyId` in one Promise.all burst, store in cache, return the
   * snapshot.
   */
  async refreshPropertyCache(propertyId: string): Promise<PropertySnapshot | null> {
    const settings = { ...this.settings, propertyId };
    try {
      const [propertyMd, state, pending, history] = await Promise.all([
        fetchPropertyMd(settings).catch(() => null),
        fetchStateJson(settings).catch(() => null),
        fetchPending(settings).catch(() => [] as RemotePendingPatch[]),
        fetchHistory(settings).catch(() => [] as RemoteHistoryEntry[]),
      ]);
      const snapshot: PropertySnapshot = {
        propertyId,
        propertyMd,
        state,
        pending,
        history,
        fetchedAt: Date.now(),
      };
      this.propertyCache.set(propertyId, snapshot);
      return snapshot;
    } catch (err) {
      console.warn("[Buena] refreshPropertyCache failed for", propertyId, err);
      return null;
    }
  }

  /**
   * On plugin load, fan out a fetch for every known property so subsequent
   * switches hit a warm cache. Runs in the background — not awaited.
   */
  async prefetchAllProperties(): Promise<void> {
    let vaults: RemoteVaultSummary[] = [];
    try {
      vaults = await fetchVaults(this.settings);
    } catch (err) {
      console.warn("[Buena] prefetch fetchVaults failed", err);
      return;
    }
    this.vaultsList = vaults;
    if (vaults.length === 0) return;
    await Promise.all(vaults.map((v) => this.refreshPropertyCache(v.id)));
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
      const next = [
        ...this.pendingCache.filter((p) => p.id !== patch.id),
        patch,
      ];
      this.setPendingCache(next);
      this.updateCachedPending(this.settings.propertyId, next);
      await this.refreshSidebarViews();
    } catch (err) {
      console.error("[Buena] handleIncomingPatch failed", err);
    }
  }

  private async handleRemoteRemoval(id: string) {
    try {
      this.statusBar.bumpPendingCount(-1);
      const next = this.pendingCache.filter((p) => p.id !== id);
      this.setPendingCache(next);
      this.updateCachedPending(this.settings.propertyId, next);
      await this.refreshSidebarViews();
    } catch (err) {
      console.error("[Buena] handleRemoteRemoval failed", err);
    }
  }

  /** Keep the cached snapshot's pending list in sync with live SSE deltas. */
  private updateCachedPending(propertyId: string, pending: RemotePendingPatch[]) {
    if (!propertyId) return;
    const existing = this.propertyCache.get(propertyId);
    if (!existing) return;
    this.propertyCache.set(propertyId, {
      ...existing,
      pending,
      fetchedAt: Date.now(),
    });
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
