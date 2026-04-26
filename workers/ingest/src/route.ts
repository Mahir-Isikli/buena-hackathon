/**
 * Deterministic routing hints for the ingest worker.
 *
 * Priority:
 * 1. Property subaddress on the recipient, e.g. property+LIE-001@kontext.haus
 * 2. Sender / recipient email join against D1 (owners.email, tenants.email,
 *    service_providers.email). Emails found inside the body or in extracted
 *    attachment text (forwarded .eml inner From, CSV cells, plain-text PDF
 *    surfaces) are joined too.
 * 3. Unit alias scan in subject + body, e.g. WE 29 / EH-029 / TG 18, against
 *    the units table in D1.
 * 4. Fallback to the demo property LIE-001
 *
 * Hackathon-safe path from AGENTS.md: deterministic lookup first, Gemini
 * only for the ambiguous remainder. Used to read from a generated static
 * map; now reads from D1 so adding a property no longer needs a redeploy.
 */

import { lookupEmailHints, listUnitAliases, type EmailHint } from "./erp";

export type { EmailHint };

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

export async function resolveRouting(
  db: D1Database,
  inputFrom?: string,
  inputTo?: string,
  subject?: string,
  body?: string,
  extraEmails?: string[]
): Promise<RoutingDecision> {
  const hints = await resolveRoutingHints(db, {
    from: inputFrom,
    to: inputTo,
    subject,
    body,
    extraEmails,
  });
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

export async function resolveRoutingHints(
  db: D1Database,
  input: {
    to?: string;
    from?: string;
    subject?: string;
    body?: string;
    extraEmails?: string[];
  }
): Promise<RoutingHints> {
  const propertyId = parsePropertySubaddress(input.to) ?? DEFAULT_PROPERTY;

  const headerPool = [...extractEmails(input.from), ...extractEmails(input.to)];
  const extraPool = (input.extraEmails ?? []).map((e) => e.toLowerCase());
  const allEmails = [...new Set([...headerPool, ...extraPool])];

  const hintsByEmail = await lookupEmailHints(db, allEmails);

  const seenEmails = new Set<string>();
  const matchedEmails: string[] = [];
  const matchedFromExtras: string[] = [];
  const matches: EmailHint[] = [];
  for (const email of headerPool) {
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);
    const hit = hintsByEmail[email];
    if (!hit?.length) continue;
    matchedEmails.push(email);
    matches.push(...hit);
  }
  for (const email of extraPool) {
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);
    const hit = hintsByEmail[email];
    if (!hit?.length) continue;
    matchedEmails.push(email);
    matchedFromExtras.push(email);
    matches.push(...hit);
  }

  const emailUnitCandidates = new Set<string>();
  for (const match of matches) {
    if (match.unitIds.length === 1) emailUnitCandidates.add(match.unitIds[0]);
  }

  const text = `${input.subject ?? ""}\n${input.body ?? ""}`;
  const textUnit = await detectUnitFromText(db, text);

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
    if (matchedFromExtras.length) {
      hintLines.push(`  - Of those, found in body/attachment text: ${matchedFromExtras.join(", ")}`);
    }
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

/** Public helper: pull all email-shaped tokens out of arbitrary text. */
export function scanEmailsFromText(input?: string): string[] {
  return extractEmails(input);
}

async function detectUnitFromText(
  db: D1Database,
  text: string
): Promise<string | undefined> {
  const hay = normalize(text);
  if (!hay) return undefined;
  const aliases = await listUnitAliases(db);
  for (const item of aliases) {
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
