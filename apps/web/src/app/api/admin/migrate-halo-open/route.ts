import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";

/**
 * One-time migration: adds halo_is_open column and backfills it.
 * DELETE THIS FILE after running once.
 * Hit: POST /api/admin/migrate-halo-open
 */
export async function POST() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const supabase = await createServiceClient();

  // Step 1: Add column via raw RPC (requires pg_net or direct SQL)
  // Since we can't run DDL via PostgREST, we'll use a workaround:
  // Try to update a row with halo_is_open — if it fails, column doesn't exist yet
  const { error: testError } = await supabase
    .from("tickets")
    .update({ halo_is_open: true })
    .eq("id", "00000000-0000-0000-0000-000000000000"); // non-existent row, harmless

  if (testError?.message?.includes("halo_is_open")) {
    return NextResponse.json({
      error: "Column halo_is_open doesn't exist yet. Run this SQL in Supabase SQL Editor first:",
      sql: "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS halo_is_open boolean DEFAULT true;",
    }, { status: 400 });
  }

  // Step 2: Backfill — mark resolved/closed tickets as not open
  const { data: allTickets, error: fetchError } = await supabase
    .from("tickets")
    .select("id, halo_status")
    .not("halo_status", "is", null);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  let closedCount = 0;
  const closedPrefixes = ["resolved", "closed", "cancelled", "completed"];

  for (const ticket of allTickets ?? []) {
    const status = (ticket.halo_status ?? "").toLowerCase();
    const isClosed = closedPrefixes.some((p) => status.startsWith(p));

    if (isClosed) {
      await supabase
        .from("tickets")
        .update({ halo_is_open: false })
        .eq("id", ticket.id);
      closedCount++;
    }
  }

  return NextResponse.json({
    success: true,
    total: (allTickets ?? []).length,
    marked_closed: closedCount,
    message: "Backfill complete. Now run pull-tickets to sync open flags from Halo.",
  });
}
