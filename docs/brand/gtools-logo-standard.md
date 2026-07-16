# GTools Logo Standard (v1, locked)

This is the production standard for the 11 GTools suite marks. It is locked — do not
deviate from the geometry, palette, or letter rules below without updating this doc first.

## Construction geometry

`viewBox="0 0 48 48"`, four layers, back to front:

1. **Outline echo** — `rect x="9.5" y="11.5" width="31" height="31" rx="10.5"`, `fill="none"`,
   `stroke=<tool color>`, `stroke-width="1.8"`, `opacity="0.55"`,
   `transform="translate(-3.4, 3.4)"`.
2. **Tile** — the same rect geometry, `fill=<tool color>`. Built as a single path with
   `fill-rule="evenodd"` that includes a circular cutout, center `(40.5, 11.5)` radius `6`,
   so the tile is a genuine hole — whatever sits behind the mark shows through, not a
   hardcoded background color. This keeps the SVG context-independent (works on any
   background, not just one page color).
3. **Dot punch** — `circle cx="40.5" cy="11.5" r="3.6"` `fill=<tool color>`, drawn on top,
   centered inside the tile's cutout.
4. **Letter(s)** — Manrope ExtraBold (weight 800), white, optically centered at `(25, 27.2)`.
   - Single letter: `font-size 23`.
   - Double letters (`PT`, `PH`): `font-size 19`, `letter-spacing -1.2`.
   - **Converted to paths.** Production SVGs never depend on an installed font or a
     `<text>` element — glyph outlines are extracted from the Manrope woff2 with fontTools
     and baked in as `<path>` data, positioned to match the optical position/scale of the
     equivalent `<text>` rendering.

## Background note (the hole, not a fill hack)

Earlier drafts punched the hole by painting a second circle in the page's background
color. That breaks the moment the mark sits on a different background. The locked
approach is a **true hole**: the tile is one `evenodd` path with the r6 cutout baked into
its geometry, so it's transparent there regardless of what's behind it. The echo stroke
passing under the dot area is unaffected — it sits behind the tile and is fine as-is.

## Palette (11 tools)

| Tool | Letter(s) | Hex |
|---|---|---|
| TriageIT | T | `#A61B1B` |
| RunIT | R | `#B45309` |
| QuoteIT | Q | `#E05800` |
| LootIT | L | `#D6337E` |
| PortalIT | PT | `#4C1D95` |
| AccountIT | A | `#A21CAF` |
| PhoneIT | PH | `#0E7490` |
| ProjectIT | P | `#0E3A5C` |
| ConnectIT | C | `#2364C7` |
| SecureIT | S | `#0B0F14` (special case, see below) |
| VendIT | V | `#0B9668` |

## Letter rules

- Default: a single flagship letter (first letter of the product name).
- Collision rule: when two or more tools would land on the same letter, the flagship
  product keeps the single letter and the others get a **CAPITAL two-letter**
  abbreviation instead. In this set, ProjectIT is the flagship for "P" and keeps `P`;
  PortalIT and PhoneIT both collide with it, so they take `PT` and `PH` respectively
  (smaller font-size + tightened letter-spacing to fit two glyphs in the same tile).

## SecureIT special case

SecureIT's tool color is `#0B0F14` — effectively black. On the dark GTools ground, a
black-filled tile has no visible edge. Two targeted fixes, nothing else changes:

- The **tile** additionally gets a 1px inner stroke, `#64748B` at 45% opacity, so its
  boundary reads against a dark page.
- The **echo** stroke uses `#64748B` (same 0.55 opacity as every other mark) instead of
  the invisible black.

The tile fill stays `#0B0F14` and the dot punch stays the tool color — only the echo
stroke color and the tile's added inner stroke change.

## Wordmark rule (site chrome, not the mark itself)

Where a tool name is rendered as a wordmark in site chrome (header chips, suite grid
card titles, section kickers, at minimum):

- Font: Sora Bold (700), loaded via `next/font/google`, exposed as the
  `--font-wordmark` CSS variable.
- Two-tone split: the product **name** renders in white (dark theme) / near-black (light
  theme) — the page's default text color — and the trailing **"IT"** renders in the
  tool's **wordmark tint**, not its locked logo hex directly.
- **Tint vs. locked hex — the rule:** the locked palette hex (see table above) is for
  **surfaces/tiles** — logo chips, borders, glows, dots — where enough area and
  neighboring contrast keep it readable even when dark. It is **not** safe as small TEXT
  color directly on the site's `#08080d` ground: `#0E3A5C` (ProjectIT), `#4C1D95`
  (PortalIT), `#0B0F14` (SecureIT), `#0E7490` (PhoneIT), and `#A61B1B` (TriageIT) all read
  as near-invisible or badly-low-contrast as glyph color at wordmark sizes. Each tool
  gets a paired `--color-<slug>-tint` token in `globals.css` — the same hue as its locked
  accent, lifted roughly +25-40% lightness by eye until the "IT" reads clearly on dark.
  `ToolWordmark` (`tool-wordmark.tsx`) applies the tint via `tintVar(slug)`; the locked
  hex (`accentVar(slug)`) stays in use for every non-text surface (card hover borders,
  section accent washes/dots, the logo SVGs themselves).
- Example: "Triage" in white + "IT" in the TriageIT tint (`#E05555`), not the locked
  `#A61B1B` tile color.
- Body copy that merely references a tool name in a sentence is unaffected — this
  treatment is for wordmark-style headings/labels, not prose.

## Do

- Keep the tile as one `evenodd` path with the baked-in r6 cutout — a true hole.
- Keep the echo behind the tile, offset `(-3.4, 3.4)`, opacity `0.55`.
- Use the exact hex values from the palette table above (including the SecureIT
  exception for site accent tokens — see `globals.css`).
- Convert every letter to paths for production; never ship a `<text>` element.
- Keep `viewBox="0 0 48 48"` on every mark so they drop in at any size.
- Keep SecureIT's inner tile stroke and echo override — they're the only per-mark
  exceptions in this system.
- Use the locked hex (`accentVar`) for tiles/surfaces/glows; use the paired tint
  (`tintVar`, `--color-<slug>-tint`) for any text color rendered directly on the dark
  page ground — see "Wordmark rule" above.

## Don't

- Don't use `<text>`, `@font-face`, or any script in a production logo SVG.
- Don't rely on a system font being present — glyphs are pre-converted paths.
- Don't color wordmark/text directly with a locked logo hex on a dark ground — several
  (ProjectIT, PortalIT, SecureIT, PhoneIT, TriageIT) are illegible as text color; use the
  tint token instead.
- Don't simulate the punch hole with a background-color circle — it must be a real
  cutout via `fill-rule="evenodd"`.
- Don't recolor SecureIT's tile fill to "fix" contrast — the fix is the added stroke,
  not a different fill.
- Don't stretch or non-uniformly scale a mark — scale x/y together.
- Don't drop the echo's opacity, offset, or stroke-width when adapting a mark.
