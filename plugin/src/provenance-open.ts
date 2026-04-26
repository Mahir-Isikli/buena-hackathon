import { Notice, TFile, normalizePath } from "obsidian";
import type BuenaPlugin from "../main";
import { fetchRawSource } from "./api";

/**
 * Fetch a small text preview of a provenance source. For .eml, extract
 * the first text/plain part so the popover shows the actual email body
 * rather than raw MIME headers. For other text-ish files, return the
 * decoded body. Returns null if the source can't be previewed.
 */
export async function loadSourcePreview(
  plugin: BuenaPlugin,
  source: string
): Promise<string> {
  const parsed = parseR2RawSource(source);
  if (!parsed) throw new Error("source not directly fetchable");
  const { blob, contentType } = await fetchRawSource(plugin.settings, parsed.key);
  const lower = parsed.key.toLowerCase();
  const ct = (contentType || "").toLowerCase();
  const text = await blob.text();
  if (lower.endsWith(".eml") || ct.startsWith("message/rfc822")) {
    return extractEmailBody(text);
  }
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".html") ||
    lower.endsWith(".htm") ||
    lower.endsWith(".json") ||
    lower.endsWith(".csv") ||
    ct.startsWith("text/") ||
    ct.includes("json")
  ) {
    return truncate(text, 6000);
  }
  return `(${blob.size} bytes, ${ct || "unknown type"})`;
}

function extractEmailBody(raw: string): string {
  // Split headers from body at first blank line.
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const headers = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw;
  let body = headerEnd >= 0 ? raw.slice(headerEnd).replace(/^\r?\n\r?\n/, "") : "";

  const ctLine = /content-type:\s*([^\r\n;]+)(?:[^\r\n]*boundary="?([^";\r\n]+)"?)?/i.exec(
    headers
  );
  const topType = ctLine?.[1]?.trim().toLowerCase() ?? "text/plain";
  const boundary = ctLine?.[2]?.trim();

  if (boundary) {
    const parts = body.split(`--${boundary}`);
    let plain: string | null = null;
    let html: string | null = null;
    for (const p of parts) {
      const sep = p.search(/\r?\n\r?\n/);
      if (sep < 0) continue;
      const partHeaders = p.slice(0, sep).toLowerCase();
      const partBody = p.slice(sep).replace(/^\r?\n\r?\n/, "").trim();
      if (partHeaders.includes("content-type: text/plain") && plain === null) {
        plain = decodeQuotedPrintable(partBody);
      } else if (partHeaders.includes("content-type: text/html") && html === null) {
        html = decodeQuotedPrintable(partBody);
      }
    }
    if (plain) return truncate(plain, 6000);
    if (html) return truncate(stripHtml(html), 6000);
  }

  if (topType === "text/html") return truncate(stripHtml(body), 6000);
  return truncate(decodeQuotedPrintable(body), 6000);
}

function decodeQuotedPrintable(s: string): string {
  // Lightweight: just unwrap soft line breaks. Full QP decoding not needed for preview.
  return s.replace(/=\r?\n/g, "");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>(\r?\n)?/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(s: string, max: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + "\n\n… (truncated)";
}

export function isPreviewableSource(source: string): boolean {
  return parseR2RawSource(source) !== null;
}

export async function openProvenanceSource(
  plugin: BuenaPlugin,
  source: string
): Promise<void> {
  const parsed = parseR2RawSource(source);
  if (!parsed) {
    new Notice(`[Buena] source not directly fetchable yet: ${source}`);
    return;
  }

  try {
    const { blob } = await fetchRawSource(plugin.settings, parsed.key);
    const path = normalizePath(`attachments/${parsed.key}`);
    await ensureParentFolders(plugin, path);
    const existing = plugin.app.vault.getAbstractFileByPath(path);
    const data = await blob.arrayBuffer();
    let file: TFile;
    if (existing instanceof TFile) {
      await plugin.app.vault.modifyBinary(existing, data);
      file = existing;
    } else {
      file = await plugin.app.vault.createBinary(path, data);
    }
    await plugin.app.workspace.getLeaf(false).openFile(file);
  } catch (err) {
    console.error("[Buena] failed to open provenance source", err);
    new Notice(`[Buena] failed to open source: ${err}`);
  }
}

function parseR2RawSource(source: string): { key: string } | null {
  const trimmed = source.trim();
  const prefix = "r2://buena-raw/";
  if (trimmed.startsWith(prefix)) {
    return { key: trimmed.slice(prefix.length) };
  }
  if (/^(emails|attachments|bulk)\//i.test(trimmed)) {
    return { key: trimmed };
  }
  return null;
}

async function ensureParentFolders(plugin: BuenaPlugin, path: string): Promise<void> {
  const parts = path.split("/");
  parts.pop();
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!plugin.app.vault.getAbstractFileByPath(current)) {
      await plugin.app.vault.createFolder(current);
    }
  }
}
