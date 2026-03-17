import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { HaloTicket } from "@triageit/shared";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const webhookSecret = process.env.HALO_WEBHOOK_SECRET;

  if (webhookSecret && authHeader !== `Bearer ${webhookSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ticket = body as HaloTicket;

  if (!ticket.id || !ticket.summary) {
    return NextResponse.json(
      { error: "Missing required fields: id, summary" },
      { status: 400 },
    );
  }

  const supabase = await createServiceClient();

  const { data: existing } = await supabase
    .from("tickets")
    .select("id")
    .eq("halo_id", ticket.id)
    .single();

  if (existing) {
    const { error } = await supabase
      .from("tickets")
      .update({
        summary: ticket.summary,
        details: ticket.details ?? null,
        client_name: ticket.client_name ?? null,
        client_id: ticket.client_id ?? null,
        user_name: ticket.user_name ?? null,
        original_priority: ticket.priority_id ?? null,
        raw_data: ticket,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) {
      return NextResponse.json(
        { error: "Failed to update ticket" },
        { status: 500 },
      );
    }

    return NextResponse.json({ status: "updated", ticket_id: existing.id });
  }

  const { data: inserted, error } = await supabase
    .from("tickets")
    .insert({
      halo_id: ticket.id,
      summary: ticket.summary,
      details: ticket.details ?? null,
      client_name: ticket.client_name ?? null,
      client_id: ticket.client_id ?? null,
      user_name: ticket.user_name ?? null,
      original_priority: ticket.priority_id ?? null,
      status: "pending",
      raw_data: ticket,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to insert ticket" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { status: "created", ticket_id: inserted.id },
    { status: 201 },
  );
}
