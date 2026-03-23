"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

/**
 * Record a login event (IP, device, browser) after successful auth.
 * Fire-and-forget — never blocks the login flow.
 */
function recordLoginEvent(userId: string): void {
  fetch("/api/auth/login-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      user_agent: navigator.userAgent,
    }),
  }).catch(() => {
    // Silently ignore — login tracking is best-effort
  });
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      // Record login event (fire-and-forget)
      if (data.user) {
        recordLoginEvent(data.user.id);
      }

      router.refresh();
      router.push("/tickets");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="mb-1 block text-sm font-medium text-white/70"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]"
          placeholder="admin@company.com"
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="mb-1 block text-sm font-medium text-white/70"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]"
          placeholder="Enter your password"
        />
      </div>
      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-[#6366f1] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#5558e6] disabled:opacity-50"
      >
        {loading ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
}
