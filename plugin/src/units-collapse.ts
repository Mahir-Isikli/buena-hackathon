import type BuenaPlugin from "../main";

/**
 * Adds a simple collapse / expand affordance to each HAUS section under Units.
 * We keep it lightweight: the h3 becomes clickable and toggles the next
 * rendered unit table wrapper.
 */
export function registerUnitsCollapseProcessor(plugin: BuenaPlugin) {
  plugin.registerMarkdownPostProcessor((el) => {
    const headings = Array.from(el.querySelectorAll("h3"));
    for (const heading of headings) {
      const text = (heading.textContent ?? "").trim();
      if (!/HAUS-\d+/i.test(text)) continue;
      const next = heading.nextElementSibling as HTMLElement | null;
      if (!next || !next.classList.contains("buena-erp-units-table-wrap")) continue;
      if (heading.querySelector(".buena-units-toggle")) continue;

      heading.classList.add("buena-units-heading");
      next.classList.add("buena-units-collapsible");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "buena-units-toggle";
      btn.textContent = "Collapse";
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const collapsed = next.classList.toggle("buena-units-collapsed");
        heading.classList.toggle("buena-units-heading-collapsed", collapsed);
        btn.textContent = collapsed ? "Expand" : "Collapse";
      });
      heading.appendChild(btn);
    }
  });
}
