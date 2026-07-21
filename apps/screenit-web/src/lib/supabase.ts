import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serviceClient: SupabaseClient | null = null;

export function hasScreenItDatabase(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SCREENIT_SUPABASE_URL &&
      process.env.SCREENIT_SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getScreenItServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SCREENIT_SUPABASE_URL;
  const serviceKey = process.env.SCREENIT_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("ScreenIT database credentials are not configured");
  }

  serviceClient ??= createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}
