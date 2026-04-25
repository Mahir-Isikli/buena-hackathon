import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import { BuenaSidebarView, BUENA_SIDEBAR_VIEW_TYPE } from "./src/sidebar";
import { registerProvenanceProcessor } from "./src/popover";
import { registerErpReferenceProcessors } from "./src/erp-references";
import { registerPropertyHeaderProcessor } from "./src/property-header";
import { registerHumanEditTracking } from "./src/human-edits";
import { registerUnitsCollapseProcessor } from "./src/units-collapse";
import { initErpStore, watchErpFile } from "./src/erp";
import { BuenaStatusBar } from "./src/statusbar";
import { BuenaSettingTab, DEFAULT_SETTINGS, BuenaSettings } from "./src/settings";
import { connectEvents, EventClient, RemotePendingPatch } from "./src/api";
import { pullPendingOnce, pullPropertySnapshotOnce } from "./src/sync";

export default class BuenaPlugin extends Plugin {
  settings: BuenaSettings = DEFAULT_SETTINGS;
  statusBar!: BuenaStatusBar;
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

  private async handleIncomingPatch(patch: RemotePendingPatch) {
    try {
      this.statusBar.markPatchReceived();
      this.statusBar.bumpPendingCount(1);
      new Notice(`[Buena] new patch: ${patch.section}`);
      await this.refreshSidebarViews();
    } catch (err) {
      console.error("[Buena] handleIncomingPatch failed", err);
    }
  }

  private async handleRemoteRemoval(_id: string) {
    try {
      this.statusBar.bumpPendingCount(-1);
      await this.refreshSidebarViews();
    } catch (err) {
      console.error("[Buena] handleRemoteRemoval failed", err);
    }
  }

  private async refreshSidebarViews() {
    const leaves = this.app.workspace.getLeavesOfType(BUENA_SIDEBAR_VIEW_TYPE);
    await Promise.all(
      leaves.map(async (leaf) => {
        const view = leaf.view;
        if (view instanceof BuenaSidebarView) {
          await view.refresh();
        }
      })
    );
  }
}
