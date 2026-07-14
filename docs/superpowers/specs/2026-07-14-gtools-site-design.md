# gtools.io — Promotional Site Design

**Date:** 2026-07-14
**Status:** Approved by Aniel (via brainstorming session)

## Purpose

A promotional showcase site at **gtools.io** presenting Gamma Tech Services' 8-tool
"IT" suite the way a vendor would sell it. Audience: Gamma Tech's clients and
prospects — a credibility play showing the in-house engineering that powers the MSP.
No lead-capture forms; the only CTA is `mailto:help@gamma.tech`.

## Scope

- **Tools showcased (8):** TriageIt, SecureIT, ProjectIT, PortalIT, QuoteIT,
  ConnectIT, RunIT, PhoneIT. (`vendit`, `meeting-tracker`, `QBO Automation`,
  `Budget Planner`, and `followit` are excluded.)
- **Single page** (v1). Content is structured so per-tool pages can be added later
  without restructuring.
- **Stylized CSS mockups**, not real screenshots — with swap-in slots for real
  screenshots later.

## Architecture

- **`apps/gtools`** — new workspace app in the TriageIt monorepo.
  - Next.js 16 (canary, matching `apps/web`), React 19, Tailwind 4, TypeScript.
  - Fully statically generated: no database, no auth, no API routes, no env vars.
  - Dev port: 3002 (web=3000; avoid collisions).
- **Content as data:** all per-tool copy in one typed module,
  `apps/gtools/src/content/tools.ts`. Each tool entry: `slug`, `name`, `tagline`,
  `description`, `features[]` (3–4), `accent` (color token), `integrations[]`,
  `mockup` (component key), optional `screenshotSrc` (replaces the CSS mockup when
  set). Layout code never contains copy.
- **Components:** `Nav`, `Hero`, `SuiteGrid`, `BetterTogether`, `ToolSection`
  (alternating layout), `BrowserFrame` (shared chrome + accent glow), one small
  mockup component per tool, `Footer`.

## Page Structure (top to bottom)

1. **Nav** — GTOOLS wordmark, per-tool anchor links, "Contact us" button
   (`mailto:help@gamma.tech`).
2. **Hero** — dark premium: headline angle *"The software we built to run our
   MSP."* — these aren't off-the-shelf products; Gamma Tech engineered its own
   stack. Subtle glow, 8-tool badge strip.
3. **Suite grid** — 8 cards (icon, name, one-liner); click scrolls to the tool's
   section.
4. **"Better together" strip** — the ConnectIT hub story: one integration layer
   feeding QuoteIT, PortalIT, and ProjectIT, with HaloPSA / M365 / Datto /
   JumpCloud at the base.
5. **8 tool sections** — alternating left/right. Each: tool name + accent,
   tagline, 3–4 verified features, CSS browser-frame mockup of its signature
   screen:
   - **TriageIt** — AI triage note on a ticket (classification, urgency, findings)
   - **SecureIT** — AI incident report (attack narrative + one-click remediation)
   - **ProjectIT** — project task board with timeline
   - **PortalIT** — billing-reconciliation dashboard (invoice vs usage)
   - **QuoteIT** — quote builder with e-sign status
   - **ConnectIT** — sync dashboard (connector status, sync runs)
   - **RunIT** — tool grid dashboard (AutoDoc, migrations, TextIT)
   - **PhoneIT** — bulk CSV lookup results table
6. **Footer** — Gamma Tech Services LLC, Naples FL, gamma.tech link, contact
   email.

## Visual Direction

Dark, premium tech (Linear/Vercel register): near-black background, one sharp
shared brand accent plus a per-tool accent for section glows and mockup chrome,
high-contrast typography, generous spacing. Mockups pop against the dark ground.

## Honest-Copy Guardrails

- ConnectIT: only HaloPSA and Twilio Lookup connectors are live — frame the other
  12 as an "expanding connector catalog," never as shipped.
- PhoneIT: copy inferred from the CNAM-Lookup lineage (no readable repo) — flag
  for Aniel's review before ship.
- No unverified claims (e.g., QuoteIT online payment collection, PortalIT Stripe
  billing depth, RunIT's untested migration sources presented as batteries-included).

## Testing & Verification

Pragmatic for a static page:
- Content-integrity unit test: exactly 8 tools, unique slugs, all required fields
  non-empty, every suite-grid anchor resolves to a section id.
- `next build` and `eslint` green via turbo.
- Local Playwright smoke render (page loads, all 8 sections present) before PR.

## Deployment

- New **"gtools" service** in the existing **TriageIT Railway project**, building
  from this monorepo (`turbo build --filter=gtools`, `next start`).
- Domain: **apex `gtools.io` only — no `www`** (per Aniel). DNS is Cloudflare;
  the apex and www currently do not resolve, and `view.quoteit.gtools.io` already
  exists on this zone.
- Delivery: branch → draft PR. Railway service + domain attach after merge (or
  earlier for preview if requested).

## Out of Scope (v1)

- Per-tool detail pages, lead-capture forms, analytics, real screenshots, CMS.
