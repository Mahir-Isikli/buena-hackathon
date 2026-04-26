import { App, MarkdownView, TFile } from "obsidian";

export interface ApplyPatchSpec {
  id: string;
  target_heading: string; // e.g. "## ⚠️ Active issues"
  new_block: string; // multi-line markdown to insert under that heading
  old_value?: string;
}

/**
 * Apply a pending patch to a markdown file:
 *   1. If `old_value` matches a line in the target section, replace it in place.
 *   2. Otherwise insert `new_block` under `target_heading`.
 *   3. Remove the `buena-pending` codeblock that owns this id.
 *   4. Save via vault.modify (triggers re-render).
 *
 * Returns the line number where new_block was inserted or replaced, or null if
 * the heading could not be found.
 */
export async function applyPatchToVault(
  app: App,
  filePath: string,
  spec: ApplyPatchSpec
): Promise<number | null> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) {
    console.warn("[Buena] not a TFile:", filePath);
    return null;
  }

  const original = await app.vault.read(file);
  const lines = original.split("\n");

  // 1. Find target heading
  const headingIdx = lines.findIndex((l) => l.trim() === spec.target_heading.trim());
  if (headingIdx === -1) {
    console.warn(
      "[Buena] target_heading not found:",
      spec.target_heading,
      "in",
      filePath
    );
    return null;
  }

  const blockLines = spec.new_block.replace(/\n+$/, "").split("\n");
  const replaceIdx = spec.old_value
    ? findReplaceLineIndex(
        lines,
        headingIdx,
        spec.target_heading,
        spec.old_value,
        extractScopeId(spec.new_block)
      )
    : -1;

  const nextLines =
    replaceIdx >= 0
      ? [
          ...lines.slice(0, replaceIdx),
          ...blockLines,
          ...lines.slice(replaceIdx + 1),
        ]
      : insertBlockAfterHeading(lines, headingIdx, blockLines);

  // 4. Remove the buena-pending block whose `id:` matches spec.id.
  const cleaned = removePendingBlock(nextLines, spec.id);

  await app.vault.modify(file, cleaned.join("\n"));
  return replaceIdx >= 0 ? replaceIdx : findInsertLine(headingIdx, lines);
}

/**
 * Remove the fenced ```buena-pending block that contains `id: <patchId>`.
 * Whitespace-tolerant on the id line.
 */
function insertBlockAfterHeading(lines: string[], headingIdx: number, blockLines: string[]): string[] {
  const insertAt = findInsertLine(headingIdx, lines);
  return [
    ...lines.slice(0, insertAt),
    ...blockLines,
    "",
    ...lines.slice(insertAt),
  ];
}

function findInsertLine(headingIdx: number, lines: string[]): number {
  let insertAt = headingIdx + 1;
  if (lines[insertAt] === "") insertAt += 1;
  return insertAt;
}

function findReplaceLineIndex(
  lines: string[],
  headingIdx: number,
  heading: string,
  oldValue: string,
  scopeHint?: string | null
): number {
  const wanted = normalizeComparableLine(oldValue);
  if (!wanted) return -1;

  const level = heading.trim().startsWith("###") ? 3 : 2;
  let inCode = false;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inCode = !inCode;
      continue;
    }
    if (!inCode && isSectionBoundary(trimmed, level)) break;
    if (!trimmed) continue;
    const existingScope = extractScopeId(line);
    if (scopeHint && existingScope && existingScope !== scopeHint) continue;
    const existing = normalizeComparableLine(line);
    if (!existing) continue;
    if (existing === wanted || existing.includes(wanted) || wanted.includes(existing)) {
      return i;
    }
  }
  return -1;
}

function extractScopeId(text: string): string | null {
  const match = /\b(?:eh|eig|mie|dl|haus)-\d+\b/i.exec(text);
  return match ? match[0].toUpperCase() : null;
}

function isSectionBoundary(trimmed: string, currentLevel: number): boolean {
  if (!/^#{2,3}\s+/.test(trimmed)) return false;
  const level = trimmed.startsWith("###") ? 3 : 2;
  return level <= currentLevel;
}

function normalizeComparableLine(line: string): string {
  return line
    .replace(/\{prov:[^}]+\}/g, "")
    .replace(/\{changed:[^}]+\}/g, "")
    .replace(/\^\[[^\]]+\]/g, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^(?:eh|eig|mie|dl|haus)-\d+\s*:\s*/i, "")
    .replace(/`/g, "")
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}\s%./:-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function removePendingBlock(lines: string[], patchId: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```buena-pending\s*$/.test(line)) {
      // Lookahead: find closing fence
      let j = i + 1;
      let foundId = false;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        if (lines[j].trim().startsWith("id:")) {
          const idValue = lines[j].split(":").slice(1).join(":").trim();
          if (idValue === patchId) foundId = true;
        }
        j += 1;
      }
      if (foundId) {
        // Skip the fence + body + closing fence.
        i = j + 1;
        // Also drop one trailing blank line if present, to avoid stacking.
        if (out.length && out[out.length - 1] === "" && lines[i] === "") {
          i += 1;
        }
        continue;
      }
    }
    out.push(line);
    i += 1;
  }
  return out;
}

/**
 * Strip a buena-pending block by id without inserting anything. Used by reject.
 */
