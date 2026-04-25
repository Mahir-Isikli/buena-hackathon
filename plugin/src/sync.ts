/**
 * Bridge between worker-pushed patches and the local Obsidian vault.
 *
 * - Resolves the target file from settings.propertyFile, then by frontmatter
 *   `property_id`, then by basename match.
 * - Appends each new patch as a fenced ```buena-pending``` block at the end
 *   of the file, idempotent on patch.id.
 */

import { App, Notice, TFile, stringifyYaml } from "obsidian";
import type BuenaPlugin from "../main";
import type { RemotePendingPatch } from "./api";
import { findPendingBlocks } from "./vault-patch";

export async function resolvePropertyFile(
  app: App,
  plugin: BuenaPlugin
): Promise<TFile | null> {
  const { propertyFile, propertyId } = plugin.settings;

  // 1. explicit setting
  if (propertyFile) {
    const f = app.vault.getAbstractFileByPath(propertyFile);
    if (f instanceof TFile) return f;
  }

  // 2. scan vault for frontmatter property_id match
  const md = app.vault.getMarkdownFiles();
  for (const f of md) {
    const cache = app.metadataCache.getFileCache(f);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    if (fm && fm.property_id === propertyId) return f;
  }

  // 3. basename match (LIE-001.md, etc.)
  for (const f of md) {
    if (f.basename === propertyId) return f;
  }

  return null;
}

/**
 * Append a patch as a buena-pending codeblock if its id is not already
 * present in the file. Returns true when a block was written.
 */
export async function appendPatchToFile(
  app: App,
  file: TFile,
  patch: RemotePendingPatch
): Promise<boolean> {
  const text = await app.vault.read(file);

  // Idempotency: skip if any existing buena-pending block already has this id.
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

/**
 * Strip a buena-pending block by id from the property file. Used when the
 * worker emits a `removed` event because a decision was applied elsewhere.
 */
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

/**
 * One-shot pull: hit the worker, append every new patch to the property file.
 */
export async function pullPendingOnce(plugin: BuenaPlugin): Promise<{
  added: number;
  total: number;
}> {
  const { fetchPending } = await import("./api");
  const file = await resolvePropertyFile(plugin.app, plugin);
  if (!file) {
    new Notice(
      `[Buena] no vault file matched property ${plugin.settings.propertyId}`
    );
    return { added: 0, total: 0 };
  }
  const remote = await fetchPending(plugin.settings);
  let added = 0;
  for (const p of remote) {
    if (await appendPatchToFile(plugin.app, file, p)) added += 1;
  }
  return { added, total: remote.length };
}
