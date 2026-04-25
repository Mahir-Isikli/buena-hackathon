/**
 * Bridge between worker state and the local Obsidian vault.
 *
 * - Resolves the target file from settings.propertyFile, then by frontmatter
 *   `property_id`, then by basename match.
 * - Pulls property.md + state.json on connect.
 * - Keeps pending patches out of markdown. The queue lives in the sidebar.
 */

import { App, Notice, TFile, normalizePath } from "obsidian";
import type BuenaPlugin from "../main";
import { fetchPropertyMd, fetchStateJson, fetchPending } from "./api";

export async function resolvePropertyFile(
  app: App,
  plugin: BuenaPlugin
): Promise<TFile | null> {
  const { propertyFile, propertyId } = plugin.settings;

  if (propertyFile) {
    const f = app.vault.getAbstractFileByPath(propertyFile);
    if (f instanceof TFile) return f;
  }

  const md = app.vault.getMarkdownFiles();
  for (const f of md) {
    const cache = app.metadataCache.getFileCache(f);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    if (fm && fm.property_id === propertyId) return f;
  }

  for (const f of md) {
    if (f.basename === propertyId) return f;
  }

  return null;
}

export async function ensurePropertyFile(
  app: App,
  plugin: BuenaPlugin
): Promise<TFile | null> {
  const existing = await resolvePropertyFile(app, plugin);
  if (existing) return existing;
  const path = plugin.settings.propertyFile?.trim() || `${plugin.settings.propertyId}.md`;
  const normalized = normalizePath(path);
  await ensureFolderForFile(app, normalized);
  const created = await app.vault.create(normalized, `---\nproperty_id: ${plugin.settings.propertyId}\n---\n\n# ${plugin.settings.propertyId}\n`);
  return created;
}

/**
 * Pull property.md + state.json from the worker and write them into the vault.
 * Remote is treated as canonical here. Any stale local `buena-pending` blocks
 * are stripped so the markdown stays focused on the property briefing while the
 * queue lives in the sidebar.
 */
export async function pullPropertySnapshotOnce(
  plugin: BuenaPlugin
): Promise<{ propertyPulled: boolean; statePulled: boolean }> {
  const file = await ensurePropertyFile(plugin.app, plugin);
  if (!file) {
    new Notice(`[Buena] no vault file matched property ${plugin.settings.propertyId}`);
    return { propertyPulled: false, statePulled: false };
  }

  let propertyPulled = false;
  let statePulled = false;

  const remoteProperty = await fetchPropertyMd(plugin.settings).catch((err) => {
    console.warn("[Buena] fetchPropertyMd failed", err);
    return null;
  });
  if (typeof remoteProperty === "string") {
    const next = ensureTrailingNewline(remoteProperty.trimEnd());
    const local = await plugin.app.vault.read(file);
    if (next !== local) {
      await plugin.app.vault.modify(file, next);
    }
    propertyPulled = true;
  }

  const remoteState = await fetchStateJson(plugin.settings).catch((err) => {
    console.warn("[Buena] fetchStateJson failed", err);
    return null;
  });
  if (remoteState) {
    const statePath = siblingStatePath(file.path);
    const existing = await readJsonIfExists(plugin.app, statePath);
    const mergedState = mergeState(existing, remoteState);
    const text = JSON.stringify(mergedState, null, 2) + "\n";
    const stateFile = plugin.app.vault.getAbstractFileByPath(statePath);
    if (stateFile instanceof TFile) {
      await plugin.app.vault.modify(stateFile, text);
    } else {
      await ensureFolderForFile(plugin.app, statePath);
      await plugin.app.vault.create(statePath, text);
    }
    statePulled = true;
  }

  return { propertyPulled, statePulled };
}

export async function pullPendingOnce(plugin: BuenaPlugin): Promise<{
  strippedLocalBlocks: number;
  total: number;
}> {
  const file = await resolvePropertyFile(plugin.app, plugin);
  if (!file) {
    new Notice(`[Buena] no vault file matched property ${plugin.settings.propertyId}`);
    return { strippedLocalBlocks: 0, total: 0 };
  }
  const remote = await fetchPending(plugin.settings);
  const local = await plugin.app.vault.read(file);
  const { text: stripped, removed } = stripAllPendingBlocks(local);
  if (stripped !== local) {
    await plugin.app.vault.modify(file, ensureTrailingNewline(stripped));
  }
  return { strippedLocalBlocks: removed, total: remote.length };
}

function stripAllPendingBlocks(text: string): { text: string; removed: number } {
  const matches = text.match(/\n?```buena-pending\n[\s\S]*?\n```\n?/g) ?? [];
  return {
    text: text
      .replace(/\n?```buena-pending\n[\s\S]*?\n```\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd(),
    removed: matches.length,
  };
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}

function siblingStatePath(propertyPath: string): string {
  const idx = propertyPath.lastIndexOf("/");
  return idx === -1 ? "state.json" : `${propertyPath.slice(0, idx + 1)}state.json`;
}

async function readJsonIfExists(app: App, path: string): Promise<Record<string, unknown> | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  try {
    return JSON.parse(await app.vault.read(file)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mergeState(
  localState: Record<string, unknown> | null,
  remoteState: Record<string, unknown>
): Record<string, unknown> {
  const localSections = new Set<string>(
    Array.isArray(localState?.human_edited_sections)
      ? (localState!.human_edited_sections as string[])
      : []
  );
  const remoteSections = new Set<string>(
    Array.isArray(remoteState.human_edited_sections)
      ? (remoteState.human_edited_sections as string[])
      : []
  );
  const human_edited_sections = [...new Set([...remoteSections, ...localSections])].sort();
  return {
    ...remoteState,
    ...(localState ? { local_only: localState.local_only } : {}),
    human_edited_sections,
  };
}

async function ensureFolderForFile(app: App, path: string): Promise<void> {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return;
  const folder = path.slice(0, idx);
  if (app.vault.getAbstractFileByPath(folder)) return;
  await app.vault.createFolder(folder);
}
