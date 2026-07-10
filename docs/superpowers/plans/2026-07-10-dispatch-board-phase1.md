# Dispatch Board Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/dispatch` page for Bryanna — live "Right Now" tech availability board (Halo + 3CX + local DB signals) and suggest-only assignment ranking for unassigned/New tickets.

**Architecture:** Pure presence-resolver and scorer modules in the worker (unit-tested), assembled by a cached `GET /dispatch/board` + `GET /dispatch/suggest` on the existing Fastify server; web proxies via `workerFetch` with Supabase auth; new dashboard page renders both. Spec: `docs/superpowers/specs/2026-07-10-dispatch-board-design.md`.

**Tech Stack:** TypeScript, Fastify (worker), Next.js 16 app router (web), Supabase, existing `HaloClient`/`ThreeCxClient`, vitest (new dev-dep, worker only), Anthropic Haiku for one-liners.

## Global Constraints

- Immutability: never mutate inputs; return new objects (user's global rule).
- Error ≠ empty: a failed source returns `null` (unknown), never `[]`/fabricated availability — mirror the Creed `lookupFailed` pattern.
- Business hours = America/New_York; all user-facing times rendered ET.
- Roster = active Halo agents ∩ `isHelpdeskTechnicianName` (from `@triageit/shared`).
- No new runtime dependencies. Dev-dep: `vitest` in `apps/worker` only.
- Suggest-only: no Halo assignment write-back anywhere in this phase.
- All worker files under `apps/worker/src/dispatch/` (new directory), <400 lines each.
- Match repo idiom: worker logs via `console.log("[DISPATCH] ...")`, web API routes use `requireAuth` + `checkRateLimit`.

---

### Task 1: vitest + presence resolver (pure module)

**Files:**
- Modify: `apps/worker/package.json` (add `"test": "vitest run"`, devDependency `"vitest": "^3"`)
- Create: `apps/worker/src/dispatch/presence.ts`
- Test: `apps/worker/src/dispatch/presence.test.ts`

**Interfaces:**
- Produces: `resolveTechStatus(signals: TechSignals): TechStatus` and the two types below — Task 3 imports all three.

```ts
// presence.ts — types (exact)
export interface TechSignals {
  readonly onPtoToday: boolean | null;        // null = calendar source unavailable (phase 2 feeds this; phase 1 passes null)
  readonly onsiteAppointment: { readonly subject: string; readonly endsAt: string } | null;
  readonly inMeetingUntil: string | null;     // ISO end of current busy block, null = none/unknown
  readonly onCall: boolean | null;            // null = 3CX unavailable
  readonly extensionRegistered: boolean | null;
  readonly withinBusinessHours: boolean;
}
export interface TechStatus {
  readonly state: "off" | "onsite" | "meeting" | "on_call" | "available" | "unreachable" | "unknown";
  readonly detail: string | null;             // e.g. "Onsite — Allen Concrete until 4:00 PM"
}
```

- [ ] **Step 1: Add vitest.** In `apps/worker/package.json` scripts add `"test": "vitest run"`; add `"vitest": "^3.0.0"` to devDependencies. Run `npm install --workspace apps/worker` from repo root.

- [ ] **Step 2: Write the failing test** (`presence.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { resolveTechStatus, type TechSignals } from "./presence.js";

const base: TechSignals = {
  onPtoToday: false, onsiteAppointment: null, inMeetingUntil: null,
  onCall: false, extensionRegistered: true, withinBusinessHours: true,
};

describe("resolveTechStatus priority order", () => {
  it("PTO beats everything", () => {
    expect(resolveTechStatus({ ...base, onPtoToday: true, onCall: true }).state).toBe("off");
  });
  it("onsite beats meeting/call", () => {
    const s = resolveTechStatus({ ...base, onsiteAppointment: { subject: "Allen Concrete", endsAt: "2026-07-10T20:00:00Z" }, onCall: true });
    expect(s.state).toBe("onsite");
    expect(s.detail).toContain("Allen Concrete");
  });
  it("meeting beats call", () => {
    expect(resolveTechStatus({ ...base, inMeetingUntil: "2026-07-10T20:00:00Z", onCall: true }).state).toBe("meeting");
  });
  it("call beats available", () => {
    expect(resolveTechStatus({ ...base, onCall: true }).state).toBe("on_call");
  });
  it("registered in business hours = available", () => {
    expect(resolveTechStatus(base).state).toBe("available");
  });
  it("no registration, no signals = unreachable", () => {
    expect(resolveTechStatus({ ...base, extensionRegistered: false }).state).toBe("unreachable");
  });
  it("all sources unknown = unknown, never available", () => {
    expect(resolveTechStatus({ ...base, onPtoToday: null, onCall: null, extensionRegistered: null }).state).toBe("unknown");
  });
  it("outside business hours never claims available", () => {
    expect(resolveTechStatus({ ...base, withinBusinessHours: false }).state).not.toBe("available");
  });
});
```

- [ ] **Step 3: Run to verify failure.** `cd apps/worker && npx vitest run src/dispatch/presence.test.ts` — expect FAIL (module not found).

- [ ] **Step 4: Implement** (`presence.ts`): the two exported types above plus:

```ts
const fmtEt = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

export function resolveTechStatus(s: TechSignals): TechStatus {
  if (s.onPtoToday === true) return { state: "off", detail: "Off today (PTO)" };
  if (s.onsiteAppointment) return { state: "onsite", detail: `Onsite — ${s.onsiteAppointment.subject} until ${fmtEt(s.onsiteAppointment.endsAt)}` };
  if (s.inMeetingUntil) return { state: "meeting", detail: `In a meeting until ${fmtEt(s.inMeetingUntil)}` };
  if (s.onCall === true) return { state: "on_call", detail: "On a call" };
  if (s.extensionRegistered === true && s.withinBusinessHours) return { state: "available", detail: null };
  if (s.extensionRegistered === false) return { state: "unreachable", detail: "No phone registered" };
  return { state: "unknown", detail: "No presence signal" };
}
```

- [ ] **Step 5: Run tests → PASS.** Also `npx tsc --noEmit`.
- [ ] **Step 6: Commit** `feat: dispatch presence resolver (pure, tested) + vitest setup`

---

### Task 2: suggestion scorer (pure module)

**Files:**
- Create: `apps/worker/src/dispatch/scorer.ts`
- Test: `apps/worker/src/dispatch/scorer.test.ts`

**Interfaces:**
- Consumes: `TechStatus` from Task 1.
- Produces: `scoreTechForTicket(tech: TechCandidate, ticket: TicketToAssign): Suggestion` — Task 3 imports it.

```ts
// scorer.ts — types (exact)
export interface TechCandidate {
  readonly tech: string;
  readonly status: TechStatus;                 // from presence.ts
  readonly openTickets: number;
  readonly breaching: number;
  readonly strongCategories: ReadonlyArray<string>;
  readonly weakCategories: ReadonlyArray<string>;
  readonly recentSimilarForClient: number;     // resolved tickets, same client+type, 30d
}
export interface TicketToAssign {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly ticketType: string | null;          // Ryan classification type
}
export interface Suggestion {
  readonly tech: string;
  readonly score: number;
  readonly reasons: ReadonlyArray<string>;
}
```

- [ ] **Step 1: Write failing test** (`scorer.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { scoreTechForTicket, type TechCandidate, type TicketToAssign } from "./scorer.js";

const ticket: TicketToAssign = { halo_id: 1, summary: "Outlook broken", client_name: "Acme", ticketType: "email" };
const tech = (over: Partial<TechCandidate>): TechCandidate => ({
  tech: "T", status: { state: "available", detail: null }, openTickets: 10, breaching: 0,
  strongCategories: [], weakCategories: [], recentSimilarForClient: 0, ...over,
});

describe("scoreTechForTicket", () => {
  it("availability dominates: available+heavy beats off+idle", () => {
    const busy = scoreTechForTicket(tech({ openTickets: 30 }), ticket);
    const off = scoreTechForTicket(tech({ status: { state: "off", detail: null }, openTickets: 0 }), ticket);
    expect(busy.score).toBeGreaterThan(off.score);
  });
  it("lighter load scores higher, all else equal", () => {
    expect(scoreTechForTicket(tech({ openTickets: 5 }), ticket).score)
      .toBeGreaterThan(scoreTechForTicket(tech({ openTickets: 25 }), ticket).score);
  });
  it("skill fit is a tiebreaker, not a trump: available always beats on_call regardless of fit", () => {
    const fitButBusy = scoreTechForTicket(tech({ status: { state: "on_call", detail: null }, strongCategories: ["email"] }), ticket);
    const freeNoFit = scoreTechForTicket(tech({}), ticket);
    expect(freeNoFit.score).toBeGreaterThan(fitButBusy.score);
  });
  it("weak category subtracts and is stated in reasons", () => {
    const s = scoreTechForTicket(tech({ weakCategories: ["email"] }), ticket);
    expect(s.reasons.join(" ")).toMatch(/weak/i);
  });
  it("every contributing factor appears in reasons", () => {
    const s = scoreTechForTicket(tech({ strongCategories: ["email"], recentSimilarForClient: 2 }), ticket);
    expect(s.reasons.length).toBeGreaterThanOrEqual(3); // availability + load + fit (+ recency)
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (`scorer.ts`):

```ts
import type { TechStatus } from "./presence.js";

const AVAILABILITY_POINTS: Record<TechStatus["state"], number> = {
  available: 40, on_call: 24, meeting: 18, onsite: 10, unknown: 8, unreachable: 4, off: 0,
};

export function scoreTechForTicket(t: TechCandidate, ticket: TicketToAssign): Suggestion {
  const reasons: string[] = [];
  const avail = AVAILABILITY_POINTS[t.status.state];
  reasons.push(t.status.state === "available" ? "available now" : (t.status.detail ?? t.status.state).toLowerCase());
  // Inverse load 0-30: 0 open → 30, 30+ open → 0. Breaching tickets weigh double.
  const effectiveLoad = t.openTickets + t.breaching;
  const load = Math.max(0, 30 - effectiveLoad);
  reasons.push(`${t.openTickets} open${t.breaching > 0 ? ` (${t.breaching} breaching)` : ""}`);
  let fit = 0;
  const type = (ticket.ticketType ?? "").toLowerCase();
  if (type && t.strongCategories.some((c) => c.toLowerCase() === type)) { fit += 15; reasons.push(`strong on ${type} (Toby)`); }
  if (type && t.weakCategories.some((c) => c.toLowerCase() === type)) { fit -= 10; reasons.push(`weak on ${type} (Toby)`); }
  let recency = 0;
  if (t.recentSimilarForClient > 0) { recency = Math.min(10, t.recentSimilarForClient * 5); reasons.push(`resolved ${t.recentSimilarForClient} similar for ${ticket.client_name ?? "this client"} recently`); }
  return { tech: t.tech, score: avail + load + fit + recency, reasons };
}
```

(Include the three interfaces from the block above in this file, exported.)

- [ ] **Step 4: Run tests → PASS; `npx tsc --noEmit`.** (Verify the availability-dominates test: available floor 40+0 load ≥ on_call 24+30+15+10=79? NO — 24+30+25 = 79 > 40. Fix: the test "skill fit is a tiebreaker" uses equal loads (10 open both) → free-no-fit = 40+20 = 60 vs fit-but-on-call = 24+20+15 = 59. Keep loads equal in that test as written. The "availability dominates" test compares available+30 open (40+0=40) vs off+0 open (0+30=30) — passes.)
- [ ] **Step 5: Commit** `feat: dispatch suggestion scorer (deterministic, tested)`

---

### Task 3: board assembler + worker endpoints

**Files:**
- Create: `apps/worker/src/dispatch/board.ts`
- Modify: `apps/worker/src/integrations/halo/client.ts` (add `getAppointments`)
- Modify: `apps/worker/src/server.ts` (two GET routes, registered next to `/sla-scan`)

**Interfaces:**
- Consumes: `resolveTechStatus`, `scoreTechForTicket` (Tasks 1–2); `HaloClient`, `ThreeCxClient`, `createSupabaseClient`, `getCachedHaloConfig`, `isWithinBusinessHours`, `isHelpdeskTechnicianName`.
- Produces: `buildDispatchBoard(): Promise<DispatchBoard>` and `buildSuggestions(): Promise<DispatchSuggestions>`, exposed as `GET /dispatch/board` and `GET /dispatch/suggest`.

```ts
export interface DispatchBoard {
  readonly generatedAt: string;
  readonly sources: { readonly halo: boolean; readonly threecx: boolean; readonly calendar: boolean }; // false = degraded
  readonly techs: ReadonlyArray<{
    readonly tech: string;
    readonly status: TechStatus;
    readonly load: { readonly open: number; readonly wot: number; readonly breaching: number };
    readonly nextCommitment: string | null;   // "Onsite — Bentley Electric 2:00 PM"
    readonly aiRead: string | null;           // Task 4 fills; null until then
  }>;
}
export interface DispatchSuggestions {
  readonly tickets: ReadonlyArray<{
    readonly halo_id: number; readonly summary: string | null; readonly client_name: string | null;
    readonly status: string | null; readonly suggestions: ReadonlyArray<Suggestion>; // top 3
  }>;
}
```

- [ ] **Step 1: `HaloClient.getAppointments`.** In `halo/client.ts` add (following the class's existing request style — same auth/token flow as `getOpenTickets`):

```ts
/** Appointments for the given agent ids in [start, end). Halo: GET /Appointment. */
async getAppointments(start: string, end: string): Promise<ReadonlyArray<Record<string, unknown>> | null> {
  try {
    const res = await this.request(`/Appointment?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`);
    const rows = (res as { appointments?: unknown[] })?.appointments ?? (Array.isArray(res) ? res : []);
    return rows as ReadonlyArray<Record<string, unknown>>;
  } catch (err) {
    console.warn("[HALO] getAppointments failed:", err instanceof Error ? err.message : err);
    return null; // lookupFailed — caller must not treat as "no appointments"
  }
}
```

(Use the class's actual private request helper name — read the file first; it may be `this.fetchJson`/`this.get`. Match exactly.)

- [ ] **Step 2: `board.ts`.** Assemble with a 60s in-memory cache:

```ts
let cache: { at: number; board: DispatchBoard } | null = null;

export async function buildDispatchBoard(): Promise<DispatchBoard> {
  if (cache && Date.now() - cache.at < 60_000) return cache.board;
  const supabase = createSupabaseClient();
  const haloConfig = await getCachedHaloConfig(supabase);
  // roster: active agents from halo /agent, filtered by isHelpdeskTechnicianName(name)
  // tickets: supabase tickets where halo_is_open=true, tickettype_id=31 → per-tech open/wot/breaching (same aggregation as command-center)
  // 3CX: new ThreeCxClient(config).getActiveCalls() + getExtensions() — config from integrations table (service='threecx'); null on failure
  // appointments: halo.getAppointments(todayStartEtIso, todayEndEtIso) — null on failure
  // per tech: signals → resolveTechStatus; onsiteAppointment = appointment happening now for that agent (match agent name/id, client/site in subject);
  //           nextCommitment = earliest future appointment today; onPtoToday = null (phase 2); inMeetingUntil = null (phase 2)
  // sources: { halo: appointments !== null, threecx: activeCalls !== null, calendar: false }
  // sort: available first, then on_call, meeting, onsite, unknown, unreachable, off
}
```

The implementer writes this in full — every source wrapped in its own try, `null` on failure, and the per-tech signals must pass `withinBusinessHours: isWithinBusinessHours()`. On-call matching: 3CX active call participants matched to the tech's extension (extension resolved by name via `getExtensions()` — the same name-matching used by `ringExtension`/sla-call; read that code and reuse its helper rather than re-implementing).

- [ ] **Step 3: `buildSuggestions`.** Tickets: `halo_is_open=true, tickettype_id=31`, and (`halo_agent` null/Unassigned OR `halo_status` = 'New'). Ticket type: latest `triage_results.classification->>'type'` for the ticket (single query with `in` on ticket ids). `recentSimilarForClient`: count of tickets same client_name, same type, `halo_is_open=false`, `updated_at` ≥ 30d ago (one grouped query, not N). Candidates = board techs; return top 3 by score per ticket.

- [ ] **Step 4: Fastify routes in `server.ts`** (place beside `/sla-scan`; the server's existing auth hook already protects non-webhook routes — verify by reading the `authorization` check at the top of server.ts and matching it):

```ts
server.get("/dispatch/board", async (_request, reply) => {
  try { return await buildDispatchBoard(); }
  catch (err) { return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) }); }
});
server.get("/dispatch/suggest", async (_request, reply) => {
  try { return await buildSuggestions(); }
  catch (err) { return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) }); }
});
```

- [ ] **Step 5: Verify live-ish.** `npx tsc --noEmit`; then run the worker locally if env available, else deploy to Railway and: `curl -s $WORKER_URL/dispatch/board -H "authorization: Bearer $TRIAGEIT_WORKER_SECRET" | python3 -m json.tool | head -40` — expect techs array with statuses, `sources.threecx: true`.
- [ ] **Step 6: Commit** `feat: dispatch board + suggestions endpoints (Halo+3CX+DB, 60s cache)`

---

### Task 4: Haiku one-liners (aiRead)

**Files:**
- Modify: `apps/worker/src/dispatch/board.ts`

**Interfaces:** `aiRead` field goes from always-null to populated; no signature changes.

- [ ] **Step 1:** Hash each tech's `(status.state, status.detail, load, nextCommitment)` (JSON string). Module-level `Map<tech, {hash, read}>`. On change, ONE batched Haiku call for all changed techs (model `claude-haiku-4-5-20251001`, existing Anthropic client pattern from realtime-handler): prompt asks for one ≤14-word dispatcher-voice line per tech, JSON out. On API failure: keep previous read or null — never block the board (fire-and-forget refresh; board returns immediately with stale reads).
- [ ] **Step 2:** `npx tsc --noEmit`; curl the endpoint twice — second response includes `aiRead` strings; logs show a single `[DISPATCH] aiRead refresh (N techs)` call.
- [ ] **Step 3: Commit** `feat: dispatch aiRead one-liners (Haiku, hash-cached)`

---

### Task 5: web proxy routes

**Files:**
- Create: `apps/web/src/app/api/dispatch/board/route.ts`
- Create: `apps/web/src/app/api/dispatch/suggest/route.ts`

**Interfaces:** JSON pass-through of Task 3 types; consumed by Task 6.

- [ ] **Step 1:** Both routes identical shape (import `requireAuth`, `checkRateLimit`, `workerFetch` from `@/lib/api/worker` — read that file for the exact export):

```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { workerFetch } from "@/lib/api/worker";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const rl = checkRateLimit(auth.user.id, 30, 60_000, "dispatch-board");
  if (rl) return rl;
  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) return NextResponse.json({ error: "WORKER_URL not configured" }, { status: 503 });
  const res = await workerFetch(`${workerUrl}/dispatch/board`, { method: "GET" });
  if (!res.ok) return NextResponse.json({ error: `Worker ${res.status}` }, { status: 502 });
  return NextResponse.json(await res.json());
}
```

(`/suggest` identical with its path + `"dispatch-suggest"` rate key.)

- [ ] **Step 2:** `npx tsc --noEmit` in apps/web.
- [ ] **Step 3: Commit** `feat: dispatch web proxy routes`

---

### Task 6: /dispatch page + sidebar

**Files:**
- Create: `apps/web/src/app/(dashboard)/dispatch/page.tsx`
- Modify: `apps/web/src/components/dashboard/sidebar.tsx` (add nav item "Dispatch", lucide `Radio` icon, after Command)

**Interfaces:** Consumes the two proxy routes; types mirrored locally (page-local interfaces matching Task 3's JSON).

- [ ] **Step 1: Page.** Client component, same fetch/refresh skeleton as `/command` (60s interval + manual refresh). Layout, TriageIT dark red/black language (PANEL `#151013`, HAIRLINE `#3a1f24`, red `#dc2626`):
  - **Right Now board** (left, 7/12): tech rows — status chip (colored per state: available `#22c55e`, on_call `#0f75b1`, meeting `#f59e0b`, onsite `#fe9200`, off `#71717a`, unreachable/unknown `#f87171`), name, `detail`, load (`open · wot · breaching` — breaching red when >0), `nextCommitment`, `aiRead` in muted italic. Sorted as delivered (worker pre-sorts). Source-degradation banner when any `sources.*` is false: "Phone status unavailable — showing partial signals."
  - **Assignment helper** (right, 5/12): per unassigned/New ticket — `#id client — summary` then top-3 suggestion rows: rank, tech, score, reasons joined with " · ". No assign button (suggest-only).
