import { Notice, TFile, normalizePath } from "obsidian";
import type BuenaPlugin from "../main";
import { fetchRawSource } from "./api";

export async function openProvenanceSource(
  plugin: BuenaPlugin,
  source: string
): Promise<void> {
  const parsed = parseR2RawSource(source);
  if (!parsed) {
    new Notice(`[Buena] source not directly fetchable yet: ${source}`);
    return;
  }

  try {
    const { blob } = await fetchRawSource(plugin.settings, parsed.key);
    const path = normalizePath(`attachments/${parsed.key}`);
    await ensureParentFolders(plugin, path);
    const existing = plugin.app.vault.getAbstractFileByPath(path);
    const data = await blob.arrayBuffer();
    let file: TFile;
    if (existing instanceof TFile) {
      await plugin.app.vault.modifyBinary(existing, data);
      file = existing;
    } else {
      file = await plugin.app.vault.createBinary(path, data);
    }
    await plugin.app.workspace.getLeaf(false).openFile(file);
  } catch (err) {
    console.error("[Buena] failed to open provenance source", err);
    new Notice(`[Buena] failed to open source: ${err}`);
  }
}

function parseR2RawSource(source: string): { key: string } | null {
  const trimmed = source.trim();
  const prefix = "r2://buena-raw/";
  if (trimmed.startsWith(prefix)) {
    return { key: trimmed.slice(prefix.length) };
  }
  if (/^(emails|attachments|bulk)\//i.test(trimmed)) {
    return { key: trimmed };
  }
  return null;
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
