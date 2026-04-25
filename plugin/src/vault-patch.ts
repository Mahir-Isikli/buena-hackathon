import { App, MarkdownView, TFile } from "obsidian";

export interface ApplyPatchSpec {
  id: string;
  target_heading: string; // e.g. "## ⚠️ Active issues"
  new_block: string; // multi-line markdown to insert under that heading
}

/**
 * Apply a pending patch to a markdown file:
 *   1. Insert `new_block` under `target_heading` (right after the heading).
 *   2. Remove the `buena-pending` codeblock that owns this id.
 *   3. Save via vault.modify (triggers re-render).
 *   4. Reveal the inserted block in the editor.
 *
 * Returns the line number where new_block was inserted, or null if heading
 * could not be found.
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

  // 2. Find insertion point: right after the heading, skipping a single blank line.
  let insertAt = headingIdx + 1;
  if (lines[insertAt] === "") insertAt += 1;

  // 3. Build new content: insert new_block, then a blank line for spacing.
  const blockLines = spec.new_block.replace(/\n+$/, "").split("\n");
  const insertion = [...blockLines, ""];
  const withInsertion = [
    ...lines.slice(0, insertAt),
    ...insertion,
    ...lines.slice(insertAt),
  ];

  // 4. Remove the buena-pending block whose `id:` matches spec.id.
  const cleaned = removePendingBlock(withInsertion, spec.id);

  await app.vault.modify(file, cleaned.join("\n"));
  return insertAt;
}

/**
 * Remove the fenced ```buena-pending block that contains `id: <patchId>`.
 * Whitespace-tolerant on the id line.
 */
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
 * Open the file in the active leaf (or focus an existing view) and scroll
 * to the given line.
 */
export async function revealLineInActiveView(
  app: App,
  filePath: string,
  line: number
) {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;

  let view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view || view.file?.path !== file.path) {
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    view = app.workspace.getActiveViewOfType(MarkdownView);
  }
  if (!view) return;

  const editor = view.editor;
  editor.setCursor({ line, ch: 0 });
  editor.scrollIntoView(
    { from: { line, ch: 0 }, to: { line, ch: 0 } },
    /* center */ true
  );
}
