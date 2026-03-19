import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

interface CreateUserBody {
  readonly email: string;
  readonly full_name: string;
  readonly role: "admin" | "manager" | "viewer";
}

interface UpdateRoleBody {
  readonly role: "admin" | "manager" | "viewer";
}

const VALID_ROLES = new Set(["admin", "manager", "viewer"]);

/**
 * GET /api/users
 * Returns all user profiles. Requires admin role.
 */
export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use service client to read all profiles (bypasses RLS)
  const serviceClient = await createServiceClient();

  const { data: callerProfile } = await serviceClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (callerProfile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 });
  }

  const { data, error } = await serviceClient
    .from("profiles")
    .select("id, email, full_name, role, created_at, updated_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data });
}

/**
 * POST /api/users
 * Create a new user via Supabase Auth admin API and set their profile.
 * Requires admin role.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = await createServiceClient();

  const { data: callerProfile } = await serviceClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (callerProfile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 });
  }

  const body = (await request.json()) as CreateUserBody;

  if (!body.email || !body.full_name || !body.role) {
    return NextResponse.json(
      { error: "Missing required fields: email, full_name, role" },
      { status: 400 },
    );
  }

  if (!VALID_ROLES.has(body.role)) {
    return NextResponse.json(
      { error: "Invalid role. Must be: admin, manager, or viewer" },
      { status: 400 },
    );
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  // Create user in Supabase Auth using admin API
  const { data: authData, error: authError } =
    await serviceClient.auth.admin.createUser({
      email: body.email,
      email_confirm: true,
      user_metadata: { full_name: body.full_name },
    });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  // The trigger should auto-create the profile, but update the role
  // since the trigger defaults to 'admin'
  if (authData.user) {
    const { error: profileError } = await serviceClient
      .from("profiles")
      .update({ role: body.role, full_name: body.full_name })
      .eq("id", authData.user.id);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
  }

  // Return the updated profile
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("id, email, full_name, role, created_at, updated_at")
    .eq("id", authData.user.id)
    .single();

  return NextResponse.json({ user: profile }, { status: 201 });
}

/**
 * PATCH /api/users?id=<uuid>
 * Update a user's role. Requires admin role.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing 'id' query parameter" }, { status: 400 });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = await createServiceClient();

  const { data: callerProfile } = await serviceClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (callerProfile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 });
  }

  const body = (await request.json()) as UpdateRoleBody;

  if (!body.role || !VALID_ROLES.has(body.role)) {
    return NextResponse.json(
      { error: "Invalid role. Must be: admin, manager, or viewer" },
      { status: 400 },
    );
  }

  // Prevent demoting yourself
  if (id === user.id && body.role !== "admin") {
    return NextResponse.json(
      { error: "You cannot change your own role" },
      { status: 400 },
    );
  }

  const { data, error } = await serviceClient
    .from("profiles")
    .update({ role: body.role, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, email, full_name, role, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data });
}
