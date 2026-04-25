import { MarkdownView, Notice, TFile, normalizePath } from "obsidian";
import type BuenaPlugin from "../main";
import { postHumanEdit } from "./api";

const debounceTimers = new Map<string, number>();

export function registerHumanEditTracking(plugin: BuenaPlugin) {
  plugin.registerEvent(
    plugin.app.workspace.on("editor-change", (_editor, info) => {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      const file = info?.file ?? view?.file ?? null;
      if (!(file instanceof TFile)) return;
      if (!isPropertyFile(plugin, file)) return;

      const key = file.path;
      const existing = debounceTimers.get(key);
      if (existing) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        debounceTimers.delete(key);
        void persistHumanEdit(plugin, file);
      }, 800);
      debounceTimers.set(key, timer);
    })
  );
}

async function persistHumanEdit(plugin: BuenaPlugin, file: TFile): Promise<void> {
  const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view || view.file?.path !== file.path) return;
  const line = view.editor.getCursor().line;
  const content = await plugin.app.vault.read(file);
  const section = nearestSectionHeading(content, line) ?? "unknown";
  const editedAt = new Date().toISOString();

  const statePath = siblingStatePath(file.path);
  const stateFile = plugin.app.vault.getAbstractFileByPath(statePath);
  const base = stateFile instanceof TFile ? safeJson(await plugin.app.vault.read(stateFile)) : {};
  const humanSections = new Set<string>(
    Array.isArray(base.human_edited_sections) ? (base.human_edited_sections as string[]) : []
  );
  humanSections.add(section);
  const next = {
    ...base,
    property_id: plugin.settings.propertyId,
    last_updated: editedAt,
    human_edited_sections: [...humanSections].sort(),
  };
  const text = JSON.stringify(next, null, 2) + "\n";
  if (stateFile instanceof TFile) {
    await plugin.app.vault.modify(stateFile, text);
  } else {
    await ensureParentFolders(plugin, statePath);
    await plugin.app.vault.create(statePath, text);
  }

  if (plugin.settings.workerUrl) {
    postHumanEdit(plugin.settings, [section], editedAt).catch((err) => {
      console.warn("[Buena] postHumanEdit failed", err);
    });
  }
}

function nearestSectionHeading(content: string, line: number): string | null {
  const lines = content.split("\n");
  for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      return trimmed.replace(/^#+\s*/, "").trim();
    }
  }
  return null;
}

function isPropertyFile(plugin: BuenaPlugin, file: TFile): boolean {
  if (plugin.settings.propertyFile && normalizePath(plugin.settings.propertyFile) === file.path) {
    return true;
  }
  const cache = plugin.app.metadataCache.getFileCache(file);
  const propertyId = cache?.frontmatter?.property_id;
  return propertyId === plugin.settings.propertyId;
}

function siblingStatePath(propertyPath: string): string {
  const idx = propertyPath.lastIndexOf("/");
  return idx === -1 ? "state.json" : `${propertyPath.slice(0, idx + 1)}state.json`;
}

async function ensureParentFolders(plugin: BuenaPlugin, path: string): Promise<void> {
  const parts = path.split("/");
  parts.pop();
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!plugin.app.vault.getAbstractFileByPath(current)) {
      await plugin.app.vault.createFolder(current);
    }
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
