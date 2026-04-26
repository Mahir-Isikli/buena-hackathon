/**
 * HTTP routing for buena-ingest.
 *
 * Public:
 *   GET  /health
 *
 * Authed (Bearer INGEST_TOKEN):
 *   POST /upload?name=<filename>           bulk import
 *   POST /replay/email?property=&receivedAt=&originalTo=
 *                                          replay a raw .eml through the email pipeline
 *   GET  /vaults                           VaultSummary[] for the property picker
 *   POST /vaults/:id/init                  body=zip, scaffolds vault from stammdaten/
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

import JSZip from "jszip";
import PostalMime from "postal-mime";
import {
  PendingPatch,
  appendPending,
  applyApprovedPatchToPropertyMd,
  historyKey,
  listVaults,
  markHumanEditedSections,
  propertyMdKey,
  readPending,
  readHistory,
  readStateJson,
  removePending,
  stateKey,
  writeHistory,
  writePending,
  writePropertyMd,
  writeStateJson,
} from "./vaults";
import { bootstrapVault, renderMarkdown, type StammFiles } from "./bootstrap";
import { enrichEntriesWithSender } from "./sender";
import { getErpSnapshot, writeErpToD1 } from "./erp";
import { resolveRouting } from "./route";

export interface Env {
  RAW: R2Bucket;
  VAULTS: R2Bucket;
  ERP: D1Database;
  EXTRACT_QUEUE: Queue;
  INGEST_TOKEN?: string;
  GEMINI_API_KEY?: string;
  TAVILY_API_KEY?: string;
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

  // Replay a raw .eml through the email pipeline. Used by
  // pipeline/replay_incremental.py to walk the 10-day delta archive without
  // routing through Gmail. Mirrors the Cloudflare email() handler so the
  // queue path is identical to a real inbound email.
  if (path === "/replay/email" && method === "POST") {
    const propertyHint = url.searchParams.get("property");
    const receivedAtParam = url.searchParams.get("receivedAt") ?? undefined;
    const originalToParam = url.searchParams.get("originalTo") ?? undefined;
    const rawBuffer = await request.arrayBuffer();
    if (rawBuffer.byteLength === 0) {
      return jsonResponse({ error: "empty body, expected raw .eml" }, 400);
    }

    let parsed;
    try {
      parsed = await PostalMime.parse(rawBuffer);
    } catch (err) {
      console.warn("[buena-replay] eml parse failed", err);
      return jsonResponse({ error: "could not parse .eml body" }, 400);
    }

    const msgId = (parsed.messageId ?? crypto.randomUUID()).replace(/[<>]/g, "");

    await env.RAW.put(`emails/${msgId}.eml`, rawBuffer, {
      httpMetadata: { contentType: "message/rfc822" },
    });

    const attachmentKeys: string[] = [];
    for (let i = 0; i < (parsed.attachments?.length ?? 0); i++) {
      const att = parsed.attachments![i];
      const safeName = (att.filename ?? `att-${i}`).replace(/[^a-zA-Z0-9._-]/g, "_");
      const key = `attachments/${msgId}/${safeName}`;
      const content =
        att.content instanceof ArrayBuffer
          ? att.content
          : (new TextEncoder().encode(att.content as string).buffer as ArrayBuffer);
      await env.RAW.put(key, content, {
        httpMetadata: { contentType: att.mimeType ?? "application/octet-stream" },
      });
      attachmentKeys.push(key);
    }

    const fromAddr = parsed.from?.address ?? "";
    const headerToAddr = parsed.to?.[0]?.address ?? "";
    const toAddr = propertyHint
      ? `property+${propertyHint}@kontext.haus`
      : originalToParam ?? headerToAddr;

    const receivedAt = receivedAtParam ?? new Date().toISOString();

    await env.EXTRACT_QUEUE.send({
      source: "email",
      msgId,
      from: fromAddr,
      to: toAddr,
      subject: parsed.subject ?? "",
      receivedAt,
      attachmentKeys,
    });

    return jsonResponse({
      ok: true,
      msgId,
      from: fromAddr,
      to: toAddr,
      subject: parsed.subject ?? "",
      receivedAt,
      attachments: attachmentKeys.length,
    });
  }

  // Property picker: list every known vault.
  if (path === "/vaults" && method === "GET") {
    const vaults = await listVaults(env.VAULTS);
    return jsonResponse({ properties: vaults });
  }

  // Bootstrap a new property from a stammdaten archive.
  // Body is a zip; we look anywhere inside it for a `stammdaten/` folder
  // containing stammdaten.json + the four CSVs. Everything else in the zip is
  // ignored at this stage — the user can later upload more files via /upload.
  const initMatch = path.match(/^\/vaults\/([^/]+)\/init$/);
  if (initMatch && method === "POST") {
    const propertyId = decodeURIComponent(initMatch[1]).trim();
    if (!propertyId || !/^[A-Z0-9-]+$/i.test(propertyId)) {
      return jsonResponse({ error: "invalid propertyId" }, 400);
    }
    if (await env.VAULTS.head(propertyMdKey(propertyId))) {
      const overwrite = url.searchParams.get("overwrite") === "true";
      if (!overwrite) {
        return jsonResponse(
          { error: "already_exists", propertyId, hint: "pass ?overwrite=true to replace" },
          409
        );
      }
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0) {
      return jsonResponse({ error: "empty body, expected zip" }, 400);
    }
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buf);
    } catch (err) {
      console.warn("[buena] init zip parse failed", err);
      return jsonResponse({ error: "could not parse zip body" }, 400);
    }

    const stammFiles = await collectStammFiles(zip);
    if (!stammFiles) {
      return jsonResponse(
        {
          error: "stammdaten_not_found",
          hint: "zip must contain stammdaten/{stammdaten.json,dienstleister.csv,eigentuemer.csv,einheiten.csv,mieter.csv}",
        },
        400
      );
    }

    let bootstrap;
    try {
      bootstrap = bootstrapVault(stammFiles, propertyId);
    } catch (err) {
      console.error("[buena] bootstrap failed", err);
      return jsonResponse({ error: "bootstrap_failed", detail: String(err) }, 500);
    }

    await Promise.all([
      writePropertyMd(env.VAULTS, propertyId, bootstrap.markdown),
      writeStateJson(env.VAULTS, propertyId, bootstrap.state),
      writeErpToD1(env.ERP, propertyId, bootstrap.erp),
    ]);

    // Optional: stash the original zip in RAW for traceability.
    const zipKey = `bulk/${propertyId}/init-${Date.now()}.zip`;
    ctx.waitUntil(
      env.RAW.put(zipKey, buf, {
        httpMetadata: { contentType: "application/zip" },
        customMetadata: { propertyId, kind: "stammdaten-init" },
      }).catch((err) => console.warn("[buena] zip stash failed", err))
    );

    return jsonResponse({
      ok: true,
      propertyId,
      name: bootstrap.erp.property.name,
      address: bootstrap.state.address,
      verwalter: bootstrap.erp.property.verwalter,
      counts: {
        units: Object.keys(bootstrap.erp.units).length,
        owners: Object.keys(bootstrap.erp.owners).length,
        tenants: Object.keys(bootstrap.erp.tenants).length,
        providers: Object.keys(bootstrap.erp.service_providers).length,
        buildings: Object.keys(bootstrap.erp.buildings).length,
      },
      zipStashedAs: zipKey,
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

    // Live ERP snapshot from D1. Read-only, render-time projection used by the
    // plugin's markdown post-processor and any agent that wants structured data.
    if (rest === "erp" && method === "GET") {
      try {
        const erp = await getErpSnapshot(env.ERP, propertyId);
        if (!erp) return jsonResponse({ error: "not_found", propertyId }, 404);
        return jsonResponse({
          propertyId,
          erp,
          generatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error("[buena] erp lookup failed", err);
        return jsonResponse({ error: "erp_lookup_failed", detail: String(err) }, 500);
      }
    }

    // Rerender property.md from the current D1 ERP snapshot. The body of
    // existing tribal-knowledge sections (Open issues, Side agreements, etc.)
    // is preserved from the existing markdown so we don't trash human edits.
    if (rest === "rerender" && method === "POST") {
      try {
        const erp = await getErpSnapshot(env.ERP, propertyId);
        if (!erp) return jsonResponse({ error: "not_found", propertyId }, 404);
        const existing = await env.VAULTS.get(propertyMdKey(propertyId));
        const existingMd = existing ? await existing.text() : null;
        const fresh = renderMarkdown(erp, propertyId);
        const merged = existingMd ? mergeTribalSections(existingMd, fresh) : fresh;
        await writePropertyMd(env.VAULTS, propertyId, merged);
        return jsonResponse({
          ok: true,
          propertyId,
          bytes: merged.length,
          preservedFromExisting: existingMd ? true : false,
        });
      } catch (err) {
        console.error("[buena] rerender failed", err);
        return jsonResponse({ error: "rerender_failed", detail: String(err) }, 500);
      }
    }

    if (rest === "pending" && method === "GET") {
      const pending = await readPending(env.VAULTS, propertyId);
      const mutated = await enrichEntriesWithSender(env.RAW, pending);
      if (mutated) {
        ctx.waitUntil(writePending(env.VAULTS, propertyId, pending));
      }
      return jsonResponse({ propertyId, pending });
    }

    if (rest === "history" && method === "GET") {
      const history = await readHistory(env.VAULTS, propertyId);
      const mutated = await enrichEntriesWithSender(env.RAW, history);
      if (mutated) {
        ctx.waitUntil(persistHistoryEntries(env.VAULTS, propertyId, history));
      }
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

  // Test helper: resolve routing for a raw .eml without enqueueing or
  // touching R2. Returns the propertyId, via (subaddress|participants|fallback),
  // matched ERP IDs, and unit hint. Used to score routing accuracy.
  if (path === "/test/route" && method === "POST") {
    const rawBuffer = await request.arrayBuffer();
    if (rawBuffer.byteLength === 0) {
      return jsonResponse({ error: "empty body, expected raw .eml" }, 400);
    }
    let parsed;
    try {
      parsed = await PostalMime.parse(rawBuffer);
    } catch {
      return jsonResponse({ error: "could not parse .eml body" }, 400);
    }
    const fromAddr = parsed.from?.address ?? "";
    const headerToAddr = parsed.to?.[0]?.address ?? "";
    const subject = parsed.subject ?? "";
    const body = (parsed.text ?? parsed.html ?? "").trim();
    const routing = resolveRouting(fromAddr, headerToAddr, subject, body);
    return jsonResponse({
      ok: true,
      from: fromAddr,
      to: headerToAddr,
      subject,
      propertyId: routing.propertyId,
      via: routing.via,
      preferredUnit: routing.preferredUnit ?? null,
      matches: routing.matches.map((m) => ({ kind: m.kind, id: m.id, units: m.unitIds })),
      matchedEmails: routing.matchedEmails,
    });
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

/**
 * Tribal-knowledge sections that may have been edited by hand or patched by
 * the engine. When we rerender from the latest D1 ERP snapshot, these bodies
 * carry over from the existing markdown so we never trash human edits.
 */
