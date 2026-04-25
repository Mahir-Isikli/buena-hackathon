import type BuenaPlugin from "../main";

/**
 * Adds a simple collapse / expand affordance to each HAUS section under Unit index.
 * Works with both the old rich unit renderer and plain markdown tables.
 */
export function registerUnitsCollapseProcessor(plugin: BuenaPlugin) {
  plugin.registerMarkdownPostProcessor((el) => {
    const headings = Array.from(el.querySelectorAll("h3"));
    for (const heading of headings) {
      const text = (heading.textContent ?? "").trim();
      if (!/HAUS-\d+/i.test(text)) continue;

      const next = heading.nextElementSibling as HTMLElement | null;
      const target = resolveCollapsibleTarget(next);
      if (!target) continue;
      if (heading.querySelector(".buena-units-toggle")) continue;

      heading.classList.add("buena-units-heading");
      target.classList.add("buena-units-collapsible");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "buena-units-toggle";
      btn.textContent = "Collapse";
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const collapsed = target.classList.toggle("buena-units-collapsed");
        heading.classList.toggle("buena-units-heading-collapsed", collapsed);
        btn.textContent = collapsed ? "Expand" : "Collapse";
      });
      heading.appendChild(btn);
    }
  });
}

function resolveCollapsibleTarget(next: HTMLElement | null): HTMLElement | null {
  if (!next) return null;
  if (next.classList.contains("buena-erp-units-table-wrap")) return next;
  if (next.tagName === "TABLE") return next;
  return null;
}
