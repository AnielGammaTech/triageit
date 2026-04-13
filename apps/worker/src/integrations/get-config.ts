import type { SupabaseClient } from "@supabase/supabase-js";
import type { HaloConfig } from "@triageit/shared";
import { withCache } from "../cache/integration-cache.js";

/**
 * Fetch the active Halo integration config from Supabase, cached for 1 hour.
 * Returns null if Halo is not configured or inactive.
 */
export async function getCachedHaloConfig(
  supabase: SupabaseClient,
): Promise<HaloConfig | null> {
  return withCache("integration", "halo-config", async () => {
    const { data } = await supabase
      .from("integrations")
      .select("config")
      .eq("service", "halo")
      .eq("is_active", true)
      .single();
    return data ? (data.config as HaloConfig) : null;
  }, 3600);
}
