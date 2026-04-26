/**
 * Shared sender + sourceMeta builders.
 *
 * Used by the live email ingest path and by the read-time backfill that
 * enriches older pending/history entries which predate the worker change.
 */

import PostalMime from "postal-mime";
import { resolveRouting } from "./route";
import type { EmailHint } from "./stammdaten-map";
import type { HistoryEntry, PendingPatch, SenderInfo, SourceMeta } from "./vaults";

interface ParsedFromShape {
  from?: { address?: string; name?: string } | null;
}

export function buildSenderFromEmail(
  parsed: ParsedFromShape,
  rawFrom: string | undefined,
  matches: EmailHint[]
): SenderInfo | undefined {
  const fromAddr = parsed?.from?.address?.toLowerCase().trim();
  const fromName = parsed?.from?.name?.trim();
  const rawFromTrim = rawFrom?.trim();
  const email = fromAddr || rawFromTrim;
  if (!email && !fromName && !matches.length) return undefined;

  const match = matches[0];
  const role = match?.kind ?? "unknown";

  let name = fromName && fromName.length > 0 ? fromName : undefined;
  if (!name && email && email.includes("@")) {
    name = email
      .split("@")[0]
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }

  return {
    email: email || undefined,
    name: name || undefined,
    erpId: match?.id,
    role,
    unitIds: match?.unitIds,
  };
}

/**
 * Pull r2://buena-raw/<key> from a source string (returns "<key>" or null).
 */
export function rawKeyFromSource(source: string | undefined): string | null {
  if (!source) return null;
  const trimmed = source.trim();
  if (trimmed.startsWith("r2://buena-raw/")) {
    return trimmed.slice("r2://buena-raw/".length);
  }
  return null;
}

/**
 * Read an .eml from the RAW bucket, parse it, derive sender + sourceMeta.
 * Returns null if the underlying object is missing or not an email.
 */
async function deriveFromEml(
  rawBucket: R2Bucket,
  key: string,
  recipientFallback: string | undefined
): Promise<{ sender?: SenderInfo; sourceMeta: SourceMeta } | null> {
  if (!key.endsWith(".eml") && !key.startsWith("emails/")) return null;
  const obj = await rawBucket.get(key);
  if (!obj) return null;

  let parsed: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    parsed = await PostalMime.parse(await obj.arrayBuffer());
  } catch (err) {
    console.warn("[buena-backfill] failed to parse eml", key, err);
    return null;
  }

  const subject = parsed.subject ?? "";
  const body = (parsed.text ?? parsed.html ?? "").trim();
  const fromAddr = parsed.from?.address ?? undefined;
  const recipient = parsed.to?.[0]?.address ?? recipientFallback;

  const routing = resolveRouting(fromAddr, recipient, subject, body);
  const sender = buildSenderFromEmail(parsed, fromAddr, routing.matches);

  const filename = key.split("/").pop() ?? key;
  const sourceMeta: SourceMeta = {
    kind: "email",
    filename,
    mimeType: "message/rfc822",
    subject,
    receivedAt: parsed.date ?? obj.uploaded?.toISOString(),
    recipient,
  };

  return { sender, sourceMeta };
}

/**
 * Best-effort sourceMeta for non-email r2 keys (attachments, bulk uploads).
 */
function deriveFromOtherKey(key: string): SourceMeta {
  const filename = key.split("/").pop() ?? key;
  let kind: SourceMeta["kind"] = "unknown";
  if (key.startsWith("bulk/")) kind = "bulk";
  else if (key.startsWith("attachments/") || key.startsWith("emails/")) kind = "email";
  return { kind, filename };
}

/**
 * Enrich an array of pending or history entries by reading the underlying
 * R2 source for entries that don't yet carry sender/sourceMeta.
 *
 * Returns true if any entry was modified (caller should persist).
 */
export async function enrichEntriesWithSender<
  T extends PendingPatch | HistoryEntry
>(rawBucket: R2Bucket, entries: T[]): Promise<boolean> {
  let mutated = false;

  // Cache per-key derivations to avoid re-reading the same .eml when an email
  // produced multiple patches.
  const cache = new Map<
    string,
    { sender?: SenderInfo; sourceMeta?: SourceMeta } | null
  >();

  for (const entry of entries) {
    if (entry.sender && entry.sourceMeta) continue;
    const key = rawKeyFromSource(entry.source);
    if (!key) continue;

    let derived = cache.get(key);
    if (derived === undefined) {
      const fromEml = await deriveFromEml(rawBucket, key, undefined);
      if (fromEml) {
        derived = fromEml;
      } else {
        derived = { sourceMeta: deriveFromOtherKey(key) };
      }
      cache.set(key, derived);
    }
    if (!derived) continue;

    if (!entry.sender && derived.sender) {
      entry.sender = derived.sender;
      mutated = true;
    }
    if (!entry.sourceMeta && derived.sourceMeta) {
      entry.sourceMeta = derived.sourceMeta;
      mutated = true;
    }
  }

  return mutated;
}
