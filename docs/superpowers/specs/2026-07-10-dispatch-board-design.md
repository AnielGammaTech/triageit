# Dispatch Board — Design

**Date:** 2026-07-10
**Status:** Approved by Aniel (approach A + two-way writes for TriageIT-created items)

## Problem

Bryanna (sole dispatcher) decides who gets each ticket with no system view of who
is actually working, on a call, onsite, in a meeting, or off. Schedules live in a
mix of Halo appointments and techs' Outlook calendars plus tribal knowledge.
TriageIT should show scheduling clearly, estimate who is available right now, and
recommend who to assign each ticket to — suggest-only, Bryanna assigns in Halo.

## Decisions on record

- **Surface:** new `/dispatch` page in the TriageIT web dashboard (primary).
- **AI role:** suggest-only ranking. No auto-assignment, no assign write-back.
- **Views:** live "Right Now" board + assignment helper, week grid below.
- **M365:** Graph app credentials available — Outlook calendars are phase 1.
- **Writes:** TriageIT-created schedule items write to BOTH Halo and the tech's
  Outlook calendar and stay linked for edit/delete. No mirroring of
  foreign items between Halo and Outlook (loop/dedup risk); Halo's native
  per-agent M365 sync covers that if enabled, and our writer carries a
  duplicate-guard for that case.
- **Skill fit:** Toby `tech_profiles` used as a light tiebreaker only —
  availability and load dominate the ranking.

## Architecture

```
Halo (appointments, agents)   3CX (active calls, extensions)   MS Graph (calendars)
        \                 |                  /
         worker: GET /dispatch/board  (assembles, 60s cache)
         worker: GET /dispatch/suggest (ranking for unassigned/new)
         worker: POST/PATCH/DELETE /dispatch/schedule (dual write + schedule_links)
                          |
         web API proxy routes (Supabase auth) → /dispatch page
```

Worker owns all integration credentials and clients (Halo, 3CX exist; Graph is
new). Web talks only to worker through authenticated proxy API routes.

## Components

### 0. One-button Microsoft 365 setup (Adminland)

User decision 2026-07-10: no manual Azure work at all. Adminland → Integrations →
"Microsoft 365 Calendar" has ONE button, **Connect Microsoft 365**:

1. Web starts a **device-code flow** against the well-known Microsoft Graph
   Command Line Tools public client (`14d82eec-204b-4c2f-b7e8-296a70dab67e`,
   `/organizations` endpoint, delegated scopes `Application.ReadWrite.All
   AppRoleAssignment.ReadWrite.All`). UI shows the short code + a button opening
   `microsoft.com/devicelogin`; the admin signs in once.
2. With the delegated token TriageIT provisions everything via Graph:
   create application ("TriageIT Calendar", single-tenant, requiredResourceAccess
   = Graph `Calendars.ReadWrite` application role
   `ef54d2bf-783f-4e0f-bca1-3210c0444d99` on resource
   `00000003-0000-0000-c000-000000000000`) → `addPassword` (24-month secret) →
   create service principal → grant admin consent programmatically
   (`POST /servicePrincipals/{graphSp}/appRoleAssignedTo`).
3. Verify: client-credentials token with the new secret (retry ≤60s for
   propagation) + `GET /users?$top=1`. Store `tenant_id`, `client_id`,
   `client_secret`, `app_object_id`, `consented_at` in the `integrations` row
   (`service: "msgraph"`). UI shows each step ✓ live.
4. Manual tenant/client/secret fields remain as fallback (conditional-access
   policies can block device code); the delegated token is used only during
   setup and never stored.

### 1. Graph client (worker, new: `integrations/msgraph/client.ts`)

Client-credentials OAuth (tenant id, client id, secret; `Calendars.ReadWrite`
application permission). Stored as an `integrations` row (`service: "msgraph"`)
with an Adminland section like every other integration. Methods:
`getCalendarView(email, from, to)` (busy blocks, `showAs`, subject, all-day),
`createEvent(email, event)`, `updateEvent(email, id, patch)`,
`deleteEvent(email, id)`. Follows the error≠empty convention: failures return a
`lookupFailed` signal, never an empty calendar.

### 2. Presence resolver (worker, pure function + endpoint)

