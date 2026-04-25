import JSZip from "jszip";
import PostalMime from "postal-mime";
import { Env, handleHttp } from "./http";
import { extractBulkCandidates, extractCandidates } from "./gemini";
import { resolveRouting, routingHintText } from "./route";
import { applyPatchGate } from "./gate";

interface ForwardableEmailMessage {
  from: string;
  to: string;
  raw: ReadableStream;
  rawSize: number;
  headers: Headers;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
}

interface QueueMessage<T> {
  id: string;
  timestamp: number;
  body: T;
  ack: () => void;
  retry: () => void;
}

interface QueueBatch<T> {
  queue: string;
  messages: QueueMessage<T>[];
}

async function streamToArrayBuffer(stream: ReadableStream, size: number): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out.buffer;
}

export default {
  // HTTP entry: health, bulk-import upload, vault read/write, SSE.
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleHttp(request, env, ctx);
  },

  // Email entry: triggered by Cloudflare Email Routing.
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const rawBuffer = await streamToArrayBuffer(message.raw, message.rawSize);
    const email = await PostalMime.parse(rawBuffer);
    const msgId = (email.messageId ?? crypto.randomUUID()).replace(/[<>]/g, "");

    // 1. raw .eml to R2
    await env.RAW.put(`emails/${msgId}.eml`, rawBuffer, {
      httpMetadata: { contentType: "message/rfc822" },
    });

    // 2. attachments to R2
    const attachmentKeys: string[] = [];
    for (let i = 0; i < (email.attachments?.length ?? 0); i++) {
      const att = email.attachments![i];
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

    // 3. enqueue for extraction
    await env.EXTRACT_QUEUE.send({
      source: "email",
      msgId,
      from: message.from,
      to: message.to,
      subject: email.subject ?? "",
      receivedAt: new Date().toISOString(),
      attachmentKeys,
    });
  },

  // Queue consumer: email + bulk extraction.
  async queue(batch: QueueBatch<QueueJob>, env: Env): Promise<void> {
    console.log(`[buena-queue] ${batch.messages.length} message(s) on ${batch.queue}`);
    await Promise.all(
      batch.messages.map(async (msg) => {
        try {
          await processQueueJob(msg.body, env);
          msg.ack();
        } catch (err) {
          console.error("[buena-queue] failed", msg.body, err);
          msg.retry();
        }
      })
    );
  },
};

type QueueJob = EmailJob | BulkJob;

interface EmailJob {
  source: "email";
  msgId?: string;
  from?: string;
  to?: string;
  subject?: string;
  receivedAt?: string;
  attachmentKeys?: string[];
}

interface BulkJob {
  source: "bulk";
  key?: string;
  filename?: string;
  size?: number;
  contentType?: string;
  propertyId?: string;
  propertyLabel?: string;
  propertyAddress?: string;
  note?: string;
  uploadedAt?: string;
}

async function processQueueJob(job: QueueJob, env: Env): Promise<void> {
  if (job.source === "email") {
    await processEmailJob(job, env);
    return;
  }
  if (job.source === "bulk") {
    await processBulkJob(job, env);
    return;
  }
  console.log("[buena-queue] skipping unknown job source", (job as { source?: string }).source);
}

