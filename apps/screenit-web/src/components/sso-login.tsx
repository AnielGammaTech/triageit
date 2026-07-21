"use client";

import { useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { createAuthClient } from "@/lib/auth/client";

export function SsoLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("next") ?? "/";
    const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
    const supabase = createAuthClient();
    const { error: authError } = await supabase.auth.signInWithSSO({ domain: process.env.NEXT_PUBLIC_SCREENIT_SSO_DOMAIN ?? "gamma.tech", options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
    if (authError) { setError(authError.message); setLoading(false); }
  }

  return <div><button onClick={signIn} disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 text-sm font-bold text-white shadow-sm hover:bg-teal-800 disabled:opacity-50">{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Continue with JumpCloud</button>{error && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}</div>;
}
