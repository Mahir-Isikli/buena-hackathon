/**
 * Bridge between worker-pushed patches and the local Obsidian vault.
 *
 * - Resolves the target file from settings.propertyFile, then by frontmatter
 *   `property_id`, then by basename match.
 * - Appends each new patch as a fenced ```buena-pending``` block at the end
 *   of the file, idempotent on patch.id.
 * - Pulls property.md + state.json on connect.
 */

import { App, Notice, TFile, normalizePath, stringifyYaml } from "obsidian";
import type BuenaPlugin from "../main";
import type { RemotePendingPatch } from "./api";
import { fetchPropertyMd, fetchStateJson, fetchPending } from "./api";
import { findPendingBlocks } from "./vault-patch";

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
 * Remote is treated as canonical here: stale local buena-pending blocks are NOT
 * preserved. After this snapshot pull, `pullPendingOnce()` re-appends only the
 * current remote pending queue. This keeps the local file aligned with remote
 * state instead of accumulating stale local pending blocks.
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

export async function appendPatchToFile(
  app: App,
  file: TFile,
  patch: RemotePendingPatch
): Promise<boolean> {
  const text = await app.vault.read(file);

  const existing = findPendingBlocks(text);
  for (const yaml of existing) {
    if (new RegExp(`(^|\\n)\\s*id:\\s*${escapeRegex(patch.id)}\\s*(\\n|$)`).test(yaml)) {
      return false;
    }
  }

  const yamlBody = stringifyYaml({
    id: patch.id,
    section: patch.section,
    unit: patch.unit,
    old: patch.old,
    new: patch.new,
    source: patch.source,
    snippet: patch.snippet,
    confidence: patch.confidence,
    actor: patch.actor,
    target_heading: patch.target_heading,
    new_block: patch.new_block,
  }).trimEnd();

  const block = `\n\n\`\`\`buena-pending\n${yamlBody}\n\`\`\`\n`;
  const next = text.endsWith("\n") ? text + block.trimStart() : text + block;
  await app.vault.modify(file, next);
  return true;
}

export async function stripPatchFromFile(
  app: App,
  file: TFile,
  patchId: string
): Promise<boolean> {
  const text = await app.vault.read(file);
  const stripped = stripPendingBlockByIdLocal(text, patchId);
  if (stripped === text) return false;
  await app.vault.modify(file, stripped);
  return true;
}

function stripPendingBlockByIdLocal(text: string, patchId: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (/^```buena-pending\s*$/.test(lines[i])) {
      let j = i + 1;
      let foundId = false;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        if (lines[j].trim().startsWith("id:")) {
          const v = lines[j].split(":").slice(1).join(":").trim();
          if (v === patchId) foundId = true;
        }
        j += 1;
      }
      if (foundId) {
        i = j + 1;
        if (out.length && out[out.length - 1] === "" && lines[i] === "") i += 1;
        continue;
      }
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function pullPendingOnce(plugin: BuenaPlugin): Promise<{
  added: number;
  total: number;
}> {
  const file = await resolvePropertyFile(plugin.app, plugin);
  if (!file) {
    new Notice(`[Buena] no vault file matched property ${plugin.settings.propertyId}`);
    return { added: 0, total: 0 };
  }
  const remote = await fetchPending(plugin.settings);
  const local = await plugin.app.vault.read(file);
  const stripped = stripAllPendingBlocks(local);
  if (stripped !== local) {
    await plugin.app.vault.modify(file, ensureTrailingNewline(stripped));
  }
  let added = 0;
  for (const p of remote) {
    if (await appendPatchToFile(plugin.app, file, p)) added += 1;
  }
  return { added, total: remote.length };
}

function extractRawPendingBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /```buena-pending\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(`\`\`\`buena-pending\n${m[1]}\n\`\`\``);
  }
  return out;
}

function stripAllPendingBlocks(text: string): string {
  return text
    .replace(/\n?```buena-pending\n[\s\S]*?\n```\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
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