async function processEmailJob(job: EmailJob, env: Env): Promise<void> {
  if (!job.msgId) {
    console.log("[buena-queue] skipping email job without msgId");
    return;
  }
  ensureGemini(env);

  const emlKey = `emails/${job.msgId}.eml`;
  const obj = await env.RAW.get(emlKey);
  if (!obj) {
    console.warn("[buena-queue] no .eml in R2 for", emlKey);
    return;
  }
  const raw = await obj.arrayBuffer();
  const parsed = await PostalMime.parse(raw);
  const body = (parsed.text ?? parsed.html ?? "").trim();

  const routing = resolveRouting(
    job.from ?? "",
    job.to ?? "",
    job.subject ?? parsed.subject ?? "",
    body
  );
  const propertyId = routing.propertyId;
  const routingHint = routingHintText(routing);

  let totalCandidates = 0;

  if (body) {
    const candidates = await extractCandidates(env.GEMINI_API_KEY!, body, {
      subject: job.subject ?? parsed.subject ?? "",
      from: job.from ?? "",
      to: job.to ?? "",
      routingHint,
    });
    const candidatesWithHints = applyPreferredUnit(candidates, routing.preferredUnit);
    totalCandidates += candidatesWithHints.length;
    await applyPatchGate({
      bucket: env.VAULTS,
      propertyId,
      patchBaseId: job.msgId,
      source: `r2://buena-raw/${emlKey}`,
      candidates: candidatesWithHints,
      receivedAt: job.receivedAt ?? new Date().toISOString(),
      actor: "gemini-3-pro",
    });
  }

  const attachmentKeys = job.attachmentKeys ?? [];
  let attachmentIndex = 0;
  for (const key of attachmentKeys) {
    const attachmentCandidates = await processEmailAttachment(
      env,
      key,
      {
        msgId: job.msgId,
        propertyId,
        propertyLabel: propertyId,
        note: `Attachment from email subject: ${job.subject ?? parsed.subject ?? ""}`,
        routingHint,
        preferredUnit: routing.preferredUnit,
        receivedAt: job.receivedAt ?? new Date().toISOString(),
      },
      attachmentIndex++
    );
    totalCandidates += attachmentCandidates;
  }

  if (!body && attachmentKeys.length === 0) {
    console.warn("[buena-queue] empty email body and no attachments for", job.msgId);
    return;
  }

  console.log(
    `[buena-queue] email ${job.msgId} -> property ${propertyId} via ${routing.via}, ${routing.matches.length} deterministic match(es), ${totalCandidates} candidate(s) total`
  );
}

async function processBulkJob(job: BulkJob, env: Env): Promise<void> {
  if (!job.key) {
    console.log("[buena-queue] skipping bulk job without key");
    return;
  }
  ensureGemini(env);
  await processStoredDocument(env, {
    key: job.key,
    propertyId: job.propertyId ?? "LIE-001",
    propertyLabel: job.propertyLabel,
    propertyAddress: job.propertyAddress,
    note: job.note,
    preferredUnit: undefined,
    routingHint: undefined,
    receivedAt: job.uploadedAt ?? new Date().toISOString(),
    patchBaseId: bulkPatchBaseId(job.key),
  });
}

async function processEmailAttachment(
  env: Env,
  key: string,
  meta: {
    msgId: string;
    propertyId: string;
    propertyLabel?: string;
    note?: string;
    routingHint?: string;
    preferredUnit?: string;
    receivedAt: string;
  },
  attachmentIndex: number
): Promise<number> {
  return processStoredDocument(env, {
    key,
    propertyId: meta.propertyId,
    propertyLabel: meta.propertyLabel,
    note: meta.note,
    routingHint: meta.routingHint,
    preferredUnit: meta.preferredUnit,
    receivedAt: meta.receivedAt,
    patchBaseId: `${meta.msgId}-att-${attachmentIndex}`,
  });
}

async function processStoredDocument(
  env: Env,
  meta: {
    key: string;
    propertyId: string;
    propertyLabel?: string;
    propertyAddress?: string;
    note?: string;
    routingHint?: string;
    preferredUnit?: string;
    receivedAt: string;
    patchBaseId: string;
  }
): Promise<number> {
  const obj = await env.RAW.get(meta.key);
  if (!obj) {
    console.warn("[buena-queue] no stored object in R2 for", meta.key);
    return 0;
  }

  const raw = await obj.arrayBuffer();
  if (raw.byteLength === 0) {
    console.warn("[buena-queue] empty stored object", meta.key);
    return 0;
  }

  const filename = basename(meta.key);
  const mimeType = obj.httpMetadata?.contentType ?? guessMimeType(filename);
  const text = await extractTextLike(raw, filename, mimeType);
  const routing = resolveRouting(
    "bulk-import",
    `property+${meta.propertyId}@kontext.haus`,
    filename,
    text ?? ""
  );
  const routingHint = [
    meta.routingHint,
    routingHintText(routing),
    meta.note ? `- Operator note: ${meta.note}` : null,
  ]
    .filter((v): v is string => !!v)
    .join("\n");

  const candidates = await extractBulkCandidates(
    env.GEMINI_API_KEY!,
    {
      filename,
      mimeType,
      text: text ?? undefined,
      data: text ? undefined : raw,
    },
    {
      propertyId: meta.propertyId,
      propertyLabel: meta.propertyLabel,
      propertyAddress: meta.propertyAddress,
      note: meta.note,
      routingHint: routingHint || undefined,
    }
  );

  if (!text && candidates.length === 0) {
    console.log(`[buena-queue] stored doc ${filename} unsupported or no extractable facts (${mimeType})`);
    return 0;
  }

  const preferredUnit = meta.preferredUnit ?? routing.preferredUnit;
  const candidatesWithHints = applyPreferredUnit(candidates, preferredUnit);
  console.log(
    `[buena-queue] stored doc ${filename} -> property ${meta.propertyId}, mime ${mimeType}, ${candidatesWithHints.length} candidate(s)`
  );

  await applyPatchGate({
    bucket: env.VAULTS,
    propertyId: meta.propertyId,
    patchBaseId: meta.patchBaseId,
    source: `r2://buena-raw/${meta.key}`,
    candidates: candidatesWithHints,
    receivedAt: meta.receivedAt,
    actor: "gemini-3-pro",
  });
  return candidatesWithHints.length;
}

