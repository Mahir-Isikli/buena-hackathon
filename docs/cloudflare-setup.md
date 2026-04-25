# Cloudflare setup (deferred)

Park this until the edit flow + extractor are working. Whole thing is ~20 min.

## What we're setting up

1. A domain on Cloudflare (existing or new).
2. Email Routing on that domain (catch-all).
3. An Email Worker that receives mail, parses MIME with `postal-mime`, drops attachments to R2, and enqueues an extraction job.
4. An R2 bucket for raw .eml + attachments.
5. A Queue for downstream extraction.
6. (Optional) Pages site for the bulk-import drag-and-drop page.

## What I need from you to do it solo

- A Cloudflare API token, scoped:
  - **Account permissions**: Workers Scripts: Edit, Workers R2 Storage: Edit, Workers KV: Edit, Queues: Edit, Email Routing: Edit, Pages: Edit
  - **Zone permissions** (scoped to the chosen domain): DNS: Edit, Workers Routes: Edit, Email Routing: Edit
  - **Account resources**: include your account
  - **Zone resources**: specific zone = the chosen domain
- Domain decision: reuse an existing one or buy a fresh one.
- Stored in keychain so I can pick it up:
  ```bash
  security add-generic-password -a "mahirisikli" -s "cloudflare-buena-token" -w "TOKEN" -U
  ```

## Domain options

- Reuse one you already own (cheapest, fastest).
- Buy fresh on Cloudflare Registrar at-cost: `.com` ~$10.44/yr, `.dev` ~$12/yr, `.email` ~$30/yr.
- Naming candidates: `buena-context.com`, `building-md.com`, `weg.email`, `propvault.dev`, `claudemd.haus`.

## Email Worker shape

```ts
// workers/ingest/src/email.ts
import PostalMime from "postal-mime";

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    const email = await PostalMime.parse(message.raw);
    const msgId = email.messageId ?? crypto.randomUUID();

    // 1. raw .eml to R2
    await env.RAW.put(`emails/${msgId}.eml`, message.raw);

    // 2. attachments to R2
    for (const att of email.attachments) {
      const key = `attachments/${msgId}/${att.filename ?? "unnamed"}`;
      await env.RAW.put(key, att.content as ArrayBuffer, {
        httpMetadata: { contentType: att.mimeType },
      });
    }

    // 3. enqueue for extraction
    await env.EXTRACT_QUEUE.send({
      msgId,
      from: message.from,
      to: message.to,                        // contains +tag for subaddressing
      subject: email.subject,
      attachmentKeys: email.attachments.map((a, i) =>
        `attachments/${msgId}/${a.filename ?? `att-${i}`}`),
    });
  },
} satisfies ExportedHandler<Env>;
```

## Wrangler config

```toml
# workers/ingest/wrangler.toml
name = "buena-ingest"
main = "src/email.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

[triggers]
email = ["*@<your-domain>"]

[[r2_buckets]]
binding = "RAW"
bucket_name = "buena-raw"

[[queues.producers]]
binding = "EXTRACT_QUEUE"
queue = "buena-extract"
```

## Subaddressing trick

Enable subaddressing in dashboard. Then `property+LIE-001@<domain>` routes to `property@<domain>` and the `+LIE-001` survives in `message.to`. Use it as a property hint in the worker so we skip routing inference for known forwards.

## DNS records added automatically by Email Routing

- `MX` records pointing to `*.mx.cloudflare.net`
- `TXT` SPF: `v=spf1 include:_spf.mx.cloudflare.net ~all`
- `TXT` DKIM (Cloudflare manages key)

## Step-by-step (for Sunday morning, 20 min)

1. Pick domain. If new, buy via Registrar.
2. Email Routing → Onboard domain → Add records and enable.
3. `wrangler init workers/ingest` in the worktree.
4. Drop in `email.ts` + `wrangler.toml` above.
5. `wrangler r2 bucket create buena-raw`
6. `wrangler queues create buena-extract`
7. `wrangler deploy`
8. Email Routing → Routes → Catch-all → Send to Worker → `buena-ingest`.
9. Send a test email. Check R2 + queue dashboard.
10. Wire the queue consumer to call Gemini 3.1 Pro (high thinking) extraction.

## When to do this

After:
- Plugin edit flow ships
- Local Gemini 3.1 Pro extractor works on `partner-files/emails/*` (file-based, not email-driven)

The whole demo can run from local files; email is the polish for the Loom.