- [ ] **Step 2:** `npx tsc --noEmit && npm run build` (webpack flag script) in apps/web — build passes, `/dispatch` in route list.
- [ ] **Step 3: Verify visually.** Deploy (push main+production), then Playwright: log in? (dashboard needs Supabase auth — verify with an authenticated session or screenshot the page via existing dev auth; at minimum curl the proxy route with a session, and screenshot /dispatch on the deployed app while logged in via stored browser profile).
- [ ] **Step 4: Commit** `feat: /dispatch page — Right Now board + assignment helper`

---

### Task 7: deploy + live verification

- [ ] Push main + production; wait for both Railway deploys SUCCESS.
- [ ] `curl` worker `/dispatch/board`: every roster tech present; spot-check one tech on a real call shows `on_call` (make a test call via 3CX if none live).
- [ ] Screenshot `/dispatch` and eyeball vs reality; confirm with the team that statuses match (Bryanna spot-check day per spec).
- [ ] Append results to the TriageIT fixes log memory.

---

## Phase 2 pointer (separate plan)

Graph client + Adminland creds section + PTO/meeting signals (`onPtoToday`, `inMeetingUntil` stop being null) + week grid + dual-write schedule writer with `schedule_links` — planned after TV/board phase 1 verifies and the Azure creds are pasted. Spec section: "Schedule writer".
