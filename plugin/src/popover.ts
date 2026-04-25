import type BuenaPlugin from "../main";

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
        matches.push({
          kind: "prov",
          node: n as Text,
          index: m.index,
          raw: m[0],
          tooltip: formatProvTooltip({
            source: m[1].trim(),
            confidence: m[2] ? parseFloat(m[2]) : undefined,
            actor: m[3]?.trim(),
          }),
          label: "src",
          className: "buena-prov-pill",
        });
      }

      while ((m = changedRe.exec(text)) !== null) {
        matches.push({
          kind: "changed",
          node: n as Text,
          index: m.index,
          raw: m[0],
          tooltip: formatChangedTooltip({
            when: m[1].trim(),
            from: m[2]?.trim(),
            actor: m[3]?.trim(),
            source: m[4]?.trim(),
          }),
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
        pill.title = m.tooltip;
        pill.setAttribute("aria-label", m.tooltip);
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
  tooltip: string;
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

function formatProvTooltip(p: ProvData): string {
  const parts = [`Source: ${p.source}`];
  if (typeof p.confidence === "number") {
    parts.push(`Confidence: ${(p.confidence * 100).toFixed(0)}%`);
  }
  if (p.actor) parts.push(`Actor: ${p.actor}`);
  return parts.join("\n");
}

function formatChangedTooltip(c: ChangedData): string {
  const parts = [`Changed ${c.when}`];
  if (c.from) parts.push(`Was: ${c.from}`);
  if (c.actor) parts.push(`By: ${c.actor}`);
  if (c.source) parts.push(`Source: ${c.source}`);
  return parts.join("\n");
}
