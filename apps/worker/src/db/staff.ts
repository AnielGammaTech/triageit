import type { SupabaseClient } from "@supabase/supabase-js";
import { withCache } from "../cache/integration-cache.js";

interface StaffMember {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly is_active: boolean;
  readonly halo_agent_id: number | null;
}

/**
 * Get all active staff names (lowercase) — cached for 4 hours.
 * Used to filter out internal staff from customer reply detection.
 */
export async function getStaffNames(supabase: SupabaseClient): Promise<ReadonlyArray<string>> {
  return withCache("staff", "names", async () => {
    const { data } = await supabase
      .from("staff_members")
      .select("name")
      .eq("is_active", true);
    return (data ?? []).map((s) => s.name.toLowerCase());
  }, 14400); // 4 hours
}

/**
 * Get the dispatcher name — cached for 4 hours.
 */
export async function getDispatcherName(supabase: SupabaseClient): Promise<string> {
  return withCache("staff", "dispatcher", async () => {
    const { data } = await supabase
      .from("staff_members")
      .select("name")
      .eq("role", "dispatcher")
      .eq("is_active", true)
      .limit(1)
      .single();
    return data?.name ?? "Bryanna"; // fallback
  }, 14400); // 4 hours
}

/**
 * Get all active staff members — cached for 4 hours.
 */
export async function getStaffMembers(supabase: SupabaseClient): Promise<ReadonlyArray<StaffMember>> {
  return withCache("staff", "all", async () => {
    const { data } = await supabase
      .from("staff_members")
      .select("id, name, role, is_active, halo_agent_id")
      .eq("is_active", true);
    return data ?? [];
  }, 14400);
}

/**
 * Get tech names only — cached for 4 hours.
 */
export async function getTechNames(supabase: SupabaseClient): Promise<ReadonlyArray<string>> {
  return withCache("staff", "tech-names", async () => {
    const { data } = await supabase
      .from("staff_members")
      .select("name")
      .eq("role", "technician")
      .eq("is_active", true);
    return (data ?? []).map((s) => s.name);
  }, 14400);
}
