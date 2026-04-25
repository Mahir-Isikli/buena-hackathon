import PostalMime from "postal-mime";
import { Env, handleHttp } from "./http";
import { extractCandidates } from "./gemini";
import { resolvePropertyId } from "./route";
import { buildPendingPatches } from "./gate";
import { appendPending } from "./vaults";

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

  // Queue consumer: real extractor.
  // Each message is one inbound email. Pull the .eml from R2, ask Gemini
  // for candidate facts, build pending patches, append to vaults/<id>/pending.json.
  // Per-message try/catch so a single bad email doesn't poison the batch.
  async queue(batch: QueueBatch<EmailJob>, env: Env): Promise<void> {
    console.log(`[buena-queue] ${batch.messages.length} message(s) on ${batch.queue}`);
    await Promise.all(
      batch.messages.map(async (msg) => {
        try {
          await processEmailJob(msg.body, env);
          msg.ack();
        } catch (err) {
          console.error("[buena-queue] failed", msg.body, err);
          msg.retry();
        }
      })
    );
  },
};

interface EmailJob {
  source: "email" | "bulk";
  msgId?: string;
  from?: string;
  to?: string;
  subject?: string;
  receivedAt?: string;
  attachmentKeys?: string[];
  // bulk shape
  key?: string;
  filename?: string;
  size?: number;
}

async function processEmailJob(job: EmailJob, env: Env): Promise<void> {
  if (job.source !== "email" || !job.msgId) {
    // Bulk path is handled in a later iteration.
    console.log("[buena-queue] skipping non-email job", job.source);
    return;
  }
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY secret is not set");
  }

  const emlKey = `emails/${job.msgId}.eml`;
  const obj = await env.RAW.get(emlKey);
  if (!obj) {
    console.warn("[buena-queue] no .eml in R2 for", emlKey);
    return;
  }
  const raw = await obj.arrayBuffer();
  const parsed = await PostalMime.parse(raw);
  const body = (parsed.text ?? parsed.html ?? "").trim();
  if (!body) {
    console.warn("[buena-queue] empty email body for", job.msgId);
    return;
  }

  const propertyId = resolvePropertyId(job.to ?? "");
  const candidates = await extractCandidates(env.GEMINI_API_KEY, body, {
    subject: job.subject ?? parsed.subject ?? "",
    from: job.from ?? "",
    to: job.to ?? "",
  });
  console.log(
    `[buena-queue] ${job.msgId} -> property ${propertyId}, ${candidates.length} candidate(s)`
  );

  const patches = buildPendingPatches({
    msgId: job.msgId,
    source: `r2://buena-raw/${emlKey}`,
    candidates,
    receivedAt: job.receivedAt ?? new Date().toISOString(),
  });
  for (const p of patches) {
    await appendPending(env.VAULTS, propertyId, p);
  }
}
