import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * POST /api/admin/health/evict-memories
 * Garbage-collect stale/unused agent memories.
 */
export async function POST() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  try {
    const supabase = await createServiceClient();

    const maxAgeDays = 90;
    const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    const deepCutoffDate = new Date(Date.now() - maxAgeDays * 2 * 24 * 60 * 60 * 1000).toISOString();
    const recentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let evicted = 0;

    // 1. Old + never recalled
    const { data: neverRecalled } = await supabase
      .from("agent_memories")
      .select("id")
      .lt("created_at", cutoffDate)
      .eq("times_recalled", 0);

    if (neverRecalled && neverRecalled.length > 0) {
      const ids = neverRecalled.map((m) => m.id as string);
      await supabase.from("agent_memories").delete().in("id", ids);
      evicted += ids.length;
    }

    // 2. Very old + rarely recalled
    const { data: rarelyRecalled } = await supabase
      .from("agent_memories")
      .select("id")
      .lt("created_at", deepCutoffDate)
      .lt("times_recalled", 2);

    if (rarelyRecalled && rarelyRecalled.length > 0) {
      const ids = rarelyRecalled.map((m) => m.id as string);
      await supabase.from("agent_memories").delete().in("id", ids);
      evicted += ids.length;
    }

    // 3. Low confidence + not recent
    const { data: lowConfidence } = await supabase
      .from("agent_memories")
      .select("id")
      .lt("confidence", 0.3)
      .lt("created_at", recentCutoff);

    if (lowConfidence && lowConfidence.length > 0) {
      const ids = lowConfidence.map((m) => m.id as string);
      await supabase.from("agent_memories").delete().in("id", ids);
      evicted += ids.length;
    }

    // Get remaining count
    const { count } = await supabase
      .from("agent_memories")
      .select("id", { count: "exact", head: true });

    return NextResponse.json({
      success: true,
      message: `Evicted ${evicted} stale memories. ${count ?? 0} remaining.`,
      evicted,
      remaining: count ?? 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
