# GTools Brand Guidelines (v2, locked)

Production standard for the 11 GTools suite marks and wordmarks. Locked — do not deviate
from geometry, palette, letterform, or wordmark rules without updating this doc first.

## 1. Construction

`viewBox="0 0 48 48"`. Four layers, built back to front, in this exact order:

1. **Outline echo** — `rect x="9.5" y="11.5" width="31" height="31" rx="10.5"`,
   `fill="none"`, `stroke=<tool color>`, `stroke-width="1.8"`, `opacity="0.55"`,
   `transform="translate(-3.4, 3.4)"`.
2. **Tile** — same rect geometry, `fill=<tool color>`. A single path with
   `fill-rule="evenodd"` that bakes in a circular cutout, center `(40.5, 11.5)`,
   radius `6` — a genuine hole, not a background-color hack. Whatever sits behind the
   mark shows through, so the SVG is context-independent (works on any background).
3. **Dot punch** — `circle cx="40.5" cy="11.5" r="3.6"`, `fill=<tool color>`, drawn on
   top, centered inside the tile's cutout.
4. **Letter(s)** — Manrope ExtraBold (weight 800), converted to paths, white,
   optically centered at `(25, 27)`.
   - Single letter: `font-size 23`.
   - Double letters (`PT`, `PH`): `font-size 19`, `letter-spacing -1.2`.
   - Never ship a `<text>` element or depend on an installed font — glyph outlines are
     extracted from the Manrope woff2 with fontTools and baked in as `<path>` data,
     positioned to match the optical position/scale of the equivalent `<text>` render.

Build order matters: echo first (it sits behind and peeks out at the offset corner),
then tile, then dot, then letter paths on top. Never reorder.

## 2. Color system

Two color roles per tool, not one:

- **Locked hex** — for surfaces and tiles: logo chips, tile fills, borders, glows, the
  dot punch, the echo stroke. These are saturated/deep and read fine at icon scale with
  neighboring contrast.
- **Wordmark tint** — for text on the dark site ground (`#08080d`). Same hue as the
  locked hex, lifted roughly +25-40% lightness by eye until it reads clearly as small
  glyph color on dark. Never use the locked hex directly as text color on dark — several
  are near-invisible or badly low-contrast at that weight/size.

| Tool | Letter(s) | Locked hex | Wordmark tint |
|---|---|---|---|
| TriageIT | T | `#A61B1B` | `#E05555` |
| RunIT | R | `#B45309` | `#E8973D` |
| QuoteIT | Q | `#E05800` | `#FF8A4C` |
| LootIT | L | `#D6337E` | `#F073AC` |
| PortalIT | PT | `#4C1D95` | `#8B5CF6` |
| AccountIT | A | `#A21CAF` | `#E066F5` |
| PhoneIT | PH | `#0E7490` | `#3FC3DE` |
| ProjectIT | P | `#0E3A5C` | `#4E8FBF` |
| ConnectIT | C | `#2364C7` | `#6DA3EE` |
| SecureIT | S | `#0B0F14` (special case, §3) | `#94A3B8` |
| VendIT | V | `#0B9668` | `#3FD69B` |

Each tool's tint lives as `--color-<slug>-tint` in `globals.css`. Locked hex lives as
`--color-<slug>` (`accentVar(slug)`); tint is `tintVar(slug)`. `ToolWordmark`
(`tool-wordmark.tsx`) always applies the tint to text and the locked hex to every
non-text surface (tile fills, dot, echo stroke, card hover borders, section accent
washes/dots, the logo SVGs themselves). Body copy that merely mentions a tool name in a
sentence is unaffected — the tint rule is for wordmark-style headings/labels, not prose.

## 3. SecureIT exception

SecureIT's tool color, `#0B0F14`, is effectively black. On the dark GTools ground, a
black-filled tile has no visible edge. Two targeted fixes, nothing else changes:

- The **tile** additionally gets a 1px inner stroke, `#64748B` (slate) at 45% opacity,
  so its boundary reads against a dark page.
- The **echo** stroke uses `#64748B` (same 0.55 opacity as every other mark) instead of
  the invisible black.

The tile fill stays `#0B0F14` and the dot punch stays the tool color — only the echo
stroke color and the tile's added inner stroke change. Don't recolor the tile fill to
"fix" contrast; the fix is the added stroke, never a different fill.

