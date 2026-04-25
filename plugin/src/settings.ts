import { App, PluginSettingTab, Setting } from "obsidian";
import type BuenaPlugin from "../main";

export interface BuenaSettings {
  workerUrl: string;
  bearerToken: string;
  propertyId: string;
  propertyFile: string;
  liveSync: boolean;
}

export const DEFAULT_SETTINGS: BuenaSettings = {
  workerUrl: "https://buena-ingest.isiklimahir.workers.dev",
  bearerToken: "",
  propertyId: "LIE-001",
  propertyFile: "",
  liveSync: true,
};

export class BuenaSettingTab extends PluginSettingTab {
  plugin: BuenaPlugin;

  constructor(app: App, plugin: BuenaPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Buena Context Engine" });

    new Setting(containerEl)
      .setName("Worker URL")
      .setDesc("Base URL for the Cloudflare Worker (ingest + SSE).")
      .addText((t) =>
        t
          .setPlaceholder("https://buena-ingest.workers.dev")
          .setValue(this.plugin.settings.workerUrl)
          .onChange(async (v) => {
            this.plugin.settings.workerUrl = v.trim();
            await this.plugin.saveSettings();
            this.plugin.restartLiveSync();
          })
      );

    new Setting(containerEl)
      .setName("Bearer token")
      .setDesc("Authorization token for the Worker (matches INGEST_TOKEN).")
      .addText((t) =>
        t
          .setPlaceholder("token...")
          .setValue(this.plugin.settings.bearerToken)
          .onChange(async (v) => {
            this.plugin.settings.bearerToken = v.trim();
            await this.plugin.saveSettings();
            this.plugin.restartLiveSync();
          })
      );

    new Setting(containerEl)
      .setName("Property ID")
      .setDesc("Active property ID this vault is bound to.")
      .addText((t) =>
        t
          .setPlaceholder("LIE-001")
          .setValue(this.plugin.settings.propertyId)
          .onChange(async (v) => {
            this.plugin.settings.propertyId = v.trim();
            await this.plugin.saveSettings();
            this.plugin.restartLiveSync();
          })
      );

    new Setting(containerEl)
      .setName("Property file path")
      .setDesc(
        "Optional. Vault-relative path to the property markdown file. If empty, the plugin matches by frontmatter `property_id` or filename."
      )
      .addText((t) =>
        t
          .setPlaceholder("LIE-001.md")
          .setValue(this.plugin.settings.propertyFile)
          .onChange(async (v) => {
            this.plugin.settings.propertyFile = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Live sync")
      .setDesc("Stream patches from the worker over SSE.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.liveSync).onChange(async (v) => {
          this.plugin.settings.liveSync = v;
          await this.plugin.saveSettings();
          this.plugin.restartLiveSync();
        })
      );
  }
}
