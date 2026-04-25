# Buena Style Guide (Extracted from buena.com)

This style guide was extracted directly from the compiled Next.js CSS on Buena's brand website (`buena.com/en`). It reflects their current production design system.

## Typography
Buena uses a mix of sharp sans-serifs for UI and modern serif for editorial/display accents.
- **Primary Sans:** `Inter`
- **Secondary Sans:** `Inter Tight`, `Inter Display Medium`
- **Display/Serif:** `Signifier`

## Brand Colors
The brand relies on a highly constrained palette of warm stones, deep blacks, and a signature forest green.

- **Brand Green:** `#0d7835` (used for buttons, accents, and hovered states)
- **Primary Background (Dark):** `#010105` (near black, highly polished)
- **Secondary Background (Dark):** `#171717`
- **Primary Background (Light):** `#fafaf9` (warm stone-like white)
- **Secondary Background (Light):** `#e7e5e4`

## Category/Domain Colors
Specific product domains at Buena have dedicated pastel/muted color tags:
- **WEG (Homeowners' Association):** `#d6dbd5` (Sage / light gray-green)
- **Mietverwaltung (Rental Management):** `#cdbda3` (Warm beige)

## Structure & Geometry
- **Radii:** Soft but structured (`1rem` for 2xl, `0.75rem` for xl, `0.5rem` for lg).
- **Shadows:** Very subtle alpha black (`0 10px 15px -3px #0000001a`), avoiding harsh drops.
- **Borders:** Thin and low contrast (`#d6d3d1`, `1px solid #44403c`).

## Motion & Interaction
- **Easing:** `cubic-bezier(.4, 0, .2, 1)` (classic ease-in-out, highly fluid).
- **Durations:** Swift but visible transitions ranging from `0.15s` to `0.5s`.
- **States:** Hover states often rely on opacity shifts (e.g., `#0d7835cc` to `#0d7835e5`) or swapping out outline colors rather than drastic background changes.
