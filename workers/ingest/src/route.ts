/**
 * Deterministic routing hints for the ingest worker.
 *
 * Priority:
 * 1. Property subaddress on the recipient, e.g. property+LIE-001@kontext.haus
 * 2. Sender / recipient email join against stammdaten-derived EMAIL_HINTS
 * 3. Unit alias scan in subject + body, e.g. WE 29 / EH-029 / TG 18
 * 4. Fallback to the demo property LIE-001
 *
 * This gives us the hackathon-safe path from AGENTS.md:
 * deterministic lookup first, Gemini only for the ambiguous remainder.
 */

import { EMAIL_HINTS, type EmailHint, UNIT_ALIASES } from "./stammdaten-map";

const DEFAULT_PROPERTY = "LIE-001";
const SUBADDRESS_RE = /\+([A-Z0-9_-]{2,})@/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export interface RoutingHints {
  propertyId: string;
  unitId?: string;
  matches: EmailHint[];
  matchedEmails: string[];
  routingHint?: string;
}

export interface RoutingDecision {
  propertyId: string;
  preferredUnit?: string;
  matches: EmailHint[];
  matchedEmails: string[];
  via: "subaddress" | "participants" | "fallback";
  routingHint?: string;
}

export function resolvePropertyId(to: string): string {
  return resolveRoutingHints({ to }).propertyId;
}

export function resolveRouting(inputFrom?: string, inputTo?: string, subject?: string, body?: string): RoutingDecision {
  const hints = resolveRoutingHints({ from: inputFrom, to: inputTo, subject, body });
  const hasSub = !!parsePropertySubaddress(inputTo);
  const via: RoutingDecision["via"] = hasSub
    ? "subaddress"
    : hints.matches.length
      ? "participants"
      : "fallback";
  return {
    propertyId: hints.propertyId,
    preferredUnit: hints.unitId,
    matches: hints.matches,
    matchedEmails: hints.matchedEmails,
    via,
    routingHint: hints.routingHint,
  };
}

export function routingHintText(routing: RoutingDecision): string | undefined {
  return routing.routingHint;
}

export function resolveRoutingHints(input: {
  to?: string;
  from?: string;
  subject?: string;
  body?: string;
}): RoutingHints {
  const propertyId = parsePropertySubaddress(input.to) ?? DEFAULT_PROPERTY;

  const seenEmails = new Set<string>();
  const matchedEmails: string[] = [];
  const matches: EmailHint[] = [];
  for (const email of [...extractEmails(input.from), ...extractEmails(input.to)]) {
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);
    const hit = EMAIL_HINTS[email];
    if (!hit?.length) continue;
    matchedEmails.push(email);
    matches.push(...hit);
  }

  const emailUnitCandidates = new Set<string>();
  for (const match of matches) {
    if (match.unitIds.length === 1) {
      emailUnitCandidates.add(match.unitIds[0]);
    }
  }

  const text = `${input.subject ?? ""}\n${input.body ?? ""}`;
  const textUnit = detectUnitFromText(text);

  let unitId: string | undefined;
  if (textUnit && (emailUnitCandidates.size === 0 || emailUnitCandidates.has(textUnit))) {
    unitId = textUnit;
  } else if (emailUnitCandidates.size === 1) {
    unitId = [...emailUnitCandidates][0];
  }

  const hintLines: string[] = [];
  const sub = parsePropertySubaddress(input.to);
  if (sub) hintLines.push(`- Property subaddress: ${sub}`);
  if (matchedEmails.length) {
    hintLines.push(`- Matched participant emails: ${matchedEmails.join(", ")}`);
    for (const match of matches) {
      const unitTxt = match.unitIds.length ? ` | units: ${match.unitIds.join(", ")}` : "";
      hintLines.push(`  - ${match.kind} ${match.id}${unitTxt}`);
    }
  }
  if (textUnit) hintLines.push(`- Unit alias detected in subject/body: ${textUnit}`);
  if (unitId) hintLines.push(`- Preferred unit hint: ${unitId}`);

  return {
    propertyId: matches[0]?.propertyId ?? propertyId,
    unitId,
    matches,
    matchedEmails,
    routingHint: hintLines.length ? hintLines.join("\n") : undefined,
  };
}

function parsePropertySubaddress(to?: string): string | null {
  const m = SUBADDRESS_RE.exec(to ?? "");
  return m ? m[1].toUpperCase() : null;
}

function extractEmails(input?: string): string[] {
  const found = (input ?? "").match(EMAIL_RE) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()))];
}

function detectUnitFromText(text: string): string | undefined {
  const hay = normalize(text);
  for (const item of UNIT_ALIASES) {
    for (const alias of item.aliases) {
      const needle = normalize(alias);
      if (!needle) continue;
      if (hay.includes(needle)) return item.unitId;
    }
  }
  return undefined;
}

function normalize(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
