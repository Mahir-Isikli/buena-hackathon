import type BuenaPlugin from "../main";

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

export async function clearHistory(
  plugin: BuenaPlugin,
  filePath: string
): Promise<void> {
  const store = await loadStore(plugin);
  delete store.byFile[filePath];
  await saveStore(plugin, store);
}
