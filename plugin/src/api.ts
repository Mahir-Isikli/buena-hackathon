/**
 * Thin HTTP/SSE client for the buena-ingest worker.
 *
 * All routes are bearer-authed via settings.bearerToken. Empty token is
 * allowed (worker dev mode, INGEST_TOKEN unset).
 */

import type { BuenaSettings } from "./settings";

export interface RemoteSenderInfo {
  email?: string;
  name?: string;
  erpId?: string;
  role?: "owner" | "tenant" | "provider" | "unknown";
  unitIds?: string[];
}

export interface RemoteSourceMeta {
  kind?: "email" | "bulk" | "unknown";
  filename?: string;
  mimeType?: string;
  subject?: string;
  receivedAt?: string;
  recipient?: string;
  note?: string;
}

export interface RemotePendingPatch {
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
  addedAt?: string;
  sender?: RemoteSenderInfo;
  sourceMeta?: RemoteSourceMeta;
}

function authHeaders(settings: BuenaSettings): Record<string, string> {
  return settings.bearerToken
    ? { authorization: `Bearer ${settings.bearerToken}` }
    : {};
}

function vaultUrl(settings: BuenaSettings, suffix: string): string {
  const base = settings.workerUrl.replace(/\/$/, "");
  const id = encodeURIComponent(settings.propertyId);
  return `${base}/vaults/${id}/${suffix}`;
}

export async function fetchPending(
  settings: BuenaSettings,
  signal?: AbortSignal
): Promise<RemotePendingPatch[]> {
  const res = await fetch(vaultUrl(settings, "pending"), {
    headers: authHeaders(settings),
    signal,
  });
  if (!res.ok) {
    throw new Error(`fetchPending ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { pending?: RemotePendingPatch[] };
  return body.pending ?? [];
}

export async function fetchPropertyMd(
  settings: BuenaSettings,
  signal?: AbortSignal
): Promise<string | null> {
  const res = await fetch(vaultUrl(settings, "property.md"), {
    headers: authHeaders(settings),
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchPropertyMd ${res.status}: ${await res.text()}`);
  }
  return res.text();
}

