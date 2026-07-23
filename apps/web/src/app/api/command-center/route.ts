import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import {
  applyScheduleAwareScoring,
  buildCommandCenterPayload,
  type CommandAvailabilityTech,
} from "@/lib/api/command-center-data";
import { workerFetch } from "@/lib/api/worker";

async function fetchAvailability(): Promise<ReadonlyArray<CommandAvailabilityTech>> {
  try {
    const response = await workerFetch("/dispatch/board", {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      readonly techs?: ReadonlyArray<CommandAvailabilityTech>;
    };
    return Array.isArray(payload.techs) ? payload.techs : [];
  } catch {
    return [];
  }
}

/**
 * GET /api/command-center — authenticated dashboard variant.
 * The TV wallboard uses the key-gated /api/tv/command instead.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const rl = checkRateLimit(auth.user.id, 30, 60_000, "command-center");
  if (rl) return rl;

  try {
    const [payload, availability] = await Promise.all([
      buildCommandCenterPayload(),
      fetchAvailability(),
    ]);
    return NextResponse.json(
      availability.length > 0
        ? applyScheduleAwareScoring(payload, availability)
        : payload,
    );
  } catch (err) {
    console.error("[COMMAND-CENTER] Failed to build payload:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load command center data" }, { status: 500 });
  }
}
