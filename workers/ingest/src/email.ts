import PostalMime from "postal-mime";

interface Env {
  RAW: R2Bucket;
  EXTRACT_QUEUE: Queue;
}

interface ForwardableEmailMessage {
  from: string;
  to: string;
  raw: ReadableStream;
  rawSize: number;
  headers: Headers;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
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
  // HTTP entry: health check + bulk-import upload endpoint
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "buena-ingest", time: Date.now() });
    }

    if (url.pathname === "/upload" && request.method === "POST") {
      const filename = url.searchParams.get("name") ?? `upload-${crypto.randomUUID()}`;
      const key = `bulk/${Date.now()}-${filename}`;
      const body = await request.arrayBuffer();
      await env.RAW.put(key, body, {
        httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" },
      });
      await env.EXTRACT_QUEUE.send({ source: "bulk", key, filename, size: body.byteLength });
      return Response.json({ ok: true, key, size: body.byteLength });
    }

    return new Response("buena-ingest", { status: 200 });
  },

  // Email entry: triggered by Cloudflare Email Routing
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
      const content = att.content instanceof ArrayBuffer
        ? att.content
        : new TextEncoder().encode(att.content as string).buffer;
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
};
