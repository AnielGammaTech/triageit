import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/require-admin";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { workerFetch } from "@/lib/api/worker";
import { readJsonBody } from "@/lib/api/json-body";

const ALLOWED_ENDPOINTS = new Set([
  "/retriage",
  "/sla-scan",
  "/sla-call-requests",
  "/toby/analyze",
  "/ticket-sync",
  "/integration-heartbeat",
  "/workflow-scan",
  "/memory/evict",
  "/error-scan",
  "/response-alerts",
  "/weekly-report",
  "/error-retry",
  "/call-analysis",
  "/schedule-sync",
]);

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isCronExpression(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  const parts = value.trim().split(/\s+/);
  return parts.length === 5 && parts.every((part) => /^[\d*/?,\-]+$/.test(part));
}

/**
 * GET /api/cron-jobs
 * Returns all cron jobs from the database.
 */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const supabase = auth.serviceClient;

  const [{ data, error }, runtime] = await Promise.all([
    supabase
      .from("cron_jobs")
      .select("*")
      .order("created_at", { ascending: true }),
    loadWorkerRuntime(),
  ]);

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch cron jobs" },
      { status: 500 },
    );
  }

  return NextResponse.json({ jobs: data, runtime });
}

async function loadWorkerRuntime(): Promise<unknown | null> {
  try {
    const response = await workerFetch("/cron/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * POST /api/cron-jobs
 * Create a new cron job.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const parsed = await readJsonBody<Record<string, unknown>>(request, 8192);
  if (!parsed.ok) return parsed.response;
  const name = typeof parsed.data.name === "string" ? parsed.data.name.trim() : "";
  const description = typeof parsed.data.description === "string" ? parsed.data.description.trim() : "";
  const schedule = parsed.data.schedule;
  const endpoint = parsed.data.endpoint;

  if (!name || name.length > 120 || description.length > 500) {
    return NextResponse.json(
      { error: "name is required (120 characters maximum); description is limited to 500 characters" },
      { status: 400 },
    );
  }
  if (!isCronExpression(schedule)) {
    return NextResponse.json({ error: "schedule must be a valid five-field cron expression" }, { status: 400 });
  }
  if (typeof endpoint !== "string" || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: "endpoint is not a supported worker job" }, { status: 400 });
  }

  const supabase = auth.serviceClient;

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
      { error: "Failed to create cron job" },
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
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const parsed = await readJsonBody<Record<string, unknown>>(request, 8192);
  if (!parsed.ok) return parsed.response;
  const { id, ...updates } = parsed.data;

  if (!isUuid(id)) {
    return NextResponse.json(
      { error: "id is required" },
      { status: 400 },
    );
  }

  const sanitizedUpdates: Record<string, unknown> = {};
  if ("name" in updates) {
    if (typeof updates.name !== "string" || !updates.name.trim() || updates.name.trim().length > 120) {
      return NextResponse.json({ error: "name must be 1-120 characters" }, { status: 400 });
    }
    sanitizedUpdates.name = updates.name.trim();
  }
  if ("description" in updates) {
    if (typeof updates.description !== "string" || updates.description.length > 500) {
      return NextResponse.json({ error: "description must be at most 500 characters" }, { status: 400 });
    }
    sanitizedUpdates.description = updates.description.trim();
  }
  if ("schedule" in updates) {
    if (!isCronExpression(updates.schedule)) {
      return NextResponse.json({ error: "schedule must be a valid five-field cron expression" }, { status: 400 });
    }
    sanitizedUpdates.schedule = updates.schedule.trim();
  }
  if ("endpoint" in updates) {
    if (typeof updates.endpoint !== "string" || !ALLOWED_ENDPOINTS.has(updates.endpoint)) {
      return NextResponse.json({ error: "endpoint is not a supported worker job" }, { status: 400 });
    }
    sanitizedUpdates.endpoint = updates.endpoint;
  }
  if ("is_active" in updates) {
    if (typeof updates.is_active !== "boolean") {
      return NextResponse.json({ error: "is_active must be a boolean" }, { status: 400 });
    }
    sanitizedUpdates.is_active = updates.is_active;
  }
  if (Object.keys(sanitizedUpdates).length === 0) {
    return NextResponse.json({ error: "No supported changes supplied" }, { status: 400 });
  }
  sanitizedUpdates["updated_at"] = new Date().toISOString();

  const supabase = auth.serviceClient;

  const { data, error } = await supabase
    .from("cron_jobs")
    .update(sanitizedUpdates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to update cron job" },
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
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!isUuid(id)) {
    return NextResponse.json(
      { error: "id query parameter is required" },
      { status: 400 },
    );
  }

  const supabase = auth.serviceClient;

  const { error } = await supabase
    .from("cron_jobs")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete cron job" },
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
    await workerFetch(`${workerUrl}/cron/reload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    // Worker might be down — the scheduler will pick up changes on restart
    console.warn("[API] Failed to notify worker of cron reload");
  }
}
