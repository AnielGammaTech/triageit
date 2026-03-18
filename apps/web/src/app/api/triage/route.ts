import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/triage
 *
 * Manually trigger AI triage on a ticket.
 * Calls the worker service's /triage endpoint.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { ticket_id?: string };

  if (!body.ticket_id) {
    return NextResponse.json({ error: "ticket_id is required" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  // Verify ticket exists
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, halo_id, status")
    .eq("id", body.ticket_id)
    .single();

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  // Reset status to pending so worker picks it up fresh
  await supabase
    .from("tickets")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("id", body.ticket_id);

  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) {
    return NextResponse.json(
      { error: "WORKER_URL not configured — cannot trigger triage" },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${workerUrl}/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket_id: body.ticket_id }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Worker returned ${response.status}: ${text}` },
        { status: 502 },
      );
    }

    const result = await response.json();
    return NextResponse.json({ status: "triggered", ...result });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to reach worker: ${(error as Error).message}` },
      { status: 502 },
    );
  }
}

/**
 * DELETE /api/triage
 *
 * Delete old/test tickets from the database.
 */
export async function DELETE(request: NextRequest) {
  const body = (await request.json()) as { ticket_ids?: readonly string[] };

  if (!body.ticket_ids?.length) {
    return NextResponse.json({ error: "ticket_ids[] is required" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  // Delete triage results first (FK constraint)
  await supabase
    .from("triage_results")
    .delete()
    .in("ticket_id", [...body.ticket_ids]);

  // Delete agent logs
  await supabase
    .from("agent_logs")
    .delete()
    .in("ticket_id", [...body.ticket_ids]);

  // Delete tickets
  const { error } = await supabase
    .from("tickets")
    .delete()
    .in("id", [...body.ticket_ids]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "deleted", count: body.ticket_ids.length });
}
