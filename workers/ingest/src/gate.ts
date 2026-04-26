/**
 * Patch gate: implements the locked 7-rule policy from AGENTS.md.
 *
 * For each extracted candidate fact we decide one of:
 * - ignore   : below the hard confidence floor or exact duplicate
 * - pending  : human review queue
 * - auto     : safe to apply directly into property.md + history
 *
 * Rules encoded here:
 * 1. If the property doesn't resolve confidently -> out of scope upstream. This
 *    gate assumes a propertyId was already resolved.
 * 2. If section doesn't exist -> auto-apply (unless confidence < 0.85, rule 7).
 * 3. If section exists and fact is duplicate -> ignore.
 * 4. If section exists and fact is new -> auto-apply (unless confidence < 0.85).
 * 5. If section exists and fact contradicts existing content -> pending.
 * 6. If section is human-edited and fact would replace human-authored text -> pending.
 * 7. If confidence < 0.85 regardless -> pending.
 */

import type { CandidateFact } from "./gemini";
import {
  type HistoryEntry,
  type PendingPatch,
  type SenderInfo,
  type SourceMeta,
  type StateJson,
  appendPending,
  applyApprovedPatchToPropertyMd,
  readPropertyMd,
  readStateJson,
  writeHistory,
  writeStateJson,
} from "./vaults";

const CONFIDENCE_FLOOR = 0.6;
const REVIEW_THRESHOLD = 0.85;

export interface ApplyGateInput {
  bucket: R2Bucket;
  propertyId: string;
  patchBaseId: string;
  source: string;
  candidates: CandidateFact[];
  receivedAt: string;
  actor?: string;
  sender?: SenderInfo;
  sourceMeta?: SourceMeta;
}

export interface GateStats {
  ignored: number;
  pending: number;
  auto: number;
}

export async function applyPatchGate(input: ApplyGateInput): Promise<GateStats> {
  const actor = input.actor ?? "gemini-3-pro";
  let markdown = (await readPropertyMd(input.bucket, input.propertyId)) ?? "";
  let state = await readStateJson(input.bucket, input.propertyId);

  const stats: GateStats = { ignored: 0, pending: 0, auto: 0 };
  let i = 0;

  for (const candidate of input.candidates) {
    const decision = classifyCandidate(markdown, state, candidate);
    if (decision.kind === "ignore") {
      stats.ignored += 1;
      continue;
    }

    const patch = buildPatch({
      id: `${input.patchBaseId}-${i++}`,
      source: input.source,
      candidate,
      receivedAt: input.receivedAt,
      actor,
      targetHeading: decision.targetHeading,
      oldValue: decision.kind === "pending" ? decision.oldValue : undefined,
      sender: input.sender,
      sourceMeta: input.sourceMeta,
    });

    if (decision.kind === "pending") {
      await appendPending(input.bucket, input.propertyId, patch);
      stats.pending += 1;
      continue;
    }

    const appliedAt = input.receivedAt;
    const applied = await applyApprovedPatchToPropertyMd(
      input.bucket,
      input.propertyId,
      patch,
      appliedAt
    );

    await writeHistory(input.bucket, input.propertyId, {
      id: patch.id,
      section: patch.section,
      unit: patch.unit,
      oldValue: patch.old,
      newValue: patch.new,
      source: patch.source,
      decision: "auto",
      timestamp: appliedAt,
      actor,
      reason: applied.applied ? undefined : "target_heading_missing",
      sender: input.sender,
      sourceMeta: input.sourceMeta,
    } satisfies HistoryEntry);

    state = {
      ...(state ?? {}),
      property_id: input.propertyId,
      last_updated: appliedAt,
      human_edited_sections: state?.human_edited_sections ?? [],
    };
    await writeStateJson(input.bucket, input.propertyId, state);
    if (typeof applied.markdown === "string") {
      markdown = applied.markdown;
    }
    stats.auto += 1;
  }

  return stats;
}

type Decision =
  | { kind: "ignore"; reason: string }
  | { kind: "pending"; reason: string; targetHeading: string; oldValue?: string }
  | { kind: "auto"; reason: string; targetHeading: string };

