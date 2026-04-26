/**
 * Custom hover popover. Lighter than Obsidian's HoverPopover (which is for
 * file previews). Shows formatted key/value content on mouseenter, hides on
 * mouseleave or scroll.
 *
 * Important: this is a global singleton popover. The previous version kept
 * one popover per trigger element, which meant fast mouse moves between rows
 * could leave two popovers alive briefly and they visually overlapped. That
 * is exactly what broke the Change history hover in the screenshot.
 */
export interface HoverField {
  label: string;
  value: string;
  mono?: boolean;
}

let activePopover: HTMLElement | null = null;
let activeHideTimer: number | null = null;

export interface HoverPreview {
  load: () => Promise<string>;
  title?: string;
}

export function attachHoverPopover(
  trigger: HTMLElement,
  buildFields: () => HoverField[],
  preview?: HoverPreview
) {
  const clearHideTimer = () => {
    if (activeHideTimer !== null) {
      window.clearTimeout(activeHideTimer);
      activeHideTimer = null;
    }
  };

  const hide = () => {
    clearHideTimer();
    activePopover?.remove();
    activePopover = null;
  };

  const scheduleHide = () => {
    clearHideTimer();
    activeHideTimer = window.setTimeout(hide, 120);
  };

  const show = () => {
    hide();
    const fields = buildFields();
    const pop = document.createElement("div");
    pop.className = "buena-popover";

    for (const f of fields) {
      const row = pop.createDiv({ cls: "buena-popover-row" });
      row.createDiv({ text: f.label, cls: "buena-popover-label" });
      row.createDiv({
        text: f.value,
        cls: "buena-popover-value" + (f.mono ? " buena-popover-mono" : ""),
      });
    }

    if (preview) {
      const previewBlock = pop.createDiv({ cls: "buena-popover-preview" });
      if (preview.title) {
        previewBlock.createDiv({ text: preview.title, cls: "buena-popover-preview-title" });
      }
      const body = previewBlock.createDiv({
        text: "Loading…",
        cls: "buena-popover-preview-body",
      });
      pop.addClass("buena-popover-has-preview");
      const myPop = pop;
      preview
        .load()
        .then((text) => {
          if (activePopover !== myPop) return;
          body.setText(text || "(empty)");
          position(myPop, trigger);
        })
        .catch((err) => {
          if (activePopover !== myPop) return;
          body.setText(`Couldn't load source: ${err?.message ?? err}`);
          body.addClass("buena-popover-preview-error");
        });
    }

    pop.addEventListener("mouseenter", clearHideTimer);
    pop.addEventListener("mouseleave", scheduleHide);

    document.body.appendChild(pop);
    position(pop, trigger);
    activePopover = pop;
  };

  trigger.addEventListener("mouseenter", show);
  trigger.addEventListener("mouseleave", scheduleHide);
  trigger.addEventListener("click", show);
  window.addEventListener("scroll", hide, true);
}

function position(pop: HTMLElement, trigger: HTMLElement) {
  const rect = trigger.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  const margin = 8;
  let top = rect.bottom + margin;
  let left = rect.left;

  // If overflows bottom, place above.
  if (top + popRect.height > window.innerHeight - margin) {
    top = rect.top - popRect.height - margin;
  }
  // If still above viewport, clamp inside.
  if (top < margin) top = margin;
  // If overflows right, push left.
  if (left + popRect.width > window.innerWidth - margin) {
    left = window.innerWidth - popRect.width - margin;
  }
  if (left < margin) left = margin;

  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}
