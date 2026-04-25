import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import { BuenaSidebarView, BUENA_SIDEBAR_VIEW_TYPE } from "./src/sidebar";
import { registerInlinePatchProcessor } from "./src/inline-patch";
import { registerProvenanceProcessor } from "./src/popover";
import { BuenaStatusBar } from "./src/statusbar";
import { BuenaSettingTab, DEFAULT_SETTINGS, BuenaSettings } from "./src/settings";

export default class BuenaPlugin extends Plugin {
  settings: BuenaSettings = DEFAULT_SETTINGS;
  statusBar!: BuenaStatusBar;

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

    // Inline pending-patch codeblock processor
    registerInlinePatchProcessor(this);

    // Provenance hover popovers
    registerProvenanceProcessor(this);

    // Ribbon icon to open the sidebar
    this.addRibbonIcon("building-2", "Buena: open pending queue", async () => {
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

    // Settings tab
    this.addSettingTab(new BuenaSettingTab(this.app, this));

    // Auto-open sidebar on load
    this.app.workspace.onLayoutReady(async () => {
      await this.activateSidebar();
    });
  }

  async onunload() {
    console.log("[Buena] unloading plugin");
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
}
