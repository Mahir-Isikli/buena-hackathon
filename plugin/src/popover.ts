import type BuenaPlugin from "../main";

/**
 * Scans rendered markdown for `<!-- prov: ... -->` comments and surfaces them
 * as a small inline pill that shows provenance on hover.
 *
 * The HTML comment itself is invisible by default in Obsidian, so we walk the
 * raw markdown source pre-render to find these markers, then attach a hover
 * pill to the line above (which is the fact they describe).
 *
 * For v1 we use the source text passed to the post-processor: each rendered
 * section has a `el.parentElement` we can scan, but a simpler approach is to
 * scan all paragraphs for adjacent text nodes that look like prov markers.
 */
export function registerProvenanceProcessor(plugin: BuenaPlugin) {
  plugin.registerMarkdownPostProcessor((el) => {
    // Walk text nodes to find HTML comments rendered as raw text in some themes,
    // but Obsidian strips them. Instead we look for an alternative inline syntax:
    //   {prov: source | conf: 0.91 | actor: gemini-flash}
    //
    // This keeps the markdown human-readable AND machine-parseable without
    // depending on HTML comments surviving the renderer.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const matches: { node: Text; index: number; raw: string; parsed: ProvData }[] = [];
    const re = /\{prov:\s*([^}|]+?)(?:\s*\|\s*conf:\s*([0-9.]+))?(?:\s*\|\s*actor:\s*([^}]+?))?\s*\}/g;

    let n: Node | null;
    while ((n = walker.nextNode())) {
      const text = (n as Text).data;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        matches.push({
          node: n as Text,
          index: m.index,
          raw: m[0],
          parsed: {
            source: m[1].trim(),
            confidence: m[2] ? parseFloat(m[2]) : undefined,
            actor: m[3]?.trim(),
          },
        });
      }
    }

    // Replace each match with a styled pill that has a tooltip.
    for (const match of matches.reverse()) {
      const before = match.node.data.slice(0, match.index);
      const after = match.node.data.slice(match.index + match.raw.length);
      const parent = match.node.parentNode;
      if (!parent) continue;

      const beforeNode = document.createTextNode(before);
      const afterNode = document.createTextNode(after);

      const pill = document.createElement("span");
      pill.className = "buena-prov-pill";
      pill.textContent = "src";
      pill.setAttribute("aria-label", formatTooltip(match.parsed));
      pill.title = formatTooltip(match.parsed);

      parent.insertBefore(beforeNode, match.node);
      parent.insertBefore(pill, match.node);
      parent.insertBefore(afterNode, match.node);
      parent.removeChild(match.node);
    }
  });
}

interface ProvData {
  source: string;
  confidence?: number;
  actor?: string;
}

function formatTooltip(p: ProvData): string {
  const parts = [`Source: ${p.source}`];
  if (typeof p.confidence === "number") {
    parts.push(`Confidence: ${(p.confidence * 100).toFixed(0)}%`);
  }
  if (p.actor) parts.push(`Actor: ${p.actor}`);
  return parts.join("\n");
}
