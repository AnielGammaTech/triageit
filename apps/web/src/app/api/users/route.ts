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
 * Generate a secure random password for new users.
 */
function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*";
  const all = upper + lower + digits + special;

  // Ensure at least one of each type
  const parts = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    special[Math.floor(Math.random() * special.length)],
  ];

  // Fill remaining 8 chars randomly
  for (let i = 0; i < 8; i++) {
    parts.push(all[Math.floor(Math.random() * all.length)]);
  }

  // Shuffle
  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }

  return parts.join("");
}

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

  // Create user in Supabase Auth with a generated temporary password
  const tempPassword = generatePassword();

  const { data: authData, error: authError } =
    await serviceClient.auth.admin.createUser({
      email: body.email,
      password: tempPassword,
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

  return NextResponse.json({ user: profile, temp_password: tempPassword }, { status: 201 });
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
