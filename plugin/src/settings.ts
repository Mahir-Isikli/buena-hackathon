import { App, PluginSettingTab, Setting } from "obsidian";
import type BuenaPlugin from "../main";

export interface BuenaSettings {
  workerUrl: string;
  bearerToken: string;
  propertyId: string;
}

export const DEFAULT_SETTINGS: BuenaSettings = {
  workerUrl: "http://localhost:8787",
  bearerToken: "",
  propertyId: "LIE-001",
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
          })
      );

    new Setting(containerEl)
      .setName("Bearer token")
      .setDesc("Authorization token for the Worker.")
      .addText((t) =>
        t
          .setPlaceholder("token...")
          .setValue(this.plugin.settings.bearerToken)
          .onChange(async (v) => {
            this.plugin.settings.bearerToken = v.trim();
            await this.plugin.saveSettings();
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
          })
      );
  }
}
