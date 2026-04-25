/**
 * R2 helpers for the per-property vault store.
 *
 * Layout:
 *   vaults/<propertyId>/property.md
 *   vaults/<propertyId>/pending.json        -> PendingPatch[]
 *   vaults/<propertyId>/history/<ts>.json   -> HistoryEntry
 */

export interface PendingPatch {
  id: string;
  section: string;
  unit?: string;
  old?: string;
  new: string;
  source?: string;
  snippet?: string;
  confidence?: number;
  actor: string;
  target_heading: string;
  new_block: string;
  addedAt: string;
}

export interface HistoryEntry {
  id: string;
  section: string;
  unit?: string;
  oldValue?: string;
  newValue: string;
  source?: string;
  decision: "approved" | "rejected";
  timestamp: string;
  actor: string;
}

export const propertyMdKey = (id: string) => `vaults/${id}/property.md`;
export const pendingKey = (id: string) => `vaults/${id}/pending.json`;
export const historyKey = (id: string, ts: string, patchId: string) =>
  `vaults/${id}/history/${ts}-${patchId}.json`;

export async function readPending(
  bucket: R2Bucket,
  propertyId: string
): Promise<PendingPatch[]> {
  const obj = await bucket.get(pendingKey(propertyId));
  if (!obj) return [];
  try {
    const text = await obj.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as PendingPatch[]) : [];
  } catch (err) {
    console.warn("[buena] failed to parse pending.json", err);
    return [];
  }
}

export async function writePending(
  bucket: R2Bucket,
  propertyId: string,
  patches: PendingPatch[]
): Promise<void> {
  await bucket.put(pendingKey(propertyId), JSON.stringify(patches, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function appendPending(
  bucket: R2Bucket,
  propertyId: string,
  patch: PendingPatch
): Promise<PendingPatch[]> {
  const current = await readPending(bucket, propertyId);
  // Idempotent: skip if id already present.
  if (current.some((p) => p.id === patch.id)) return current;
  const next = [...current, patch];
  await writePending(bucket, propertyId, next);
  return next;
}

export async function removePending(
  bucket: R2Bucket,
  propertyId: string,
  patchId: string
): Promise<{ removed: boolean; patch: PendingPatch | null }> {
  const current = await readPending(bucket, propertyId);
  const idx = current.findIndex((p) => p.id === patchId);
  if (idx === -1) return { removed: false, patch: null };
  const patch = current[idx];
  const next = [...current.slice(0, idx), ...current.slice(idx + 1)];
  await writePending(bucket, propertyId, next);
  return { removed: true, patch };
}

export async function writeHistory(
  bucket: R2Bucket,
  propertyId: string,
  entry: HistoryEntry
): Promise<void> {
  const ts = entry.timestamp.replace(/[:.]/g, "-");
  await bucket.put(historyKey(propertyId, ts, entry.id), JSON.stringify(entry, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}
