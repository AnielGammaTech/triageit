import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Require authenticated user for API routes.
 * Returns the authenticated user or a 401 response.
 *
 * Usage:
 *   const auth = await requireAuth();
 *   if (auth.error) return auth.error;
 *   const { user } = auth;
 */
export async function requireAuth(): Promise<
  | { readonly user: { readonly id: string; readonly email?: string }; readonly error?: never }
  | { readonly user?: never; readonly error: NextResponse }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return {
        error: NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 },
        ),
      };
    }

    return { user: { id: user.id, email: user.email ?? undefined } };
  } catch {
    return {
      error: NextResponse.json(
        { error: "Authentication failed" },
        { status: 401 },
      ),
    };
  }
}
