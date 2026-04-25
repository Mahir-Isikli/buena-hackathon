/**
 * Property routing.
 *
 * Cheap path: parse the subaddress on the `to` header (e.g.
 * "property+LIE-001@kontext.haus") -> "LIE-001". This skips an LLM call
 * when the routing was already done at the email-address level.
 *
 * Fallback: until we have a real ERP-backed router, default to LIE-001
 * (the demo property). Replace this with a Gemini classifier once we
 * have more than one property.
 */

const DEFAULT_PROPERTY = "LIE-001";
const SUBADDRESS_RE = /\+([A-Z0-9_-]{2,})@/i;

export function resolvePropertyId(to: string): string {
  const m = SUBADDRESS_RE.exec(to ?? "");
  if (m) return m[1].toUpperCase();
  return DEFAULT_PROPERTY;
}
