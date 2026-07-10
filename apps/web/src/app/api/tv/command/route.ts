import { NextResponse, type NextRequest } from "next/server";
import { buildCommandCenterPayload } from "@/lib/api/command-center-data";
import { isValidTvKey, tvKeyConfigured } from "@/lib/api/tv-key";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { workerFetch } from "@/lib/api/worker";

/**
 * GET /api/tv/command — key-gated Command Center data for the TV wallboard.
 * Auth: x-tv-key header (preferred) or ?key= query param, checked against
 * the TV_DASHBOARD_KEY env var. Exempted from Supabase middleware.
 *
 * Also attaches a best-effort `dispatch` field (tech presence from the
 * worker's /dispatch/board) — omitted, never fatal, when the board errors.
 */

const DISPATCH_TIMEOUT_MS = 5_000;

interface TvDispatchTech {
  readonly tech: string;
  readonly status: { readonly state: string; readonly detail: string | null };
  readonly nextCommitment: string | null;
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
export async function GET(request: NextRequest) {
  if (!tvKeyConfigured()) {
    return NextResponse.json({ error: "TV access is not configured" }, { status: 503 });
  }

  const key = request.headers.get("x-tv-key") ?? request.nextUrl.searchParams.get("key");
  if (!isValidTvKey(key)) {
    return NextResponse.json({ error: "Invalid access key" }, { status: 401 });
  }

  const rl = checkRateLimit("tv-wallboard", 30, 60_000, "tv-command");
  if (rl) return rl;

  try {
    const [payload, dispatch] = await Promise.all([buildCommandCenterPayload(), fetchDispatchPresence()]);
    return NextResponse.json(dispatch ? { ...payload, dispatch } : payload);
  } catch (err) {
    console.error("[TV-COMMAND] Failed to build payload:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load command center data" }, { status: 500 });
  }
}