const TRIBAL_HEADINGS: ReadonlySet<string> = new Set([
  "## Open issues",
  "## Side agreements",
  "## Assembly decisions",
  "## Beirat notes",
]);

function splitSections(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = md.split("\n");
  let heading: string | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (heading !== null) out.set(heading, buf.join("\n"));
      heading = line;
      buf = [];
    } else if (heading !== null) {
      buf.push(line);
    }
  }
  if (heading !== null) out.set(heading, buf.join("\n"));
  return out;
}

function mergeTribalSections(existing: string, fresh: string): string {
  const old = splitSections(existing);
  const lines = fresh.split("\n");
  const out: string[] = [];
  let inTribalBody = false;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      out.push(line);
      if (TRIBAL_HEADINGS.has(line) && old.has(line)) {
        out.push(old.get(line)!);
        inTribalBody = true;
      } else {
        inTribalBody = false;
      }
      continue;
    }
    if (!inTribalBody) out.push(line);
  }
  return out.join("\n");
}

/**
 * Persist enriched history entries by re-uploading each JSON file under its
 * existing key. Used by the backfill on GET /vaults/:id/history.
 */
async function persistHistoryEntries(
  bucket: R2Bucket,
  propertyId: string,
  entries: import("./vaults").HistoryEntry[]
): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      const ts = entry.timestamp.replace(/[:.]/g, "-");
      await bucket.put(historyKey(propertyId, ts, entry.id), JSON.stringify(entry, null, 2), {
        httpMetadata: { contentType: "application/json" },
      });
    })
  );
}

