import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

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
