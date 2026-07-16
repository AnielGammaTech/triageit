# gtools.io "Command Center" Motion Design

**Date:** 2026-07-14 · **Status:** Approved by Aniel (intensity: "Full sci-fi command center")

## Goal
Make the live gtools.io page feel very animated, cool, and futuristic — a sci-fi command center — without hurting performance, accessibility, or the existing content/copy.

## Tech approach
Hand-rolled: exactly one `"use client"` component (`Reveal`, IntersectionObserver-based, reveal-once) plus pure CSS keyframes/utilities in `globals.css`. No animation libraries. All animation is `transform`/`opacity` only. `prefers-reduced-motion: reduce` disables every loop and reveal with content fully visible (no hidden-by-default states that never reveal).

## Effects
1. **Living backdrop** (`components/fx/backdrop.tsx`, server, fixed full-viewport, aria-hidden, behind all content): perspective grid floor fading toward a horizon, 2–3 drifting brand-color glow orbs (slow transform loops), faint twinkling star specks, subtle noise. Must not introduce scrollbars or repaint storms.
2. **Hero entrance**: staggered rise+fade of headline lines; gradient shimmer sweep across part of the headline; tool chips cascade in one-by-one; headline glow breathes (scale/opacity loop).
3. **Marquee** (`components/fx/marquee.tsx`, server, CSS-only infinite loop): band of the 8 tool wordmarks in their real accent colors (accentVar), duplicated track for seamless loop, pause on hover; placed between Hero and SuiteGrid.
4. **Scroll reveals** (`components/fx/reveal.tsx`, client): sections fade-up on enter; feature bullets stagger; mockup column slides in from its side with slight rotation; suite-grid cards cascade. Reveal once (no re-hide). Content must be visible without JS after a graceful timeout or via no-JS fallback (progressive enhancement: default visible when JS absent).
5. **Mockups alive**: idle float loop on BrowserFrame; periodic scan-line sweep overlay inside the frame; accent glow pulse; hover tilt (CSS only).
6. **ConnectIT diagram centerpiece**: small glowing dots travel along the existing connector hairlines (platforms → ConnectIT → suite) on a loop; radar-style pulsing ring on the ConnectIT node.
7. **Nav on scroll**: glowing bottom border + slight height/backdrop tighten once scrolled (CSS scroll-driven where cheap, else the Reveal client pattern or a `:has`/sticky trick; a second tiny client hook is acceptable ONLY if CSS can't do it).
8. **Constraints**: no copy/content changes; no layout shift (CLS ≈ 0); mockup internals unchanged; existing tests stay green; files <300 lines; server components except `reveal.tsx` (+ optional nav scroll hook); works in Chrome/Safari/Firefox.

## Verification
`npm test`, lint, `turbo build` green; Playwright: page loads with animations, all 8 sections still present, screenshots desktop/mobile reviewed; reduced-motion emulation check (content visible, loops off); no horizontal overflow at 390px.

## Delivery
Commit to `worktree-gtools-site`, push → Railway auto-deploys to gtools.io; PR #24 picks up the commits.
