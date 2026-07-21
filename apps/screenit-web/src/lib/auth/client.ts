"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createAuthClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
