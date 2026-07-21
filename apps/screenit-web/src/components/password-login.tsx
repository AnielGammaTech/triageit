"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { createAuthClient } from "@/lib/auth/client";

export function PasswordLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createAuthClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (authError) {
      setError(authError.message === "Invalid login credentials" ? "The email or password is incorrect." : authError.message);
      setLoading(false);
      return;
    }
    const requested = new URLSearchParams(window.location.search).get("next") ?? "/";
    const destination = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
    router.push(destination);
    router.refresh();
  }

  return <form onSubmit={signIn} className="space-y-4">
    {error && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <label className="grid gap-1.5 text-xs font-semibold text-slate-700">Email address<span className="relative"><Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@gamma.tech" className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 text-[16px] text-slate-900 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 sm:text-sm" /></span></label>
    <label className="grid gap-1.5 text-xs font-semibold text-slate-700">Password<span className="relative"><LockKeyhole className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-11 text-[16px] text-slate-900 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 sm:text-sm" /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
    <button disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 text-sm font-bold text-white shadow-sm hover:bg-teal-800 disabled:opacity-50">{loading && <LoaderCircle className="h-4 w-4 animate-spin" />}{loading ? "Signing in…" : "Sign in"}</button>
  </form>;
}
