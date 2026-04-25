import type BuenaPlugin from "../main";
import { attachHoverPopover, HoverField } from "./hover";
import { openProvenanceSource } from "./provenance-open";

/**
 * Inline annotation post-processor.
 *
 * Supported forms:
 * - {prov: src | conf: 0.91 | actor: gemini}
 * - {changed: 2026-04-25T... | from: old | actor: gemini | src: ...}
 * - ^[src: path · actor: x · conf: 1.0]
 */
export function registerProvenanceProcessor(plugin: BuenaPlugin) {
  plugin.registerMarkdownPostProcessor((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const matches: AnnotationMatch[] = [];

    const provRe =
      /\{prov:\s*([^}|]+?)(?:\s*\|\s*conf:\s*([0-9.]+))?(?:\s*\|\s*actor:\s*([^}]+?))?\s*\}/g;
    const changedRe =
      /\{changed:\s*([^}|]+?)(?:\s*\|\s*from:\s*([^}|]+?))?(?:\s*\|\s*actor:\s*([^}|]+?))?(?:\s*\|\s*src:\s*([^}]+?))?\s*\}/g;
    const footnoteProvRe =
      /\^\[src:\s*([^·\]]+?)(?:\s*·\s*actor:\s*([^·\]]+?))?(?:\s*·\s*conf:\s*([0-9.]+))?\s*\]/g;

    let n: Node | null;
    while ((n = walker.nextNode())) {
      const text = (n as Text).data;

      let m: RegExpExecArray | null;
      while ((m = provRe.exec(text)) !== null) {
        const prov: ProvData = {
          source: m[1].trim(),
          confidence: m[2] ? parseFloat(m[2]) : undefined,
          actor: m[3]?.trim(),
        };
        matches.push({
          kind: "prov",
          node: n as Text,
          index: m.index,
          raw: m[0],
          fields: provFields(prov),
          label: "src",
          className: "buena-prov-pill",
          source: prov.source,
        });
      }

      while ((m = changedRe.exec(text)) !== null) {
        const ch: ChangedData = {
          when: m[1].trim(),
          from: m[2]?.trim(),
          actor: m[3]?.trim(),
          source: m[4]?.trim(),
        };
        matches.push({
          kind: "changed",
          node: n as Text,
          index: m.index,
          raw: m[0],
          fields: changedFields(ch),
          label: "changed",
          className: `buena-changed-pill${isRecent(ch.when) ? " buena-changed-pill-recent" : ""}`,
          source: ch.source,
          recent: isRecent(ch.when),
        });
      }

      while ((m = footnoteProvRe.exec(text)) !== null) {
        const prov: ProvData = {
          source: m[1].trim(),
          actor: m[2]?.trim(),
          confidence: m[3] ? parseFloat(m[3]) : undefined,
        };
        matches.push({
          kind: "prov",
          node: n as Text,
          index: m.index,
          raw: m[0],
          fields: provFields(prov),
          label: "src",
          className: "buena-prov-pill",
          source: prov.source,
        });
      }
    }

    const byNode = new Map<Text, AnnotationMatch[]>();
    for (const m of matches) {
      const arr = byNode.get(m.node) ?? [];
      arr.push(m);
      byNode.set(m.node, arr);
    }

    for (const [node, list] of byNode) {
      const parent = node.parentNode;
      if (!parent) continue;
      list.sort((a, b) => a.index - b.index);

      const fragments: (Node | string)[] = [];
      let cursor = 0;
      const text = node.data;

      for (const m of list) {
        if (m.index > cursor) fragments.push(text.slice(cursor, m.index));
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = m.className;
        pill.textContent = m.label;
        attachHoverPopover(pill, () => m.fields);
        if (m.kind === "prov" && m.source) {
          pill.title = "Open source";
          pill.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            void openProvenanceSource(plugin, m.source!);
          });
        }
        if (m.recent) {
          const host = nearestContentHost(parent);
          host?.classList.add("buena-recent-content");
        }
        fragments.push(pill);
        cursor = m.index + m.raw.length;
      }
      if (cursor < text.length) fragments.push(text.slice(cursor));

      const frag = document.createDocumentFragment();
      for (const f of fragments) {
        frag.append(typeof f === "string" ? document.createTextNode(f) : f);
      }
      parent.replaceChild(frag, node);
    }
  });
}

interface AnnotationMatch {
  kind: "prov" | "changed";
  node: Text;
  index: number;
  raw: string;
  label: string;
  className: string;
  fields: HoverField[];
  source?: string;
  recent?: boolean;
}

interface ProvData {
  source: string;
  confidence?: number;
  actor?: string;
}

interface ChangedData {
  when: string;
  from?: string;
  actor?: string;
  source?: string;
}

function provFields(p: ProvData): HoverField[] {
  const fields: HoverField[] = [{ label: "Source", value: p.source, mono: true }];
  if (typeof p.confidence === "number") {
    fields.push({ label: "Confidence", value: `${(p.confidence * 100).toFixed(0)}%` });
  }
  if (p.actor) fields.push({ label: "Actor", value: p.actor });
  return fields;
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const secs = Math.floor((Date.now() - t) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function changedFields(c: ChangedData): HoverField[] {
  const fields: HoverField[] = [{ label: "Changed", value: timeAgo(c.when) }];
  if (c.from) fields.push({ label: "Was", value: c.from });
  if (c.actor) fields.push({ label: "Actor", value: c.actor });
  if (c.source) fields.push({ label: "Source", value: c.source, mono: true });
  return fields;
}

function isRecent(when: string): boolean {
  const t = Date.parse(when);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < 24 * 60 * 60 * 1000;
}

function nearestContentHost(node: Node): HTMLElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (cur instanceof HTMLElement && ["LI", "P", "DIV"].includes(cur.tagName)) {
      return cur;
    }
    cur = cur.parentNode;
  }
  return null;
}