function ensureGemini(env: Env): void {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY secret is not set");
  }
}

function applyPreferredUnit<T extends { section: string; unit?: string }>(
  candidates: T[],
  preferredUnit?: string
): T[] {
  if (!preferredUnit) return candidates;
  return candidates.map((c) =>
    c.unit || !prefersUnitContext(c.section)
      ? c
      : {
          ...c,
          unit: preferredUnit,
        }
  );
}

function prefersUnitContext(section: string): boolean {
  return section === "Units" || section === "Open issues";
}

async function extractTextLike(
  raw: ArrayBuffer,
  filename: string,
  mimeType: string
): Promise<string | null> {
  const ext = extension(filename);
  if (ext === "eml" || mimeType === "message/rfc822") {
    try {
      const parsed = await PostalMime.parse(raw);
      return (parsed.text ?? parsed.html ?? "").trim() || null;
    } catch {
      return null;
    }
  }

  if (
    mimeType.startsWith("text/") ||
    ["json", "csv", "md", "markdown", "html", "htm", "xml"].includes(ext)
  ) {
    try {
      return new TextDecoder().decode(raw).trim() || null;
    } catch {
      return null;
    }
  }

  if (["zip", "docx", "xlsx"].includes(ext)) {
    return extractZipFamilyText(raw, ext);
  }

  return null;
}

async function extractZipFamilyText(raw: ArrayBuffer, ext: string): Promise<string | null> {
  try {
    const zip = await JSZip.loadAsync(raw);
    const files = Object.values(zip.files).filter((f) => !f.dir);
    const parts: string[] = [];

    if (ext === "docx") {
      for (const f of files) {
        if (f.name === "word/document.xml" || f.name.startsWith("word/footnotes")) {
          const xml = await f.async("string");
          const text = stripXml(xml);
          if (text) parts.push(text);
        }
      }
    } else if (ext === "xlsx") {
      for (const f of files) {
        if (
          f.name === "xl/sharedStrings.xml" ||
          f.name.startsWith("xl/worksheets/") ||
          f.name === "xl/workbook.xml"
        ) {
          const xml = await f.async("string");
          const text = stripXml(xml);
          if (text) parts.push(text);
        }
      }
    } else {
      parts.push(`Archive entries:\n${files.map((f) => `- ${f.name}`).join("\n")}`);
      for (const f of files.slice(0, 25)) {
        const innerExt = extension(f.name);
        if (["txt", "md", "markdown", "json", "csv", "html", "htm", "xml"].includes(innerExt)) {
          const text = (await f.async("string")).trim();
          if (text) parts.push(`\n## ${f.name}\n${text.slice(0, 4000)}`);
        } else if (["docx", "xlsx"].includes(innerExt)) {
          const buf = await f.async("arraybuffer");
          const nested = await extractZipFamilyText(buf, innerExt);
          if (nested) parts.push(`\n## ${f.name}\n${nested.slice(0, 4000)}`);
        }
      }
    }

    const joined = parts.join("\n\n").trim();
    return joined || null;
  } catch (err) {
    console.warn("[buena-queue] failed to parse zip-family file", ext, err);
    return null;
  }
}

function stripXml(xml: string): string {
  return xml
    .replace(/<w:tab\/?\s*>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function guessMimeType(filename: string): string {
  const ext = extension(filename);
  switch (ext) {
    case "txt":
      return "text/plain";
    case "md":
    case "markdown":
      return "text/markdown";
    case "json":
      return "application/json";
    case "csv":
      return "text/csv";
    case "html":
    case "htm":
      return "text/html";
    case "xml":
      return "application/xml";
    case "eml":
      return "message/rfc822";
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "zip":
      return "application/zip";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return "application/octet-stream";
  }
}

function extension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function bulkPatchBaseId(key: string): string {
  return `bulk-${key.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
}
