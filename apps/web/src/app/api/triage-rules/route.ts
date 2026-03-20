import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

/**
 * GET /api/triage-rules
 * Returns all triage rules ordered by priority then name.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("triage_rules")
    .select("*")
    .order("priority", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }

  return NextResponse.json({ rules: data });
}

/**
 * POST /api/triage-rules
 * Create a new triage rule.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const body = (await request.json()) as {
    name: string;
    description?: string;
    rule_type: string;
    conditions: Record<string, unknown>;
    actions: Record<string, unknown>;
    priority: number;
    is_active: boolean;
  };

  if (!body.name || !body.rule_type || !body.conditions || !body.actions) {
    return NextResponse.json(
      { error: "Missing required fields: name, rule_type, conditions, actions" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("triage_rules")
    .insert({
      name: body.name,
      description: body.description ?? "",
      rule_type: body.rule_type,
      conditions: body.conditions,
      actions: body.actions,
      priority: body.priority ?? 0,
      is_active: body.is_active ?? true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }

  return NextResponse.json({ rule: data }, { status: 201 });
}

/**
 * PATCH /api/triage-rules?id=<uuid>
 * Update an existing triage rule.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing 'id' query parameter" }, { status: 400 });
  }

  const body = (await request.json()) as Partial<{
    name: string;
    description: string;
    rule_type: string;
    conditions: Record<string, unknown>;
    actions: Record<string, unknown>;
    priority: number;
    is_active: boolean;
  }>;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("triage_rules")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }

  return NextResponse.json({ rule: data });
}

/**
 * DELETE /api/triage-rules?id=<uuid>
 * Delete a triage rule.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing 'id' query parameter" }, { status: 400 });
  }

  const supabase = await createClient();

  const { error } = await supabase.from("triage_rules").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
