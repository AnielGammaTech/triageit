import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/admin/health/debug-count
 * Mimics exactly what the tickets page does — uses auth client (not service role).
 */
export async function GET() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tickets")
    .select(`
      id, halo_id, summary, tickettype_id, halo_status, halo_is_open
    `)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tickets = data ?? [];
  const gammaDefault = tickets.filter((t) => t.tickettype_id === 31);

  const closedStatuses = ["closed", "cancelled", "completed"];

  const isClosed = (t: typeof tickets[0]) => {
    if (t.halo_is_open === true) return false;
    if (t.halo_is_open === false) return true;
    if (!t.halo_status) return false;
    return closedStatuses.includes((t.halo_status as string).toLowerCase());
  };

  const open = gammaDefault.filter((t) => !isClosed(t));
  const closed = gammaDefault.filter((t) => isClosed(t));

  // Find the ones that are halo_is_open=true but isClosed returns true
  const buggy = gammaDefault.filter((t) => t.halo_is_open === true && isClosed(t));

  // Find the ones that are halo_is_open=true but NOT in the open list
  const openTrue = gammaDefault.filter((t) => t.halo_is_open === true);
  const openTrueButClosed = openTrue.filter((t) => isClosed(t));

  return NextResponse.json({
    total_fetched: tickets.length,
    gamma_default: gammaDefault.length,
    open: open.length,
    closed: closed.length,
    halo_is_open_true: openTrue.length,
    halo_is_open_true_but_isClosed: openTrueButClosed.length,
    buggy_tickets: buggy.map((t) => ({
      halo_id: t.halo_id,
      halo_is_open: t.halo_is_open,
      halo_status: t.halo_status,
    })),
  });
}