## 4. Letterforms

- Source: Manrope ExtraBold (800), glyph outlines extracted with fontTools and baked
  into the SVG as `<path>` data — never a live `<text>` element or an installed-font
  dependency.
- Color: white, always, regardless of tile color (SecureIT included).
- Position: optically centered at `(25, 27)` inside the 48x48 viewBox.
- Size: `font-size 23` for a single letter; `font-size 19` with `letter-spacing -1.2`
  for a two-letter capital mark (`PT`, `PH`) so both glyphs fit inside the same tile
  without crowding the rounded corners.
- **Collision rule**: default is one flagship letter, the first letter of the product
  name. When two or more tools would land on the same first letter, the flagship
  product (the earliest-established or most prominent of the colliding set) keeps the
  single letter; the others take a **CAPITAL two-letter** abbreviation instead, sized
  per the double-letter rule above. Precedent in this set: ProjectIT is flagship for
  "P" and keeps `P`; PortalIT and PhoneIT both collide with it, so they take `PT` and
  `PH` respectively. Apply the same precedent to any future collision — flagship never
  moves off its single letter for a newcomer.

## 5. Wordmarks

Where a tool name renders as a wordmark in site chrome (header chips, suite grid card
titles, section kickers, at minimum):

- Font: **Sora Bold (700)**, loaded via `next/font/google`, exposed as the
  `--font-wordmark` CSS variable. No other weight, no other family, ever, in a
  production wordmark.
- Two-tone split: the product **name** renders in the page's default text color, and
  the trailing **"IT"** renders in the tool's wordmark tint (§2), never its locked hex.
  - Dark ground: name in `#f4f4f7`, "IT" in the tool's tint.
  - Light ground: name in `#17171e`, "IT" in the tool's **locked hex** (on light
    backgrounds the locked hex has enough contrast to read as text; the tint exists
    specifically to solve the dark-ground problem, so light ground uses the richer
    locked color instead).
- Example (dark ground): "Triage" in `#f4f4f7` + "IT" in `#E05555` (TriageIT tint) —
  never the locked `#A61B1B` as glyph color on dark.
- Body copy that merely references a tool name in a sentence is unaffected — this
  treatment is for wordmark-style headings/labels, not prose.

## 6. Lockups

Two approved variants; choose by context, never mix elements from both:

1. **Mark + wordmark, horizontal** — the 48x48 mark at left, wordmark baseline-aligned
   to the mark's vertical center, single row. Use in horizontal chrome: page headers,
   nav bars, footer credits, anywhere width is available and height is constrained.
2. **Mark + wordmark, stacked** — mark centered above the wordmark, mark first. Use in
   constrained-width / card-like contexts: suite grid tiles, mobile headers, share
   cards, anywhere a tall-narrow footprint reads better than wide-short.

Both variants use the same mark geometry (§1) and the same wordmark rule (§5) — only
the axis and alignment differ. Don't invent a third arrangement (e.g., wordmark left of
mark, or mark below wordmark) without updating this doc.

## 7. Clear space & minimum sizes

- **Clear space**: maintain at minimum the punched-ring diameter (the dot punch's
  visual footprint, `r=3.6` circle plus its `r=6` cutout ring — treat as a ~12px
  diameter exclusion zone) between the mark's outer echo edge and any other UI element,
  text, or a second mark. Scale proportionally at larger sizes.
- **Minimum sizes**:
  - Mark alone: **16px** rendered footprint. Below this the echo offset and dot punch
    stop reading as distinct layers — don't ship smaller.
  - Lockup (mark + wordmark, either variant): **24px** height minimum. Below this the
    wordmark becomes illegible before the mark does.

## 8. Approved backgrounds & contrast

- Approved grounds: the site's dark ground `#08080d`, pure white/near-white light
  surfaces, and any neutral surface with sufficient luminance contrast against both the
  tile's locked hex and (where present) the wordmark tint/text color.
- Every tile must clear WCAG-equivalent contrast against its background at the tile
  edge (echo + optional SecureIT inner stroke are the fallback when the tile color
  itself is too close to the background, e.g. SecureIT on dark).