export function stripPendingBlockById(text: string, patchId: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```buena-pending\s*$/.test(line)) {
      let j = i + 1;
      let foundId = false;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        if (lines[j].trim().startsWith("id:")) {
          const v = lines[j].split(":").slice(1).join(":").trim();
          if (v === patchId) foundId = true;
        }
        j += 1;
      }
      if (foundId) {
        i = j + 1;
        if (out.length && out[out.length - 1] === "" && lines[i] === "") i += 1;
        continue;
      }
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n");
}

export interface ParsedPendingBlock {
  raw: string;
  yaml: Record<string, unknown>;
}

/**
 * Find every fenced ```buena-pending``` block in the given markdown text.
 * Returns the inner YAML source for each block so callers can parse it.
 */
export function findPendingBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (/^```buena-pending\s*$/.test(lines[i])) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        body.push(lines[j]);
        j += 1;
      }
      blocks.push(body.join("\n"));
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return blocks;
}

/**
 * Find the line index of a given heading (e.g. "## Open issues") in the
 * file. Returns null if the heading is not present. Used by the
 * "Go to section" pill on pending cards: when the heading does not exist
 * the pill is hidden because there is nowhere to jump.
 */
export async function findHeadingLine(
  app: App,
  filePath: string,
  heading: string
): Promise<number | null> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return null;
  const text = await app.vault.read(file);
  const lines = text.split("\n");
  const target = heading.trim();
  const targetNorm = normalizeHeading(target);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === target) return i;
    if (/^#{1,6}\s+/.test(line) && normalizeHeading(line) === targetNorm) {
      return i;
    }
  }
  return null;
}

/**
 * Reverse a previously-applied change: strip its content from the markdown
 * (best-effort) and re-emit a buena-pending block at the bottom of the
 * file so it returns to the queue. Returns true when a re-queue block was
 * appended.
 *
 * The strip step is line-based and conservative: we only delete a line if
 * it matches `new_block` exactly. If the line was edited by a human after
 * approval, we leave it alone and just re-queue.
 */
export async function reverseHistoryEntry(
  app: App,
  filePath: string,
  entry: {
    id: string;
    section: string;
    unit?: string;
    newValue: string;
    source?: string;
    actor: string;
    originalBlock?: {
      target_heading?: string;
      new_block?: string;
      confidence?: number;
      snippet?: string;
    };
  }
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return false;

  const text = await app.vault.read(file);
  const lines = text.split("\n");

  // 1. Best-effort strip of the originally-inserted block.
  const block = entry.originalBlock?.new_block ?? "";
  const blockLines = block.replace(/\n+$/, "").split("\n").filter((l) => l !== "");
  let stripped = lines;
  if (blockLines.length > 0) {
    // Find a contiguous run of lines that matches blockLines exactly.
    outer: for (let i = 0; i <= lines.length - blockLines.length; i++) {
      for (let j = 0; j < blockLines.length; j++) {
        if (lines[i + j] !== blockLines[j]) continue outer;
      }
      stripped = [
        ...lines.slice(0, i),
        ...lines.slice(i + blockLines.length),
      ];
      break;
    }
  }

  // 2. Append a buena-pending block so the entry returns to the queue.
  const yaml = [
    "```buena-pending",
    `id: ${entry.id}-reversed`,
    `section: ${entry.section}`,
    entry.unit ? `unit: ${entry.unit}` : null,
    `new: ${jsonString(entry.newValue)}`,
    entry.source ? `source: ${entry.source}` : null,
    entry.originalBlock?.snippet
      ? `snippet: ${jsonString(entry.originalBlock.snippet)}`
      : null,
    typeof entry.originalBlock?.confidence === "number"
      ? `confidence: ${entry.originalBlock.confidence}`
      : null,
    `actor: ${entry.actor}`,
    `reversed: true`,
    entry.originalBlock?.target_heading
      ? `target_heading: ${jsonString(entry.originalBlock.target_heading)}`
      : null,
    entry.originalBlock?.new_block
      ? `new_block: ${jsonString(entry.originalBlock.new_block)}`
      : null,
    "```",
    "",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const trailing = stripped[stripped.length - 1] === "" ? "" : "\n";
  await app.vault.modify(file, stripped.join("\n") + trailing + yaml);
  return true;
}

function jsonString(s: string): string {
  return JSON.stringify(s);
}

function normalizeHeading(s: string): string {
  return s
    .replace(/^#{1,6}\s+/, "")
    .replace(/[`*_]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Reveal a line of `filePath` in a markdown leaf. Works whether the click
 * originated from the sidebar (where `getActiveViewOfType(MarkdownView)`
 * returns null) or from the editor itself, and works in both Reading and
 * Edit modes.
 *
 * Strategy:
 *   1. Prefer an existing markdown leaf already showing the file.
 *   2. Fall back to any markdown leaf and load the file there.
 *   3. Fall back to opening a new tab in the main (root) area.
 *
 * Using `getLeaf(false)` directly is wrong when called from the sidebar:
 * the active leaf is the sidebar pane itself, which can't host markdown.
 */
export async function revealLineInActiveView(
  app: App,
  filePath: string,
  line: number
) {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;

  const mdLeaves = app.workspace.getLeavesOfType("markdown");
  let target = mdLeaves.find((leaf) => {
    const v = leaf.view;
    return v instanceof MarkdownView && v.file?.path === file.path;
  });

  if (!target) {
    target = mdLeaves[0] ?? app.workspace.getLeaf("tab");
    await target.openFile(file);
  }

  app.workspace.setActiveLeaf(target, { focus: true });

  const view = target.view;
  if (!(view instanceof MarkdownView)) return;

  // Works for both Reading and Live Preview / Edit modes.
  view.setEphemeralState({ line, scroll: line });

  // Belt-and-braces: drive the editor too, so Edit mode places the cursor
  // and re-centers if the user is already there.
  try {
    const editor = view.editor;
    editor.setCursor({ line, ch: 0 });
    editor.scrollIntoView(
      { from: { line, ch: 0 }, to: { line, ch: 0 } },
      /* center */ true
    );
  } catch {
    /* editor methods are no-ops in Reading mode */
  }
}