function classifyCandidate(
  markdown: string,
  state: StateJson | null,
  candidate: CandidateFact
): Decision {
  if (candidate.confidence < CONFIDENCE_FLOOR) {
    return { kind: "ignore", reason: "below_floor" };
  }

  const headings = parseHeadings(markdown);
  const targetHeading = resolveTargetHeading(candidate, headings);

  // Rule 0: never patch ERP-snapshot sections. The body is a render-time
  // projection of D1; the canonical edit path is Postgres. Route to pending
  // so the user sees the misclassification, with a stable reason the UI can
  // present as "ERP master data, edit in Postgres".
  if (isErpSnapshotSection(markdown, targetHeading)) {
    return {
      kind: "pending",
      reason: "erp_snapshot_section",
      targetHeading,
    };
  }

  const section = getSectionSlice(markdown, targetHeading);
  const sectionExists = !!section;

  if (sectionExists) {
    const duplicate = section!.contentLines.find((line) => isDuplicateLine(line, candidate));
    if (duplicate) {
      return { kind: "ignore", reason: "duplicate" };
    }

    const conflict = section!.contentLines.find((line) => isPotentialConflict(line, candidate));
    const humanEdited = isHumanEditedSection(state, targetHeading, candidate.section);

    if (conflict && humanEdited) {
      return {
        kind: "pending",
        reason: "human_edited_conflict",
        targetHeading,
        oldValue: cleanLine(conflict),
      };
    }

    if (conflict) {
      return {
        kind: "pending",
        reason: "contradiction",
        targetHeading,
        oldValue: cleanLine(conflict),
      };
    }
  }

  if (candidate.confidence < REVIEW_THRESHOLD) {
    return {
      kind: "pending",
      reason: "below_review_threshold",
      targetHeading,
    };
  }

  if (!sectionExists) {
    return { kind: "auto", reason: "section_missing", targetHeading };
  }

  return { kind: "auto", reason: "new_fact", targetHeading };
}

function buildPatch(input: {
  id: string;
  source: string;
  candidate: CandidateFact;
  receivedAt: string;
  actor: string;
  targetHeading: string;
  oldValue?: string;
  sender?: SenderInfo;
  sourceMeta?: SourceMeta;
}): PendingPatch {
  return {
    id: input.id,
    section: input.candidate.section,
    unit: input.candidate.unit,
    old: input.oldValue,
    new: input.candidate.fact,
    source: input.source,
    snippet: input.candidate.snippet,
    confidence: input.candidate.confidence,
    actor: input.actor,
    target_heading: input.targetHeading,
    new_block: buildNewBlock(input.candidate),
    addedAt: input.receivedAt,
    sender: input.sender,
    sourceMeta: input.sourceMeta,
  };
}

function buildNewBlock(candidate: CandidateFact): string {
  // Make unit scope explicit in the rendered markdown, not only in history/UI.
  // This is especially important for auto-applied Open issues lines where the
  // user otherwise just sees "the resident" / "the unit" with no visible EH id.
  if (candidate.unit) {
    return `- ${candidate.unit}: ${candidate.fact}`;
  }
  return `- ${candidate.fact}`;
}

interface HeadingInfo {
  raw: string;
  level: number;
  label: string;
}