/**
 * Walk a zip looking for the 5 stammdaten files. Accepts any depth, picks the
 * shallowest match for each of the 5 names. Returns null if any are missing.
 */
async function collectStammFiles(zip: JSZip): Promise<StammFiles | null> {
  const wanted: Record<string, RegExp> = {
    stammdaten: /(?:^|\/)stammdaten\/stammdaten\.json$/i,
    dienstleister: /(?:^|\/)stammdaten\/dienstleister\.csv$/i,
    eigentuemer: /(?:^|\/)stammdaten\/eigentuemer\.csv$/i,
    einheiten: /(?:^|\/)stammdaten\/einheiten\.csv$/i,
    mieter: /(?:^|\/)stammdaten\/mieter\.csv$/i,
  };
  const found: Record<string, { path: string; depth: number; entry: JSZip.JSZipObject }> = {};
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    for (const [key, re] of Object.entries(wanted)) {
      if (!re.test(relPath)) continue;
      const depth = relPath.split("/").length;
      const prev = found[key];
      if (!prev || depth < prev.depth) {
        found[key] = { path: relPath, depth, entry };
      }
    }
  });
  const keys: (keyof StammFiles)[] = [
    "stammdaten",
    "dienstleister",
    "eigentuemer",
    "einheiten",
    "mieter",
  ];
  for (const k of keys) {
    if (!found[k]) {
      console.warn("[buena] zip missing stammdaten file:", k);
      return null;
    }
  }
  const files = await Promise.all(
    keys.map(async (k) => [k, await found[k].entry.async("string")] as const)
  );
  return Object.fromEntries(files) as unknown as StammFiles;
}
