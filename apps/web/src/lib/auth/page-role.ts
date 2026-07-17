import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AUTH_OPERATION_TIMEOUT_MS, withTimeout } from "@/lib/async-timeout";

export type AppRole = "admin" | "manager" | "viewer";

function appRole(value: unknown): AppRole {
  return value === "admin" || value === "manager" || value === "viewer" ? value : "viewer";
}

export async function getAuthenticatedPageUser(): Promise<{
  readonly id: string;
  readonly email: string;
  readonly role: AppRole;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await withTimeout(
    supabase.auth.getUser(),
    AUTH_OPERATION_TIMEOUT_MS,
    "Authentication check",
  );

  if (!user) redirect("/login");

  const { data: profile } = await withTimeout(
    supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle(),
    AUTH_OPERATION_TIMEOUT_MS,
    "Profile check",
  );

  return {
    id: user.id,
    email: user.email ?? "",
    role: appRole(profile?.role),
  };
}

export async function requirePageRole(allowed: ReadonlyArray<AppRole>): Promise<void> {
  const user = await getAuthenticatedPageUser();
  if (!allowed.includes(user.role)) redirect("/tickets");
}
