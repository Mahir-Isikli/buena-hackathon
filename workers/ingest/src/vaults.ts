/**
 * R2 helpers for the per-property vault store.
 *
 * Layout:
 *   vaults/<propertyId>/property.md
 *   vaults/<propertyId>/state.json
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
  decision: "approved" | "rejected" | "auto";
  timestamp: string;
  actor: string;
  reason?: string;
}

export interface StateJson {
  schema_version?: number;
  property_id?: string;
  last_updated?: string;
  human_edited_sections?: string[];
  [key: string]: unknown;
}

export const propertyMdKey = (id: string) => `vaults/${id}/property.md`;
export const stateKey = (id: string) => `vaults/${id}/state.json`;
export const pendingKey = (id: string) => `vaults/${id}/pending.json`;
export const historyKey = (id: string, ts: string, patchId: string) =>
  `vaults/${id}/history/${ts}-${patchId}.json`;

export async function readPropertyMd(
  bucket: R2Bucket,
  propertyId: string
): Promise<string | null> {
  const obj = await bucket.get(propertyMdKey(propertyId));
  if (!obj) return null;
  return obj.text();
}

export async function writePropertyMd(
  bucket: R2Bucket,
  propertyId: string,
  markdown: string
): Promise<void> {
  await bucket.put(propertyMdKey(propertyId), markdown, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
  });
}

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

export async function readStateJson(
  bucket: R2Bucket,
  propertyId: string
): Promise<StateJson | null> {
  const obj = await bucket.get(stateKey(propertyId));
  if (!obj) return null;
  try {
    return JSON.parse(await obj.text()) as StateJson;
  } catch (err) {
    console.warn("[buena] failed to parse state.json", err);
    return null;
  }
}

export async function writeStateJson(
  bucket: R2Bucket,
  propertyId: string,
  state: StateJson
): Promise<void> {
  await bucket.put(stateKey(propertyId), JSON.stringify(state, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function markHumanEditedSections(
  bucket: R2Bucket,
  propertyId: string,
  sections: string[],
  editedAt: string
): Promise<StateJson> {
  const current = (await readStateJson(bucket, propertyId)) ?? {
    schema_version: 1,
    property_id: propertyId,
    human_edited_sections: [],
  };
  const existing = new Set(current.human_edited_sections ?? []);
  for (const s of sections) {
    if (s && s.trim()) existing.add(s.trim());
  }
  const next: StateJson = {
    ...current,
    property_id: propertyId,
    last_updated: editedAt,
    human_edited_sections: [...existing].sort(),
  };
  await writeStateJson(bucket, propertyId, next);
  return next;
}

export async function applyApprovedPatchToPropertyMd(
  bucket: R2Bucket,
  propertyId: string,
  patch: PendingPatch,
  approvedAt: string
): Promise<{ applied: boolean; markdown: string | null }> {
  const original = await readPropertyMd(bucket, propertyId);
  if (!original) return { applied: false, markdown: null };
  const lines = original.split("\n");
  let headingIdx = lines.findIndex((l) => l.trim() === patch.target_heading.trim());

  if (headingIdx === -1) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(patch.target_heading.trim(), "");
    headingIdx = lines.length - 2;
  }

  let insertAt = headingIdx + 1;
  if (lines[insertAt] === "") insertAt += 1;
  const annotated = annotateApprovedBlock(patch, approvedAt).split("\n");
  const next = [
    ...lines.slice(0, insertAt),
    ...annotated,
    "",
    ...lines.slice(insertAt),
  ].join("\n");
  await writePropertyMd(bucket, propertyId, next);
  return { applied: true, markdown: next };
}

function annotateApprovedBlock(patch: PendingPatch, approvedAt: string): string {
  const sourceRef = normalizeSourceRef(patch.source);
  const prov = sourceRef
    ? ` {prov: ${sourceRef}${typeof patch.confidence === "number" ? ` | conf: ${patch.confidence}` : ""} | actor: ${patch.actor}}`
    : "";
  const changed = ` {changed: ${approvedAt} | actor: ${patch.actor}${sourceRef ? ` | src: ${sourceRef}` : ""}}`;
  return `${patch.new_block}${prov}${changed}`;
}

function normalizeSourceRef(source?: string): string | undefined {
  if (!source) return undefined;
  return source.replace(/^r2:\/\/buena-raw\//, "").trim();
}

export async function readHistory(
  bucket: R2Bucket,
  propertyId: string,
  limit = 200
): Promise<HistoryEntry[]> {
  const prefix = `vaults/${propertyId}/history/`;
  const listed = await bucket.list({ prefix, limit });
  const out: HistoryEntry[] = [];
  for (const obj of listed.objects) {
    const file = await bucket.get(obj.key);
    if (!file) continue;
    try {
      const parsed = JSON.parse(await file.text()) as HistoryEntry;
      out.push(parsed);
    } catch (err) {
      console.warn("[buena] failed to parse history entry", obj.key, err);
    }
  }
  return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