`GET /dispatch/board` returns per helpdesk tech (roster from
`isHelpdeskTechnicianName` ∩ active Halo agents; tech → email and tech → 3CX
extension resolved from the Halo agent record, overridable in a config map):

- `statusNow` — strict priority, deterministic:
  1. **Off / PTO** — Outlook `showAs: oof` or all-day away event today
  2. **Onsite** — Halo appointment or calendar block happening now with a client/location
  3. **In meeting** — busy calendar block now (with end time)
  4. **On a call** — 3CX active call on their extension
  5. **Available** — 3CX extension registered during business hours
  6. **Unreachable** — no signal
- `load` — open / WOT / breaching counts from the local tickets table
- `nextCommitment` — next appointment/event today
- `aiRead` — one-line Haiku narrative; regenerated only when the tech's input
  hash changes (cost ≈ 0). The AI never determines `statusNow`.

Each source degrades independently: a failed source renders as an "unavailable"
chip on the board (e.g. "phone status unknown"), never a blank board and never
fabricated availability.

### 3. Assignment helper (worker: `GET /dispatch/suggest`)

For each unassigned or New Gamma Default ticket: top-3 techs, scored
deterministically with visible reasons —

- availability now: 0–40 (Available > On call > In meeting > Onsite > Off)
- inverse load: 0–30 (fewest open tickets best; breaching tickets weigh extra)
- skill fit: 0–20 (Toby `tech_profiles` strong/weak categories vs the ticket's
  Ryan classification; tiebreaker, never overrides availability)
- recency: 0–10 (recently resolved similar tickets for this client)

No LLM in the ranking. Bryanna assigns in Halo as today.

### 4. Schedule writer (worker: `POST/PATCH/DELETE /dispatch/schedule`)

Creating a block on the week grid (onsite visit, appointment, PTO day) writes:

1. Halo appointment (`/Appointment` API) for the agent
2. Matching Outlook event on the tech's calendar (Graph), body tagged
   `[TriageIT#<link-id>]`
3. Row in new `schedule_links` table:
   `id, halo_appointment_id, outlook_event_id, tech_name, tech_email,
   halo_ticket_id (nullable), kind (onsite|appointment|pto), starts_at, ends_at,
   created_by, created_at, updated_at`

Failure handling: if the second write fails, the first is rolled back (deleted);
if rollback itself fails, the row is stored with a `partial` flag and the UI
shows exactly which side is missing — never a silent half-write. Edits and
deletes from TriageIT update/delete both sides via the link row.

Duplicate-guard: if Halo's native M365 sync is enabled, the Halo write may
itself mirror to Outlook. The writer detects a same-time same-subject event
appearing on the calendar within the write window and skips its own Graph create
(link row records `outlook_event_id` of the native copy when identifiable, else
null with `native_sync` flag).

Out of scope: mirroring pre-existing Halo appointments into Outlook, or foreign
Outlook events into Halo. Reads cover the "vice versa" direction — anything
changed directly in either system appears on the board within the 60s cache.

### 5. Web page (`/dispatch`, new sidebar tab)

- **Right Now board** — tech rows sorted most-available first: status chip,
  load, next commitment, AI one-liner.
- **Assignment helper** — unassigned/New tickets with ranked top-3 + reasons.
- **Week grid** — rows = techs, Mon–Fri columns, blocks from Halo + Outlook
  (source-badged), TriageIT-created blocks editable (create / drag-move /
  delete → schedule writer). Foreign blocks read-only.
- Auto-refresh 60s; TriageIT dark-red/black design language (matches TV board).

## Phases

1. **Board + suggestions** — Halo + 3CX + DB signals, `/dispatch` page with
   Right Now board and assignment helper. Ships without Graph.
2. **Calendars + week grid + writes** — Graph client, Adminland creds section,
   PTO/meeting signals in the resolver, week grid with dual-write scheduling.
3. *(Optional, later)* presence history table + Command TV slide.

## Testing

- Unit: presence resolver priority order (each signal combination), suggestion
  scorer (availability dominates, Toby only tiebreaks), schedule writer rollback
  and duplicate-guard paths.
- Integration: worker endpoints against live Halo/3CX/Graph in staging.
- Live verify: board vs reality spot-check with Bryanna for a day before she
  relies on it.
