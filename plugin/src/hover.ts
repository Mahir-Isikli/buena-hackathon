/**
 * Custom hover popover. Lighter than Obsidian's HoverPopover (which is for
 * file previews). Shows formatted key/value content on mouseenter, hides on
 * mouseleave or scroll.
 */
export interface HoverField {
  label: string;
  value: string;
  mono?: boolean;
}

export function attachHoverPopover(
  trigger: HTMLElement,
  buildFields: () => HoverField[]
) {
  let pop: HTMLElement | null = null;
  let timer: number | null = null;

  const show = () => {
    hide();
    const fields = buildFields();
    pop = document.createElement("div");
    pop.className = "buena-popover";

    for (const f of fields) {
      const row = pop.createDiv({ cls: "buena-popover-row" });
      row.createDiv({ text: f.label, cls: "buena-popover-label" });
      const val = row.createDiv({
        text: f.value,
        cls: "buena-popover-value" + (f.mono ? " buena-popover-mono" : ""),
      });
      void val;
    }

    document.body.appendChild(pop);
    position(pop, trigger);
  };

  const hide = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    pop?.remove();
    pop = null;
  };

  const scheduleHide = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(hide, 120);
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

  // If overflows bottom, place above
  if (top + popRect.height > window.innerHeight - margin) {
    top = rect.top - popRect.height - margin;
  }
  // If overflows right, push left
  if (left + popRect.width > window.innerWidth - margin) {
    left = window.innerWidth - popRect.width - margin;
  }
  if (left < margin) left = margin;

  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}
