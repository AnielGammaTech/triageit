import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * POST /api/triage/all
 *
 * Triggers full AI triage (including tech performance reviews) on ALL open
 * tickets that haven't been triaged in the last 2 hours. This queues each
 * ticket for the full Michael Scott pipeline via the worker.
 *
 * Returns { queued, skipped, errors }.
 */
export async function POST() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  // Very strict rate limit — this is expensive (full pipeline per ticket)
  const rateLimited = checkRateLimit(auth.user.id, 2, 60_000, "triage-all");
  if (rateLimited) return rateLimited;

  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) {
    return NextResponse.json(
      { error: "WORKER_URL not configured — cannot trigger triage" },
      { status: 503 },
    );
  }

  const supabase = await createServiceClient();

  // Find all open tickets (not resolved/closed in Halo)
  const resolvedStatuses = [
    "Closed", "Resolved", "Cancelled", "Completed",
    "Resolved Remotely", "Resolved Onsite",
    "Resolved - Awaiting Confirmation",
  ];

  const { data: openTickets, error: fetchError } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, status, updated_at, halo_status")
    .not("halo_status", "in", `(${resolvedStatuses.join(",")})`)
    .order("created_at", { ascending: true });

  if (fetchError) {
    console.error("[API] Triage All — DB error:", fetchError);
    return NextResponse.json(
      { error: "Failed to fetch tickets" },
      { status: 500 },
    );
  }

  if (!openTickets || openTickets.length === 0) {
    return NextResponse.json({
      queued: 0,
      skipped: 0,
      message: "No open tickets found.",
    });
  }

  // Skip tickets triaged in the last 2 hours to avoid duplicate work
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;

  const ticketsToTriage = openTickets.filter((t) => {
    // Skip if currently triaging
    if (t.status === "triaging") return false;
    // Skip if recently updated (likely just triaged)
    if (t.updated_at && new Date(t.updated_at).getTime() > twoHoursAgo && t.status === "triaged") {
      return false;
    }
    return true;
  });

  let queued = 0;
  let skipped = openTickets.length - ticketsToTriage.length;
  const errors: string[] = [];

  // Queue each ticket for full triage via the worker
  for (const ticket of ticketsToTriage) {
    try {
      // Reset status to pending so it gets full pipeline treatment
      await supabase
        .from("tickets")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", ticket.id);

      const response = await fetch(`${workerUrl}/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: ticket.halo_id }),
      });

      if (response.ok) {
        queued++;
        console.log(`[TRIAGE ALL] Queued #${ticket.halo_id}: ${ticket.summary}`);
      } else {
        const text = await response.text();
        errors.push(`#${ticket.halo_id}: worker ${response.status} — ${text}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`#${ticket.halo_id}: ${msg}`);
    }
  }

  console.log(
    `[TRIAGE ALL] Complete: ${queued} queued, ${skipped} skipped, ${errors.length} errors`,
  );

  return NextResponse.json({
    queued,
    skipped,
    total_open: openTickets.length,
    errors: errors.length > 0 ? errors : undefined,
    message: `Queued ${queued} tickets for full triage with tech performance reviews.`,
  });
}
