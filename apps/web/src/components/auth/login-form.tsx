"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";

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
  const [showPassword, setShowPassword] = useState(false);
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
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="email"
          className="mb-1.5 block text-xs font-semibold text-[#171233]"
        >
          Work email
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-[16px] text-[#171233] transition-shadow placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]/40 sm:text-sm"
            placeholder="you@gamma.tech"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-xs font-semibold text-[#171233]"
        >
          Password
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-10 text-[16px] text-[#171233] transition-shadow placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]/40 sm:text-sm"
            placeholder="Enter your password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-[#171233]"
            tabIndex={-1}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#8b7cff] to-[#6c5ce7] text-sm font-semibold text-white shadow-lg shadow-[#6c5ce7]/25 transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Signing in...
          </>
        ) : (
          <>
            Sign In <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}
