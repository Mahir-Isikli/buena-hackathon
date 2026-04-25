/**
 * Patch gate: turn Gemini candidates into PendingPatch objects.
 *
 * Thin slice for now: every candidate above the confidence floor becomes a
 * pending patch (review queue). Auto-apply lives in a later iteration once
 * the renderer + state.json are in place. The full 7 rules in AGENTS.md will
 * be wired then.
 */

import type { CandidateFact } from "./gemini";
import type { PendingPatch } from "./vaults";

const CONFIDENCE_FLOOR = 0.6;

export interface BuildPatchInput {
  msgId: string;
  source: string; // e.g. r2://buena-raw/emails/<msgId>.eml
  candidates: CandidateFact[];
  receivedAt: string;
}

export function buildPendingPatches(input: BuildPatchInput): PendingPatch[] {
  const out: PendingPatch[] = [];
  let i = 0;
  for (const c of input.candidates) {
    if (c.confidence < CONFIDENCE_FLOOR) continue;
    const id = `${input.msgId}-${i++}`;
    const target_heading =
      c.unit && c.section === "Units" ? `### ${c.unit}` : `## ${c.section}`;
    const new_block = `- ${c.fact}`;
    out.push({
      id,
      section: c.section,
      unit: c.unit,
      new: c.fact,
      source: input.source,
      snippet: c.snippet,
      confidence: c.confidence,
      actor: "gemini-3-pro",
      target_heading,
      new_block,
      addedAt: input.receivedAt,
    });
  }
  return out;
}
