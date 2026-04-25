import type BuenaPlugin from "../main";
import { attachHoverPopover, HoverField } from "./hover";

/**
 * Inline annotation post-processor.
 *
 * Two annotation flavors are supported, both written inline so they survive
 * Obsidian's renderer (HTML comments are stripped from rendered output):
 *
 *   1) Provenance:  {prov: src | conf: 0.91 | actor: gemini-flash}
 *      → small "src" pill, hover shows source/confidence/actor.
 *
 *   2) Change marker:  {changed: 2026-04-25 | from: 650 EUR | actor: gemini-2.5-pro | src: ...}
 *      → bold "Δ CHANGED" pill, hover shows full diff history.
 *      Written automatically by the patch gate every time a fact is updated.
 */
export function registerProvenanceProcessor(plugin: BuenaPlugin) {
  plugin.registerMarkdownPostProcessor((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const matches: AnnotationMatch[] = [];

    const provRe =
      /\{prov:\s*([^}|]+?)(?:\s*\|\s*conf:\s*([0-9.]+))?(?:\s*\|\s*actor:\s*([^}]+?))?\s*\}/g;
    const changedRe =
      /\{changed:\s*([^}|]+?)(?:\s*\|\s*from:\s*([^}|]+?))?(?:\s*\|\s*actor:\s*([^}|]+?))?(?:\s*\|\s*src:\s*([^}]+?))?\s*\}/g;

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
          className: "buena-changed-pill",
        });
      }
    }

    // Group matches by their text node so we can replace them in one shot
    // without invalidating subsequent indices.
    const byNode = new Map<Text, AnnotationMatch[]>();
    for (const m of matches) {
      const arr = byNode.get(m.node) ?? [];
      arr.push(m);
      byNode.set(m.node, arr);
    }

    for (const [node, list] of byNode) {
      const parent = node.parentNode;
      if (!parent) continue;
      // Sort by position ascending and rebuild the node's children
      list.sort((a, b) => a.index - b.index);

      const fragments: (Node | string)[] = [];
      let cursor = 0;
      const text = node.data;

      for (const m of list) {
        if (m.index > cursor) {
          fragments.push(text.slice(cursor, m.index));
        }
        const pill = document.createElement("span");
        pill.className = m.className;
        pill.textContent = m.label;
        attachHoverPopover(pill, () => m.fields);
        fragments.push(pill);
        cursor = m.index + m.raw.length;
      }
      if (cursor < text.length) {
        fragments.push(text.slice(cursor));
      }

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
  const fields: HoverField[] = [
    { label: "Source", value: p.source, mono: true },
  ];
  if (typeof p.confidence === "number") {
    fields.push({
      label: "Confidence",
      value: `${(p.confidence * 100).toFixed(0)}%`,
    });
  }
  if (p.actor) fields.push({ label: "Actor", value: p.actor });
  return fields;
}

function changedFields(c: ChangedData): HoverField[] {
  const fields: HoverField[] = [
    { label: "Changed", value: c.when },
  ];
  if (c.from) fields.push({ label: "Was", value: c.from });
  if (c.actor) fields.push({ label: "Actor", value: c.actor });
  if (c.source) fields.push({ label: "Source", value: c.source, mono: true });
  return fields;
}
