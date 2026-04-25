/**
 * HTTP routing for buena-ingest.
 *
 * Public:
 *   GET  /health
 *
 * Authed (Bearer INGEST_TOKEN):
 *   POST /upload?name=<filename>           bulk import
 *   GET  /vaults/:id/property.md           rendered markdown
 *   GET  /vaults/:id/state.json            state snapshot
 *   GET  /vaults/:id/pending               PendingPatch[]
 *   GET  /vaults/:id/history               HistoryEntry[]
 *   POST /vaults/:id/decision              { patchId, decision, actor, reason? }
 *   POST /vaults/:id/human-edit            { sections: string[], editedAt? }
 *   GET  /vaults/:id/events                SSE stream of patch events
 *   GET  /raw?key=<r2-key>                 fetch raw source object from buena-raw
 *   POST /test/inject-pending              demo helper, body=PendingPatch (partial ok)
 */

import {
  PendingPatch,
  appendPending,
  applyApprovedPatchToPropertyMd,
  markHumanEditedSections,
  propertyMdKey,
  readPending,
  readHistory,
  readStateJson,
  removePending,
  stateKey,
  writeHistory,
  writeStateJson,
} from "./vaults";

export interface Env {
  RAW: R2Bucket;
  VAULTS: R2Bucket;
  EXTRACT_QUEUE: Queue;
  INGEST_TOKEN?: string;
  GEMINI_API_KEY?: string;
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function unauthorized(): Response {
  return jsonResponse({ error: "unauthorized" }, 401);
}

function checkAuth(request: Request, env: Env): boolean {
  // If no token configured, allow (dev mode). In prod set the secret.
  if (!env.INGEST_TOKEN) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${env.INGEST_TOKEN}`;
}

export async function handleHttp(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (path === "/health") {
    return jsonResponse({ ok: true, service: "buena-ingest", time: Date.now() });
  }

  if (!checkAuth(request, env)) return unauthorized();

  // Raw source fetch for provenance jump.
  if (path === "/raw" && method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return jsonResponse({ error: "key required" }, 400);
    const obj = await env.RAW.get(key);
    if (!obj) return jsonResponse({ error: "not_found", key }, 404);
    const headers = new Headers(CORS_HEADERS);
    headers.set("content-type", obj.httpMetadata?.contentType ?? "application/octet-stream");
    return new Response(obj.body, { headers });
  }

  // Bulk import (internal intake UI).
  if (path === "/upload" && method === "POST") {
    const filename = url.searchParams.get("name") ?? `upload-${crypto.randomUUID()}`;
    const propertyId = url.searchParams.get("propertyId") ?? "UNASSIGNED";
    const propertyLabel = url.searchParams.get("propertyLabel") ?? undefined;
    const propertyAddress = url.searchParams.get("propertyAddress") ?? undefined;
    const note = url.searchParams.get("note") ?? undefined;
    const contentType = request.headers.get("content-type") ?? "application/octet-stream";
    const key = `bulk/${propertyId}/${Date.now()}-${filename}`;
    const body = await request.arrayBuffer();
    await env.RAW.put(key, body, {
      httpMetadata: {
        contentType,
      },
      customMetadata: {
        propertyId,
        ...(propertyLabel ? { propertyLabel } : {}),
        ...(propertyAddress ? { propertyAddress } : {}),
        ...(note ? { note } : {}),
      },
    });
    await env.EXTRACT_QUEUE.send({
      source: "bulk",
      key,
      filename,
      size: body.byteLength,
      contentType,
      propertyId,
      propertyLabel,
      propertyAddress,
      note,
      uploadedAt: new Date().toISOString(),
    });
    return jsonResponse({
      ok: true,
      key,
      size: body.byteLength,
      propertyId,
      propertyLabel,
    });
  }

  // Vault routes: /vaults/:id/...
  const vaultMatch = path.match(/^\/vaults\/([^/]+)\/(.+)$/);
  if (vaultMatch) {
    const propertyId = decodeURIComponent(vaultMatch[1]);
    const rest = vaultMatch[2];

    if (rest === "property.md" && method === "GET") {
      const obj = await env.VAULTS.get(propertyMdKey(propertyId));
      if (!obj) return jsonResponse({ error: "not_found", propertyId }, 404);
      return new Response(obj.body, {
        headers: { "content-type": "text/markdown; charset=utf-8", ...CORS_HEADERS },
      });
    }

    if (rest === "state.json" && method === "GET") {
      const obj = await env.VAULTS.get(stateKey(propertyId));
      if (!obj) return jsonResponse({ error: "not_found", propertyId }, 404);
      return new Response(obj.body, {
        headers: { "content-type": "application/json", ...CORS_HEADERS },
      });
    }

    if (rest === "pending" && method === "GET") {
      const pending = await readPending(env.VAULTS, propertyId);
      return jsonResponse({ propertyId, pending });
    }

    if (rest === "history" && method === "GET") {
      const history = await readHistory(env.VAULTS, propertyId);
      return jsonResponse({ propertyId, history });
    }

    if (rest === "decision" && method === "POST") {
      type DecisionBody = {
        patchId: string;
        decision: "approved" | "rejected";
        actor?: string;
        reason?: string;
      };
      const body = (await request.json()) as DecisionBody;
      if (!body.patchId || !body.decision) {
        return jsonResponse({ error: "patchId and decision required" }, 400);
      }
      const { removed, patch } = await removePending(env.VAULTS, propertyId, body.patchId);
      const timestamp = new Date().toISOString();
      let applied = false;
      if (body.decision === "approved" && patch) {
        const result = await applyApprovedPatchToPropertyMd(env.VAULTS, propertyId, patch, timestamp);
        applied = result.applied;
        const currentState = await readStateJson(env.VAULTS, propertyId);
        if (currentState) {
          await writeStateJson(env.VAULTS, propertyId, {
            ...currentState,
            last_updated: timestamp,
          });
        }
      }
      await writeHistory(env.VAULTS, propertyId, {
        id: body.patchId,
        section: patch?.section ?? "Unknown",
        unit: patch?.unit,
        oldValue: patch?.old,
        newValue: patch?.new ?? "",
        source: patch?.source,
        decision: body.decision,
        timestamp,
        actor: body.actor ?? "unknown",
        reason: body.reason,
      });
      return jsonResponse({ ok: true, removed, applied, patchId: body.patchId, timestamp });
    }

    if (rest === "human-edit" && method === "POST") {
      const body = (await request.json()) as { sections?: string[]; editedAt?: string };
      const state = await markHumanEditedSections(
        env.VAULTS,
        propertyId,
        body.sections ?? [],
        body.editedAt ?? new Date().toISOString()
      );
      return jsonResponse({ ok: true, propertyId, state });
    }

    if (rest === "events" && method === "GET") {
      return openEventStream(env, propertyId);
    }
  }

  // Test helper: mint a pending patch and append it to pending.json.
  if (path === "/test/inject-pending" && method === "POST") {
    const incoming = (await request.json()) as Partial<PendingPatch> & {
      propertyId?: string;
    };
    const propertyId = incoming.propertyId ?? "LIE-001";
    const patch: PendingPatch = {
      id: incoming.id ?? `test-${Date.now()}`,
      section: incoming.section ?? "Open issues",
      unit: incoming.unit,
      old: incoming.old,
      new: incoming.new ?? "Synthetic test patch from /test/inject-pending",
      source: incoming.source ?? "test://manual",
      snippet: incoming.snippet,
      confidence: incoming.confidence ?? 0.92,
      actor: incoming.actor ?? "test-injector",
      target_heading: incoming.target_heading ?? "## Open issues",
      new_block: incoming.new_block ?? "- Synthetic patch line",
      addedAt: new Date().toISOString(),
    };
    const next = await appendPending(env.VAULTS, propertyId, patch);
    return jsonResponse({ ok: true, propertyId, patch, totalPending: next.length });
  }

  return jsonResponse({ error: "not_found", path }, 404);
}

/**
 * SSE stream that polls pending.json every 2 seconds and emits new patches.
 * Holds the connection open up to 5 minutes, then closes (client reconnects).
 */
function openEventStream(env: Env, propertyId: string): Response {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const send = async (event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    await writer.write(encoder.encode(payload));
  };

  (async () => {
    try {
      // Initial snapshot so the client can sync immediately.
      const initial = await readPending(env.VAULTS, propertyId);
      const seen = new Set(initial.map((p) => p.id));
      await send("ready", { propertyId, count: initial.length });
      for (const p of initial) await send("patch", p);

      const startedAt = Date.now();
      const maxMs = 5 * 60 * 1000;
      while (Date.now() - startedAt < maxMs) {
        await sleep(2000);
        await send("ping", { t: Date.now() });
        const current = await readPending(env.VAULTS, propertyId);
        for (const p of current) {
          if (!seen.has(p.id)) {
            seen.add(p.id);
            await send("patch", p);
          }
        }
        // Detect removals (decision applied) and notify.
        const currentIds = new Set(current.map((p) => p.id));
        for (const id of seen) {
          if (!currentIds.has(id)) {
            seen.delete(id);
            await send("removed", { id });
          }
        }
      }
      await send("bye", { reason: "max-duration" });
    } catch (err) {
      console.error("[buena] SSE error", err);
    } finally {
      try {
        await writer.close();
      } catch {
        /* ignore */
      }
    }
  })();

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      ...CORS_HEADERS,
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
