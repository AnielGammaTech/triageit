import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createAuthServerClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => cookieStore.getAll(), setAll: (items: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } });
}
