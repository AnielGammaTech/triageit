import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

interface CreateUserBody {
  readonly email: string;
  readonly full_name: string;
  readonly role: "admin" | "manager" | "viewer";
}

interface UpdateUserBody {
  readonly role?: "admin" | "manager" | "viewer";
  readonly full_name?: string;
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

  const parts = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    special[Math.floor(Math.random() * special.length)],
  ];

  for (let i = 0; i < 8; i++) {
    parts.push(all[Math.floor(Math.random() * all.length)]);
  }

  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }

  return parts.join("");
}

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

interface AdminContext {
  readonly serviceClient: ServiceClient;
  readonly userId: string;
}

/**
 * Verify the caller is an authenticated admin. Returns the service client
 * and user on success, or a NextResponse error on failure.
 */
async function requireAdmin(): Promise<AdminContext | NextResponse> {
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

  return { serviceClient, userId: user.id };
}

/**
 * GET /api/users
 * Returns all user profiles with MFA status and recent login events.
 * Requires admin role.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { serviceClient } = auth;

  // Fetch profiles
  const { data: profiles, error } = await serviceClient
    .from("profiles")
    .select("id, email, full_name, role, created_at, updated_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch MFA factors for all users via admin API
  const userIds = (profiles ?? []).map((p: { id: string }) => p.id);
  const mfaMap: Record<string, boolean> = {};

  // Supabase admin listUsers returns factor info
  // We'll check each user's MFA factors
  for (const uid of userIds) {
    try {
      const { data: factors } = await serviceClient.auth.admin.mfa.listFactors({
        userId: uid,
      });
      const verifiedFactors = (factors?.factors ?? []).filter(
        (f: { status: string }) => f.status === "verified",
      );
      mfaMap[uid] = verifiedFactors.length > 0;
    } catch {
      mfaMap[uid] = false;
    }
  }

  // Fetch recent login events (last 5 per user)
  const { data: loginEvents } = await serviceClient
    .from("login_events")
    .select("id, user_id, ip_address, device_type, browser, os, created_at")
    .in("user_id", userIds)
    .order("created_at", { ascending: false })
    .limit(500);

  // Group login events by user_id (max 5 per user)
  const loginMap: Record<string, ReadonlyArray<Record<string, unknown>>> = {};
  for (const event of loginEvents ?? []) {
    const uid = event.user_id as string;
    const existing = loginMap[uid] ?? [];
    if (existing.length < 5) {
      loginMap[uid] = [...existing, event];
    }
  }

  // Merge data
  const users = (profiles ?? []).map((p: Record<string, unknown>) => ({
    ...p,
    mfa_enabled: mfaMap[p.id as string] ?? false,
    login_events: loginMap[p.id as string] ?? [],
  }));

  return NextResponse.json({ users });
}

/**
 * POST /api/users
 * Create a new user via Supabase Auth admin API and set their profile.
 * Requires admin role.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { serviceClient } = auth;

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

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

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

  if (authData.user) {
    const { error: profileError } = await serviceClient
      .from("profiles")
      .update({ role: body.role, full_name: body.full_name })
      .eq("id", authData.user.id);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
  }

  const { data: profile } = await serviceClient
    .from("profiles")
    .select("id, email, full_name, role, created_at, updated_at")
    .eq("id", authData.user.id)
    .single();

  return NextResponse.json({ user: profile, temp_password: tempPassword }, { status: 201 });
}

/**
 * PATCH /api/users?id=<uuid>
 * Update a user's role and/or name. Requires admin role.
 *
 * PATCH /api/users?id=<uuid>&action=reset-password
 * Reset a user's password. Returns the new temporary password.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing 'id' query parameter" }, { status: 400 });
  }

  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { serviceClient, userId } = auth;

  const action = request.nextUrl.searchParams.get("action");

  // ── Password Reset ──────────────────────────────────────────────────
  if (action === "reset-password") {
    const newPassword = generatePassword();

    const { error: resetError } = await serviceClient.auth.admin.updateUserById(id, {
      password: newPassword,
    });

    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 500 });
    }

    return NextResponse.json({ temp_password: newPassword });
  }

  // ── Update Profile (role / name) ────────────────────────────────────
  const body = (await request.json()) as UpdateUserBody;

  if (body.role && !VALID_ROLES.has(body.role)) {
    return NextResponse.json(
      { error: "Invalid role. Must be: admin, manager, or viewer" },
      { status: 400 },
    );
  }

  // Prevent demoting yourself
  if (id === userId && body.role && body.role !== "admin") {
    return NextResponse.json(
      { error: "You cannot change your own role" },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.role) updates.role = body.role;
  if (body.full_name !== undefined) updates.full_name = body.full_name;

  const { data, error } = await serviceClient
    .from("profiles")
    .update(updates)
    .eq("id", id)
    .select("id, email, full_name, role, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data });
}
