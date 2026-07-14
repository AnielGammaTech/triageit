# gtools.io FX Round 2 — Interactive & Quirky

**Date:** 2026-07-14 · **Status:** Approved by Aniel (selected all four effects)

Builds on the motion v1 spec (2026-07-14-gtools-motion-design.md). Same ground rules: transform/opacity animation, reduced-motion disables everything, progressive enhancement, no copy changes, no mockup-internal edits, files <300 lines, all new client components under `components/fx/`.

## Effects (all four approved)

1. **Mouse spotlight + grid reveal** (`fx/spotlight.tsx`, client): a fixed full-viewport layer; rAF-throttled pointermove writes `--mx`/`--my` CSS vars; a soft radial glow (~500px) follows the cursor and a brighter copy of the background grid is revealed through a radial mask around it. Desktop/fine pointers only.

2. **3D tilt mockups + magnetic buttons** (`fx/tilt.tsx` wrapper + `fx/magnetic.tsx`, client): BrowserFrames tilt toward the cursor (perspective rotateX/rotateY, clamped ~6°, springy return on leave) with a moving glare highlight overlay; the nav "Contact us" button and suite-grid cards translate a few px toward the cursor when it's near (magnetic pull, clamped, resets smoothly).

3. **Targeting reticle cursor + particle trail** (`fx/cursor.tsx`, client): default cursor hidden on fine-pointer devices only; a sci-fi crosshair/reticle lerps after the pointer, expands + changes tone over interactive elements (a[href], button); fast movement emits a capped pool (≤24) of small brand-colored spark particles that fade. Everything transform/opacity; text inputs unaffected (none exist).

4. **The Office easter egg** (`fx/easter-egg.tsx`, client): triggered by 3 clicks on the GTOOLS wordmark OR typing "bears" anywhere; for ~5s: confetti burst in the 8 tool accent colors + a centered toast cycling an Office-flavored ops quote (e.g. "I DECLARE… UPTIME!", "Bears. Beets. Battlestar Backups.", "You miss 100% of the tickets you don't triage."), then everything reverts. aria-live="polite" toast; reduced-motion gets toast only (no confetti).

## Constraints
- **Coarse pointers/touch**: spotlight, tilt, magnetic, and reticle are inert (feature-detect `(pointer: fine)`); easter egg works everywhere.
- **Reduced motion**: all four effects inert (toast-only easter egg).
- **Perf**: one shared pointermove listener where practical, rAF batched, no layout properties animated, particle pool recycled (no unbounded DOM growth), no lingering will-change residue.
- SSR-safe: all mount-gated; server HTML unchanged.

## Verification
Gates (test/lint/build) green; Playwright with real mouse.move: spotlight visible in screenshot, tilt visibly applied mid-hover, reticle present + expanded over CTA, easter egg fires on 3 logo clicks (screenshot) and reverts; reduced-motion + 390px mobile checks; no console errors.

## Delivery
Commit → push → Railway auto-deploy to gtools.io; PR #24 picks it up.
