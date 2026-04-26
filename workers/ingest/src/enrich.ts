/**
 * Tavily contractor enrichment.
 *
 * Lazy enrichment for service providers. When a Gemini-extracted candidate
 * mentions a contractor name, fire one Tavily search and emit a follow-up
 * candidate fact with actor "tavily" and the top result URL as provenance.
 *
 * Lands under a dedicated "External context" section so the engine never
 * pollutes the canonical "Service providers" block, and so the gate's
 * conflict detection has a clean target heading to write to.
 */

import type { CandidateFact } from "./gemini";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

export interface ContractorEnrichment {
  summary: string;
  url: string;
  query: string;
}

interface TavilyResult {
  title?: string;
  url: string;
  content?: string;
  score?: number;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

/**
 * Search Tavily for public context about a contractor / service provider.
 * Returns a one-paragraph summary, the top source URL, and the query used.
 * Returns null on any failure or if Tavily produced nothing usable.
 */
export async function enrichContractor(
  apiKey: string,
  name: string,
  location: string = "Berlin"
): Promise<ContractorEnrichment | null> {
  const query = `${name} ${location} Hausverwaltung Dienstleister Bewertung website`;
  let res: Response;
  try {
    res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 3,
        include_answer: true,
      }),
    });
  } catch (err) {
    console.warn("[buena-tavily] fetch error", err);
    return null;
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[buena-tavily] search failed", res.status, errText.slice(0, 200));
    return null;
  }
  let json: TavilyResponse;
  try {
    json = (await res.json()) as TavilyResponse;
  } catch (err) {
    console.warn("[buena-tavily] failed to parse response", err);
    return null;
  }
  const answer =
    (json.answer && json.answer.trim()) ||
    (json.results?.[0]?.content?.trim() ?? "");
  const url = json.results?.[0]?.url;
  if (!answer || !url) return null;
  return {
    summary: condenseSummary(answer),
    url,
    query,
  };
}

// Capitalized German prepositions, articles, and sentence-starters that
// should not be treated as part of a company name when they sit on the
// boundary of the extracted chain. German fact texts often begin with
// "Ab Mai uebernimmt die X GmbH..." or "Die X GmbH..." — without this
// filter we'd extract "Ab Mai" or "Die" as part of the name.
const STOP_PREFIX = new Set([
  "Ab", "Im", "Am", "Vom", "Seit", "Auf", "An", "In", "Bis",
  "Vor", "Nach", "Mit", "Ohne", "Von", "Zu", "Wegen", "Trotz",
  "Die", "Der", "Das", "Den", "Dem", "Des", "Ein", "Eine", "Einen", "Einer",
  "Hallo", "Sehr", "Liebe", "Lieber", "Guten",
]);

const LEGAL_SUFFIX_RE = /\b(GmbH|AG|UG|GbR|KG|OHG|e\.V\.|SE)\b/u;

/**
 * Pull the provider name out of a Service-providers candidate fact.
 *
 * Strategy 1, preferred: find a legal form keyword (GmbH, AG, etc.) and
 * walk backwards to grab the capitalized chain leading up to it.
 *
 * Strategy 2, fallback: leading capitalized phrase, skipping common
 * German prepositions and requiring at least one substantive word.
 *
 * Returns null if no plausible name can be lifted out.
 */
export function extractContractorName(fact: string): string | null {
  const trimmed = fact
    .replace(/^[-*]\s+/, "")
    .replace(/^(?:EH|EIG|MIE|DL|HAUS)-\d+\s*:\s*/i, "")
    .trim();
  if (!trimmed) return null;

  const legal = LEGAL_SUFFIX_RE.exec(trimmed);
  if (legal) {
    const before = trimmed.slice(0, legal.index).trim();
    const tokens = before.split(/\s+/);
    const tail: string[] = [];
    for (let j = tokens.length - 1; j >= 0; j--) {
      const t = stripTrailingPunct(tokens[j]);
      if (!t) break;
      if (/[.,:;!?]$/.test(tokens[j]) && j !== tokens.length - 1) break;
      if (!/^[A-ZÄÖÜ]/.test(t)) break;
      if (STOP_PREFIX.has(t)) break;
      tail.unshift(t);
    }
    if (tail.length && tail.some((t) => t.length >= 3)) {
      return `${tail.join(" ")} ${legal[0]}`.replace(/\s+/g, " ").trim();
    }
  }

  const tokens = trimmed.split(/\s+/);
  const out: string[] = [];
  let started = false;
  for (const raw of tokens.slice(0, 6)) {
    const t = stripTrailingPunct(raw);
    if (!t) break;
    if (!started) {
      if (STOP_PREFIX.has(t)) continue;
      if (!/^[A-ZÄÖÜ]/.test(t)) break;
      started = true;
    } else if (!/^[A-ZÄÖÜ]/.test(t) && t !== "&" && !/^Co\.?$/.test(t)) {
      break;
    }
    out.push(t);
    if (/[.,:;!?]$/.test(raw)) break;
  }
  if (!out.length) return null;
  if (!out.some((t) => t.length >= 4)) return null;
  const name = out.join(" ").replace(/[,.;:]+$/, "").trim();
  if (name.length < 3) return null;
  return name;
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[.,:;!?]+$/, "");
}

/**
 * Build a CandidateFact for a Tavily enrichment, ready to feed into the gate.
 * Lands under "External context" so it stays separate from the
 * structured "Service providers" block.
 */
export function buildEnrichmentCandidate(
  providerName: string,
  enrichment: ContractorEnrichment
): CandidateFact {
  // If the summary already mentions the provider name, use it verbatim so
  // the line reads as a natural sentence ("Apleona HSG Berlin GmbH is a
  // facility management..."). Otherwise prepend the name with a colon so
  // the dedup check has a stable anchor.
  const summary = enrichment.summary.trim();
  const fact = summary.toLowerCase().includes(providerName.toLowerCase())
    ? summary
    : `${providerName}: ${summary}`;
  return {
    section: "External context",
    fact,
    confidence: 0.85,
    snippet: enrichment.url,
  };
}

/**
 * True if the property markdown already has a Tavily-actor line that
 * mentions this provider name. Used to avoid re-enriching a contractor
 * the engine already has public context on.
 */
export function alreadyEnriched(markdown: string, providerName: string): boolean {
  if (!markdown) return false;
  const needle = providerName.toLowerCase();
  for (const line of markdown.split("\n")) {
    if (line.includes("actor: tavily") && line.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

function condenseSummary(text: string, maxLen: number = 220): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 1).replace(/\s+\S*$/, "") + "...";
}
