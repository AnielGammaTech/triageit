import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/cron-jobs
 * Returns all cron jobs from the database.
 */
export async function GET() {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("cron_jobs")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: `Failed to fetch cron jobs: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ jobs: data });
}

/**
 * POST /api/cron-jobs
 * Create a new cron job.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description, schedule, endpoint } = body;

  if (!name || !schedule || !endpoint) {
    return NextResponse.json(
      { error: "name, schedule, and endpoint are required" },
      { status: 400 },
    );
  }

  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("cron_jobs")
    .insert({
      name,
      description: description ?? "",
      schedule,
      endpoint,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: `Failed to create cron job: ${error.message}` },
      { status: 500 },
    );
  }

  // Notify worker to reload cron scheduler
  await notifyWorkerReload();

  return NextResponse.json({ job: data }, { status: 201 });
}

/**
 * PATCH /api/cron-jobs
 * Update a cron job (toggle active, change schedule, etc.)
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json(
      { error: "id is required" },
      { status: 400 },
    );
  }

  // Only allow specific fields to be updated
  const allowedFields = ["name", "description", "schedule", "endpoint", "is_active"];
  const sanitizedUpdates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in updates) {
      sanitizedUpdates[key] = updates[key];
    }
  }
  sanitizedUpdates["updated_at"] = new Date().toISOString();

  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("cron_jobs")
    .update(sanitizedUpdates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: `Failed to update cron job: ${error.message}` },
      { status: 500 },
    );
  }

  // Notify worker to reload cron scheduler
  await notifyWorkerReload();

  return NextResponse.json({ job: data });
}

/**
 * DELETE /api/cron-jobs
 * Delete a cron job by ID.
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "id query parameter is required" },
      { status: 400 },
    );
  }

  const supabase = await createServiceClient();

  const { error } = await supabase
    .from("cron_jobs")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: `Failed to delete cron job: ${error.message}` },
      { status: 500 },
    );
  }

  // Notify worker to reload cron scheduler
  await notifyWorkerReload();

  return NextResponse.json({ status: "deleted" });
}

async function notifyWorkerReload(): Promise<void> {
  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) return;

  try {
    await fetch(`${workerUrl}/cron/reload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    // Worker might be down — the scheduler will pick up changes on restart
    console.warn("[API] Failed to notify worker of cron reload");
  }
}