function parseHeadings(markdown: string): HeadingInfo[] {
  return markdown
    .split("\n")
    .filter((line) => /^#{2,3}\s+/.test(line.trim()))
    .map((raw) => {
      const m = /^(#{2,3})\s+(.+)$/.exec(raw.trim())!;
      return {
        raw: raw.trim(),
        level: m[1].length,
        label: normalizeSectionName(m[2]),
      };
    });
}

function resolveTargetHeading(candidate: CandidateFact, headings: HeadingInfo[]): string {
  const wanted = normalizeSectionAlias(candidate.section);

  // If the file already has a matching heading, use the real heading so emoji /
  // exact label differences do not break apply.
  const existing = headings.find((h) => h.level === 2 && normalizeSectionAlias(h.label) === wanted);
  if (existing) return existing.raw;

  // For units we currently store tribal-knowledge notes under the Units section
  // top-level block if no per-unit heading exists.
  if (wanted === "units") {
    const unitsHeading = headings.find((h) => h.level === 2 && normalizeSectionAlias(h.label) === "units");
    if (unitsHeading) return unitsHeading.raw;
  }

  // Fall back to a canonical plain heading. applyApprovedPatchToPropertyMd will
  // create it if it doesn't exist yet.
  return `## ${candidate.section}`;
}

function normalizeSectionAlias(section: string): string {
  const s = normalizeSectionName(section);
  if (s === "active issues") return "open issues";
  if (s === "assembly decisions") return "last assembly decisions";
  if (s === "mahnungen") return "active mahnungen";
  return s;
}

function getSectionSlice(
  markdown: string,
  heading: string
): { contentLines: string[] } | null {
  const lines = markdown.split("\n");
  const idx = lines.findIndex((l) => l.trim() === heading.trim());
  if (idx === -1) return null;
  const level = heading.trim().startsWith("###") ? 3 : 2;
  const out: string[] = [];
  let inCode = false;
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inCode = !inCode;
      continue;
    }
    if (!inCode && isSectionBoundary(trimmed, level)) break;
    if (!trimmed) continue;
    if (/^```buena-pending/.test(trimmed)) continue;
    out.push(line);
  }
  return { contentLines: out };
}

function isSectionBoundary(trimmed: string, currentLevel: number): boolean {
  if (!/^#{2,3}\s+/.test(trimmed)) return false;
  const level = trimmed.startsWith("###") ? 3 : 2;
  return level <= currentLevel;
}

function isDuplicateLine(line: string, candidate: CandidateFact): boolean {
  const existingScope = extractScopeId(line);
  const incomingScope = candidate.unit ?? extractScopeId(candidate.fact);
  if (existingScope && incomingScope && existingScope !== incomingScope) {
    return false;
  }

  const existing = normalizeLine(cleanLine(line));
  const incoming = normalizeLine(candidate.fact);
  if (!existing || !incoming) return false;
  if (existing === incoming || existing.includes(incoming) || incoming.includes(existing)) {
    return true;
  }

  const overlap = tokenOverlap(existing, incoming);
  if (overlap < 0.82) return false;

  const eEntities = extractEntities(existing);
  const iEntities = extractEntities(incoming);
  const sameDates = !arraysDiffer(eEntities.dates, iEntities.dates);
  const samePercentages = !arraysDiffer(eEntities.percentages, iEntities.percentages);
  const sameMoney = !arraysDiffer(eEntities.money, iEntities.money);
  const compatibleIds =
    !eEntities.ids.length ||
    !iEntities.ids.length ||
    !arraysDiffer(eEntities.ids, iEntities.ids);

  return sameDates && samePercentages && sameMoney && compatibleIds;
}

function isPotentialConflict(line: string, candidate: CandidateFact): boolean {
  const existingScope = extractScopeId(line);
  const incomingScope = candidate.unit ?? extractScopeId(candidate.fact);
  if (existingScope && incomingScope && existingScope !== incomingScope) {
    return false;
  }

  const existing = normalizeLine(cleanLine(line));
  const incoming = normalizeLine(candidate.fact);
  if (!existing || !incoming) return false;
  if (existing === incoming) return false;

  const overlap = tokenOverlap(existing, incoming);
  if (overlap < 0.45) return false;

  const eEntities = extractEntities(existing);
  const iEntities = extractEntities(incoming);
  const explicitValueDiff =
    arraysDiffer(eEntities.dates, iEntities.dates) ||
    arraysDiffer(eEntities.percentages, iEntities.percentages) ||
    arraysDiffer(eEntities.money, iEntities.money) ||
    arraysDiffer(eEntities.ids, iEntities.ids);

  const polarityDiff = hasNegation(existing) !== hasNegation(incoming);
  return explicitValueDiff || polarityDiff;
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common += 1;
  return common / Math.min(ta.size, tb.size);
}

function tokenize(s: string): string[] {
  return s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function extractEntities(s: string): {
  dates: string[];
  percentages: string[];
  money: string[];
  ids: string[];
} {
  return {
    dates: uniq(s.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g) ?? []),
    percentages: uniq(s.match(/\b\d+(?:[.,]\d+)?\s*(?:%|prozent)\b/gi) ?? []),
    money: uniq(s.match(/\b\d+(?:[.,]\d+)?\s*(?:eur|€)\b/gi) ?? []),
    ids: uniq(s.match(/\b(?:eh|eig|mie|dl)-\d+\b/gi) ?? []),
  };
}

function hasNegation(s: string): boolean {
  return /\b(no|not|kein|keine|ohne|nicht)\b/i.test(s);
}

function arraysDiffer(a: string[], b: string[]): boolean {
  if (!a.length && !b.length) return false;
  return a.join("|") !== b.join("|");
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function cleanLine(line: string): string {
  return line
    .replace(/\{prov:[^}]+\}/g, "")
    .replace(/\{changed:[^}]+\}/g, "")
    .replace(/\^\[[^\]]+\]/g, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^(?:eh|eig|mie|dl|haus)-\d+\s*:\s*/i, "")
    .replace(/`/g, "")
    .trim();
}

function extractScopeId(text: string): string | null {
  const match = /\b(?:eh|eig|mie|dl|haus)-\d+\b/i.exec(text);
  return match ? match[0].toUpperCase() : null;
}

function normalizeLine(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9.%€-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSectionName(s: string): string {
  return s
    .replace(/[`#*_]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isHumanEditedSection(
  state: StateJson | null,
  targetHeading: string,
  section: string
): boolean {
  const edited = new Set((state?.human_edited_sections ?? []).map((s) => normalizeSectionName(s)));
  return edited.has(normalizeSectionName(targetHeading)) || edited.has(normalizeSectionName(section));
}

/**
 * True if the section starting at `heading` is marked with
 * `<!-- erp:snapshot ... -->` somewhere between the heading and the next H2.
 * The marker is emitted by the renderer for ERP-derived projection sections.
 */
function isErpSnapshotSection(markdown: string, heading: string): boolean {
  const lines = markdown.split("\n");
  const idx = lines.findIndex((l) => l.trim() === heading.trim());
  if (idx === -1) return false;
  for (let i = idx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^##\s+/.test(trimmed)) return false;
    if (/<!--\s*erp:snapshot/i.test(trimmed)) return true;
  }
  return false;
}
