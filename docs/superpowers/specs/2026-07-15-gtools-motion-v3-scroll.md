# gtools.io Motion v3 — Scroll-Driven "Everything Connects"

**Date:** 2026-07-15 · **Status:** Approved by Aniel (full build, new deps approved)

Builds on motion v1 (reveals/loops) and FX round 2 (spotlight/tilt/reticle/easter egg). Goal: award-site feel — scrolling continuously drives animation; the page reads as one connected piece.

## New dependencies (approved)
`gsap` (+ ScrollTrigger plugin) and `lenis` — added to apps/gtools only. All usage client-side, mount-gated, SSR-safe.

## Effects
1. **Lenis smooth scroll** — inertia scrolling wired to GSAP ScrollTrigger's scroller proxy (single rAF loop driving both). Anchor links still work (Lenis scrollTo). Disabled under reduced motion and on coarse pointers (native scroll there).
2. **Hero assembly** — the 11 tool logos float scattered/drifting around the hero (replacing/augmenting the static chip row). As the user scrolls the hero out, a scrubbed timeline converges them toward the suite grid's position before they hand off (fade into the grid cards' logos as the grid reveals). Headline scales down/fades slightly on scrub. Must be seamless at any scroll speed and reversible (scrub, not play-once).
3. **Scroll-scrubbed parallax** — backdrop grid/orbs move at depth ratios; each ToolSection's mockup gets a subtle scrub-linked translateY/rotate differential vs its copy column; marquee's base CSS loop gets a velocity multiplier from Lenis scroll velocity (clamped).
4. **ConnectIT diagram assembly** — connector hairlines draw in (scaleY/scaleX scrub, transform-based — not SVG strokes since diagram is divs), junction dots pop, chips dock (small translate+fade), radar ring fires once fully assembled. Scrubbed with the section's progress.
5. **Cursor depth** — background layers (grid, orbs) shift a few px toward the cursor (parallax-by-mouse via existing shared pointer store), composing with the spotlight.
6. **Scroll progress beam** — thin fixed accent gradient beam (right edge) filling with document progress + nav link of the active section gets its tool-accent underline (ScrollTrigger sections).

## Maximalist additions (Aniel: "show-off website — the more elements the better")
7. **Orbiting hero logos** — the hero's scattered logos slowly orbit on a subtle 3D ring (CSS 3D transforms) while idle; the scroll scrub (effect 2) grabs them from orbit and converges them into the grid.
8. **Ghost section numerals** — huge translucent outlined numerals (01–11, font-display) parallax behind each tool section at a different scroll depth.
9. **Decrypt kickers** — each section's uppercase kicker scrambles through glyphs and resolves to the tool name as it enters (once; instant text under reduced motion; server HTML carries the real text).
10. **Count-up stats strip** — a slim strip (between better-together and the first tool section) with scrub-triggered count-ups: "11 products · 25+ integrations · 1 stack" style (numbers from TOOLS data where possible — tools count derived, integrations = unique count across TOOLS, "1 stack" literal).
11. **Terminal boot line** — small monospace line under the hero subhead that types "gtools os — 11 systems online" with a blinking block cursor (types once on load; static under reduced motion).

## Constraints
- All prior ground rules stand: transform/opacity only (beam fill via scaleY), reduced-motion fully inert (static page, everything visible), coarse-pointer inert for mouse/scroll-jack effects (native scroll + reveal-once fallback remains), no copy changes, mockup internals untouched, no hydration mismatch (server HTML unchanged), CSS/TSX files <300 lines, no permanent will-change.
- Progressive fallback: if GSAP/Lenis fail to init, v1 reveal-once behavior must still work (don't remove it — layer scrub on top).
- Perf: one Lenis rAF; ScrollTriggers use scrub (no per-frame JS listeners beyond GSAP's own); kill all triggers/instances on unmount; no layout thrash (batch reads).
- Easter egg, reticle, spotlight, tilt all keep working alongside.

## Verification
Gates green (test/lint/build; CSS+component files <300 lines). Playwright prod build: scroll to multiple positions and screenshot (hero mid-scrub, grid handoff, ConnectIT mid-assembly, progress beam near bottom); assert 11 sections, anchor nav still lands correctly with Lenis, no console errors, 390px no overflow; reduced-motion emulation → static page all visible; touch emulation → native scroll, sections still appear.

## Delivery
Commit → review → push → Railway auto-deploy. PR #24 picks it up.
