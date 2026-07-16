# gtools.io Interactive Mockups

**Date:** 2026-07-16 · **Status:** Approved by Aniel ("let me click on accounts etc but not deeper than that and i want that on every tool")

## Goal
Every tool's BrowserFrame preview becomes a shallow interactive demo: hovering shows a normal pointer cursor and the mockup's REAL top-level navigation (tabs/sidebar/nav items, per each app's actual code) is clickable, switching the frame content between 2–4 mini views of that app. One level deep only — nothing inside a view is further clickable (inner elements stay inert, default cursor).

## Rules
- Views/tab labels come from each tool's real UI spec (`.superpowers/sdd/ui-specs/*.md`) — real nav labels, plausible screens per the research (secondary views may be simpler than the signature screen but must look native to that app).
- Mockups become client components (supersedes the earlier server-only rule for mockups ONLY); tab state is local useState; active view switch is instant with a subtle crossfade (transform/opacity, reduced-motion = instant swap).
- Clickable elements: pointer cursor, hover tint, aria-pressed/aria-label; everything else in the frame keeps default cursor and does nothing.
- Clicks never navigate/scroll the page and never interfere with page FX (reticle may still render; asteroid layer unaffected).
- Demo data stays Office-universe; NO real customers.
- Per-tool views (from specs): TriageIt (Tickets list / Ticket detail / SLA Hunter), SecureIT (Incidents / Tenants / Reporting), ProjectIT (Tasks / Dashboard / Stock), PortalIT client portal (Services / Invoices / Support), LootIT (Dashboard / KB / Settings), QuoteIT (Quote Builder / Quotes / Dashboard), AccountIT (Dashboard / Accounts / Pipeline), ConnectIT (Dashboard / Sync Runs / Customers), RunIT (Dashboard / Tools / TextIT), PhoneIT (Bulk CSV / Single Lookup / History), VendIT (Buy page / Storefront / Sales admin).
- Structure: mockups may split into `mockups/<slug>/` folders (index + views) to respect <300-line files; MOCKUPS registry API unchanged.
- SSR-safe: initial view renders server-side markup-compatible (default view = current signature screen); hydration adds interactivity.

## Verification
Gates green; Playwright: per 3 sample tools — hover shows pointer on a tab, click switches view (assert content change), click a non-tab element does nothing, page doesn't scroll/navigate; reduced-motion + mobile fine (tabs still tappable on touch — interactivity IS allowed on touch since it's tap-based); zero console errors.

## Delivery
Commit → review → push (auto-deploys). PR #24 rides along.
