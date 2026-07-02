import type { SupabaseClient } from "@supabase/supabase-js";
import { FORMER_STAFF_NAMES } from "@triageit/shared";
import { withCache } from "../cache/integration-cache.js";

interface StaffMember {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly is_active: boolean;
  readonly halo_agent_id: number | null;
}

const FORMER_STAFF_SET = new Set(FORMER_STAFF_NAMES.map((name) => name.toLowerCase()));

function isFormerStaffName(name: string | null | undefined): boolean {
  if (!name) return false;
  return FORMER_STAFF_SET.has(name.toLowerCase());
}

/**
 * Get internal staff names (lowercase) — cached for 4 hours.
 * Used to filter out internal staff from customer reply detection.
 * Former staff stays in this list so old internal notes are not mistaken for customer updates.
 */
export async function getStaffNames(supabase: SupabaseClient): Promise<ReadonlyArray<string>> {
  return withCache("staff", "names", async () => {
    const { data } = await supabase
      .from("staff_members")
      .select("name")
      .eq("is_active", true);
    const activeNames = (data ?? []).map((s) => s.name.toLowerCase());
    return Array.from(new Set([...activeNames, ...FORMER_STAFF_SET]));
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
    return (data ?? []).filter((s) => !isFormerStaffName(s.name));
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
    return (data ?? []).map((s) => s.name).filter((name) => !isFormerStaffName(name));
  }, 14400);
}