- Don't place a mark or wordmark on a busy photographic background, a gradient that
  crosses multiple hues under the mark, or a mid-tone gray ground that fails contrast
  against both a light and a dark variant simultaneously — pick the on-dark or
  on-light asset that actually contrasts, never force one variant onto a background it
  wasn't built for.

## 9. Don't

- Don't recolor a tile, echo, or dot to anything outside the locked hex table (SecureIT's
  documented stroke exception in §3 is the only per-mark deviation permitted).
- Don't stretch or non-uniformly scale a mark — scale x/y together, always.
- Don't rotate a mark or wordmark at any angle.
- Don't drop the echo — its opacity (`0.55`), offset (`-3.4, 3.4`), or stroke-width
  (`1.8`) are fixed; don't thin it, hide it, or reposition it "to declutter."
- Don't move the dot punch off `(40.5, 11.5)` or resize it off `r=3.6` — it must stay
  centered inside the tile's `r=6` cutout.
- Don't resurrect legacy/pre-v1 logo files — only assets under the locations in §11 are
  current; anything else in old design exports or email attachments is retired.
- Don't render a wordmark in any font other than Sora Bold 700 — no system-font
  fallback rendering in production, no italics, no alternate weights.
- Don't place a mark or wordmark on a mid-tone or busy/photographic background — see §8.

## 10. Minting a new tool's mark (futureproof recipe)

Follow in order when a 12th (or later) GTools product needs a mark:

1. **Pick an unclaimed hue** at the family's existing vibrancy/saturation band — sample
   the locked-hex column in §2 for the range (roughly `#0B..` to `#E0..` in lightness,
   fully saturated, no pastels, no near-white/near-black except the documented SecureIT
   exception) and choose a hue not already in use.
2. **Apply the letter rule** (§4): try the product's first letter. If it's unclaimed,
   that's the mark. If it collides with an existing flagship, this new tool is the
   newcomer — it takes a CAPITAL two-letter abbreviation, never the flagship's letter.
3. **Build the construction** (§1) exactly: same viewBox, same four-layer order, same
   echo/tile/dot geometry, only letter and hex change (plus SecureIT-style stroke
   overrides only if the new hex is similarly near-black).
4. **Derive the tint** (§2): take the new locked hex, lift lightness +25-40% by eye
   until "IT" reads clearly as small text on `#08080d`. Add it to `globals.css` as
   `--color-<slug>-tint` alongside `--color-<slug>`.
5. **Build both lockups** (§6): horizontal and stacked, using the new mark + the Sora
   wordmark rule (§5).
6. **Export PNGs** at `16, 24, 32, 48, 64, 128, 256, 512` px for the mark alone, and
   `128, 256, 512, 1024` px for each lockup variant, both on-dark and on-light, plus a
   transparent-background master SVG for each. Match the folder shape in §11.

## 11. Asset locations

- **Repo source of truth (this document + rules)**: `docs/brand/gtools-logo-standard.md`.
- **Repo production SVGs (what the app actually imports)**:
  `apps/gtools/public/logos/<slug>.svg` — one file per tool, lowercase slug
  (e.g. `triageit.svg`), mark only, transparent hole per §1.
- **Design source / export masters**: `~/Documents/GTools Brand/`, one folder per tool
  using the tool's display name (e.g. `TriageIt/`, `PhoneIT/`), each containing:
  - `<slug>-mark.svg` — the mark alone.
  - `<slug>-lockup-dark-bg.svg` / `<slug>-lockup-light-bg.svg` — both lockup variants
    (§6), pre-composed for each ground.
  - `transparent/` — transparent-background exports (SVG/PNG) of the mark and both
    lockups, background-agnostic masters.
  - `on-dark/` — PNG exports pre-composed against the dark ground, all sizes from §10
    step 6.
  - `on-light/` — PNG exports pre-composed against a light ground, same size set.
  - `palette.txt` at the `GTools Brand/` root carries the full hex + tint table (§2)
    for design-tool reference outside the codebase.

---
v2, 2026-07-16. Supersedes v1. Changes from v1: added full color-system write-up with
wordmark tints and the light-ground "IT" rule, formalized the two lockup variants and
when to use each, added clear-space/minimum-size specs, approved-backgrounds/contrast
guidance, an expanded Don'ts list, a numbered recipe for minting future tools' marks,
and documented asset locations across the repo and the design-source folder.
