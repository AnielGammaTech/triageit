import { NextResponse, type NextRequest } from "next/server";
import { buildCommandCenterPayload } from "@/lib/api/command-center-data";
import { isValidTvSessionToken, TV_SESSION_COOKIE, tvKeyConfigured } from "@/lib/api/tv-key";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { workerFetch } from "@/lib/api/worker";

/**
 * GET /api/tv/command - device-session-gated Command Center data for the TV wallboard.
 * Auth: an HttpOnly session cookie issued by /api/tv/session. Exempted from
 * Supabase middleware because wallboard devices do not hold staff sessions.
 *
 * Also attaches best-effort dispatch presence and today's schedule from the
 * worker. Either field is omitted, never fatal, when its source errors.
 */

const DISPATCH_TIMEOUT_MS = 5_000;

interface TvDispatchTech {
  readonly tech: string;
  readonly status: { readonly state: string; readonly detail: string | null };
  readonly nextCommitment: string | null;
}

interface TvScheduleEvent {
  readonly day: string;
  readonly type: "site_visit" | "reminder" | "pto" | "meeting";
  readonly subject: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly allDay: boolean;
  readonly ticketId: number | null;
}

interface TvSchedule {
  readonly start: string;
  readonly days: ReadonlyArray<string>;
  readonly techs: ReadonlyArray<{
    readonly tech: string;
    readonly events: ReadonlyArray<TvScheduleEvent>;
  }>;
}

/** Best-effort tech presence for the TV band — null on any failure. */
async function fetchDispatchPresence(): Promise<{ readonly techs: ReadonlyArray<TvDispatchTech> } | null> {
  try {
    const res = await workerFetch("/dispatch/board", { signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const board = (await res.json()) as { techs?: ReadonlyArray<TvDispatchTech> };
    if (!Array.isArray(board.techs)) return null;
    return { techs: board.techs };
  } catch (err) {
    console.warn("[TV-COMMAND] Dispatch board unavailable:", (err as Error).message);
    return null;
  }
}

/** Best-effort current-day dispatch schedule — null on any failure. */
async function fetchDispatchSchedule(): Promise<TvSchedule | null> {
  try {
    const res = await workerFetch("/dispatch/week", { signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const schedule = (await res.json()) as Partial<TvSchedule>;
    if (!Array.isArray(schedule.days) || !Array.isArray(schedule.techs) || typeof schedule.start !== "string") {
      return null;
    }
    return schedule as TvSchedule;
  } catch (err) {
    console.warn("[TV-COMMAND] Dispatch schedule unavailable:", (err as Error).message);
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (!tvKeyConfigured()) {
    return NextResponse.json({ error: "TV access is not configured" }, { status: 503 });
  }

  const session = request.cookies.get(TV_SESSION_COOKIE)?.value;
  if (!isValidTvSessionToken(session)) {
    return NextResponse.json({ error: "Invalid or expired TV session" }, { status: 401 });
  }

  const rl = checkRateLimit("tv-wallboard", 30, 60_000, "tv-command");
  if (rl) return rl;

  try {
    const [payload, dispatch, schedule] = await Promise.all([
      buildCommandCenterPayload(),
      fetchDispatchPresence(),
      fetchDispatchSchedule(),
    ]);
    return NextResponse.json({
      ...payload,
      ...(dispatch ? { dispatch } : {}),
      ...(schedule ? { schedule } : {}),
    });
  } catch (err) {
    console.error("[TV-COMMAND] Failed to build payload:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load command center data" }, { status: 500 });
  }
}
