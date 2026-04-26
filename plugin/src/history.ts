import type BuenaPlugin from "../main";

export interface SenderInfo {
  email?: string;
  name?: string;
  erpId?: string;
  role?: "owner" | "tenant" | "provider" | "unknown";
  unitIds?: string[];
}

export interface SourceMeta {
  kind?: "email" | "bulk" | "unknown";
  filename?: string;
  mimeType?: string;
  subject?: string;
  receivedAt?: string;
  recipient?: string;
  note?: string;
}

export interface HistoryEntry {
  id: string;
  section: string;
  unit?: string;
  oldValue?: string;
  newValue: string;
  source?: string;
  decision: "auto" | "approved" | "rejected";
  timestamp: string;
  actor: string;
  /** Required when decision === "rejected". Surfaced in the change history
   *  table for accountability. Not rendered into the .md. */
  rejectionReason?: string;
  /** Original pending block YAML so we can re-queue on reverse. */
  originalBlock?: {
    target_heading?: string;
    new_block?: string;
    confidence?: number;
    snippet?: string;
  };
  sender?: SenderInfo;
  sourceMeta?: SourceMeta;
}

/**
 * Remove a history entry by id. Used when a change is reversed and re-queued.
 */
export async function removeHistoryEntry(
  plugin: BuenaPlugin,
  filePath: string,
  id: string
): Promise<void> {
  const store = await loadStore(plugin);
  const list = store.byFile[filePath] ?? [];
  store.byFile[filePath] = list.filter((h) => h.id !== id);
  await saveStore(plugin, store);
}

interface HistoryStore {
  // keyed by file path
  byFile: Record<string, HistoryEntry[]>;
}

const MAX_PER_FILE = 50;

async function loadStore(plugin: BuenaPlugin): Promise<HistoryStore> {
  const data = (await plugin.loadData()) ?? {};
  const store: HistoryStore = data.history ?? { byFile: {} };
  if (!store.byFile) store.byFile = {};
  return store;
}

async function saveStore(plugin: BuenaPlugin, store: HistoryStore) {
  const data = (await plugin.loadData()) ?? {};
  data.history = store;
  await plugin.saveData(data);
}

export async function loadHistory(
  plugin: BuenaPlugin,
  filePath: string
): Promise<HistoryEntry[]> {
  const store = await loadStore(plugin);
  return store.byFile[filePath] ?? [];
}

export async function addHistoryEntry(
  plugin: BuenaPlugin,
  filePath: string,
  entry: HistoryEntry
): Promise<void> {
  const store = await loadStore(plugin);
  const list = store.byFile[filePath] ?? [];
  // most recent first
  list.unshift(entry);
  store.byFile[filePath] = list.slice(0, MAX_PER_FILE);
  await saveStore(plugin, store);
}