export async function fetchStateJson(
  settings: BuenaSettings,
  signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
  const res = await fetch(vaultUrl(settings, "state.json"), {
    headers: authHeaders(settings),
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchStateJson ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export interface RemoteErpSnapshot {
  propertyId: string;
  generatedAt: string;
  erp: {
    property: Record<string, unknown> & { id: string; name: string };
    buildings: Record<string, Record<string, unknown> & { id: string }>;
    units: Record<string, Record<string, unknown> & { id: string; haus_id: string }>;
    owners: Record<string, Record<string, unknown> & { id: string; einheit_ids: string[] }>;
    tenants: Record<string, Record<string, unknown> & { id: string }>;
    service_providers: Record<string, Record<string, unknown> & { id: string }>;
  };
}

/**
 * Fetch the live ERP snapshot for `propertyId`. If omitted, falls back to the
 * settings.propertyId, but callers should always pass the property id from the
 * token itself so a LIE-002 file always pulls LIE-002 data, regardless of what
 * is selected in the dropdown.
 */
export async function fetchErpSnapshot(
  settings: BuenaSettings,
  propertyId?: string,
  signal?: AbortSignal
): Promise<RemoteErpSnapshot | null> {
  const id = propertyId ?? settings.propertyId;
  const base = settings.workerUrl.replace(/\/$/, "");
  const url = `${base}/vaults/${encodeURIComponent(id)}/erp`;
  const res = await fetch(url, {
    headers: authHeaders(settings),
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchErpSnapshot ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as RemoteErpSnapshot;
}

export async function postHumanEdit(
  settings: BuenaSettings,
  sections: string[],
  editedAt: string
): Promise<void> {
  const res = await fetch(vaultUrl(settings, "human-edit"), {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(settings) },
    body: JSON.stringify({ sections, editedAt }),
  });
  if (!res.ok) {
    throw new Error(`postHumanEdit ${res.status}: ${await res.text()}`);
  }
}

export async function fetchRawSource(
  settings: BuenaSettings,
  key: string,
  signal?: AbortSignal
): Promise<{ blob: Blob; contentType: string | null }> {
  const base = settings.workerUrl.replace(/\/$/, "");
  const url = `${base}/raw?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: authHeaders(settings),
    signal,
  });
  if (!res.ok) {
    throw new Error(`fetchRawSource ${res.status}: ${await res.text()}`);
  }
  return {
    blob: await res.blob(),
    contentType: res.headers.get("content-type"),
  };
}

export async function postDecision(
  settings: BuenaSettings,
  patchId: string,
  decision: "approved" | "rejected",
  actor: string,
  reason?: string
): Promise<void> {
  const body: Record<string, unknown> = { patchId, decision, actor };
  if (reason && reason.trim()) body.reason = reason.trim();
  const res = await fetch(vaultUrl(settings, "decision"), {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(settings) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`postDecision ${res.status}: ${await res.text()}`);
  }
}

export interface RemoteHistoryEntry {
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
  sender?: RemoteSenderInfo;
  sourceMeta?: RemoteSourceMeta;
}

export interface RemoteVaultSummary {
  id: string;
  name?: string;
  address?: string;
  verwalter?: string;
  last_updated?: string;
}

export async function fetchVaults(
  settings: BuenaSettings,
  signal?: AbortSignal
): Promise<RemoteVaultSummary[]> {
  const base = settings.workerUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/vaults`, {
    headers: authHeaders(settings),
    signal,
  });
  if (!res.ok) {
    throw new Error(`fetchVaults ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { properties?: RemoteVaultSummary[] };
  return body.properties ?? [];
}

export async function fetchHistory(
  settings: BuenaSettings,
  signal?: AbortSignal
): Promise<RemoteHistoryEntry[]> {
  const res = await fetch(vaultUrl(settings, "history"), {
    headers: authHeaders(settings),
    signal,
  });
  if (!res.ok) {
    throw new Error(`fetchHistory ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { history?: RemoteHistoryEntry[] };
  return body.history ?? [];
}

export interface EventClient {
  close(): void;
  isOpen(): boolean;
}

export interface EventHandlers {
  onPatch?: (patch: RemotePendingPatch) => void;
  onRemoved?: (id: string) => void;
  onReady?: (info: { propertyId: string; count: number }) => void;
  onPing?: () => void;
  onOpen?: () => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
}

/**
 * Open an SSE stream to /vaults/:id/events. Uses fetch() with a streaming
 * body parser so we can pass the Authorization header (EventSource cannot).
 *
 * Auto-reconnects with simple backoff (1s, 2s, 4s, capped at 8s).
 */
export function connectEvents(
  settings: BuenaSettings,
  handlers: EventHandlers
): EventClient {
  let aborted = false;
  let backoff = 1000;
  let abortController: AbortController | null = null;
  let openNow = false;

  const run = async () => {
    while (!aborted) {
      abortController = new AbortController();
      try {
        const res = await fetch(vaultUrl(settings, "events"), {
          headers: { accept: "text/event-stream", ...authHeaders(settings) },
          signal: abortController.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`events ${res.status}`);
        }
        openNow = true;
        backoff = 1000;
        handlers.onOpen?.();

        const reader = res.body
          .pipeThrough(new TextDecoderStream())
          .getReader();
        let buffer = "";
        while (!aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;
          // Parse SSE frames separated by blank lines.
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            dispatchFrame(frame, handlers);
          }
        }
      } catch (err) {
        if (!aborted) handlers.onError?.(err);
      } finally {
        openNow = false;
        handlers.onClose?.();
      }
      if (aborted) break;
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 8000);
    }
  };

  run();

  return {
    close() {
      aborted = true;
      abortController?.abort();
    },
    isOpen() {
      return openNow;
    },
  };
}

function dispatchFrame(frame: string, handlers: EventHandlers): void {
  let event = "message";
  let dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  const dataStr = dataLines.join("\n");
  let data: unknown = null;
  if (dataStr) {
    try {
      data = JSON.parse(dataStr);
    } catch {
      data = dataStr;
    }
  }
  switch (event) {
    case "patch":
      handlers.onPatch?.(data as RemotePendingPatch);
      break;
    case "removed":
      handlers.onRemoved?.((data as { id: string }).id);
      break;
    case "ready":
      handlers.onReady?.(data as { propertyId: string; count: number });
      break;
    case "ping":
      handlers.onPing?.();
      break;
    default:
      break;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
