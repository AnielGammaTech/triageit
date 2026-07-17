import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  AUTH_OPERATION_TIMEOUT_MS,
  OperationTimeoutError,
  withTimeout,
} from "@/lib/async-timeout";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

interface AdminContext {
  readonly serviceClient: ServiceClient;
  readonly user: {
    readonly id: string;
    readonly email?: string;
  };
}

/**
 * Require the signed-in user to have the admin role in profiles.
 * Use this before any route that writes with the Supabase service key.
 */
export async function requireAdmin(): Promise<
  | AdminContext
  | { readonly error: NextResponse }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await withTimeout(
      supabase.auth.getUser(),
      AUTH_OPERATION_TIMEOUT_MS,
      "Authentication check",
    );

    if (error || !user) {
      return {
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    const serviceClient = await createServiceClient();
    const { data: callerProfile } = await withTimeout(
      serviceClient
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single(),
      AUTH_OPERATION_TIMEOUT_MS,
      "Admin profile check",
    );

    if (callerProfile?.role !== "admin") {
      return {
        error: NextResponse.json(
          { error: "Forbidden: admin role required" },
          { status: 403 },
        ),
      };
    }

    return {
      serviceClient,
      user: { id: user.id, email: user.email ?? undefined },
    };
  } catch (error) {
    return {
      error: NextResponse.json(
        {
          error: error instanceof OperationTimeoutError
            ? "Authentication service timed out"
            : "Authentication failed",
        },
        { status: error instanceof OperationTimeoutError ? 503 : 401 },
      ),
    };
  }
}
