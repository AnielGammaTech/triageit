"use client";

import { useEffect, useState } from "react";
import { Check, Clock3, Copy, ExternalLink, KeyRound, MonitorUp, RefreshCw, ShieldCheck } from "lucide-react";

interface TvLinkResponse {
  readonly url: string;
  readonly expiresAt: string;
  readonly singleUse: true;
}

function expiryLabel(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  if (seconds === 0) return "Expired";
  const minutes = Math.floor(seconds / 60);
  return `Expires in ${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TvAccessSection() {
  const [link, setLink] = useState<TvLinkResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const expired = link ? new Date(link.expiresAt).getTime() <= now : false;

  async function generateLink() {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/tv/link", { method: "POST", cache: "no-store" });
      const body = (await response.json().catch(() => null)) as (TvLinkResponse & { error?: string }) | null;
      if (!response.ok || !body?.url) {
        throw new Error(body?.error ?? "Could not generate a TV link");
      }
      setLink(body);
      setNow(Date.now());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not generate a TV link");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!link || expired) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard access was blocked. Select and copy the link manually.");
    }
  }

  function openTv() {
    if (!link || expired) return;
    window.open(link.url, "_blank", "noopener");
    setLink(null);
    setCopied(false);
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.015]">
      <div className="flex flex-col gap-4 border-b border-white/[0.08] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300">
            <MonitorUp className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white">Command wallboard access</h2>
            <p className="mt-0.5 break-words text-sm text-white/40">Authorize a TV without exposing the server signing key.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void generateLink()}
          disabled={loading}
          className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          {link ? "Generate replacement" : "Generate one-time link"}
        </button>
      </div>

      <div className="grid border-b border-white/[0.08] sm:grid-cols-3 sm:divide-x sm:divide-white/[0.08]">
        {[
          { icon: KeyRound, label: "Single use", detail: "The link stops working after redemption" },
          { icon: Clock3, label: "15 minute expiry", detail: "Unused links expire automatically" },
          { icon: ShieldCheck, label: "30 day session", detail: "The authorized TV stays signed in" },
        ].map((item) => (
          <div key={item.label} className="flex min-w-0 items-start gap-3 border-t border-white/[0.08] px-5 py-4 first:border-t-0 sm:border-t-0">
            <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-white/35" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-white/75">{item.label}</p>
              <p className="mt-0.5 break-words text-xs leading-5 text-white/35">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="p-5">
        {error ? (
          <div className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-4 py-3 text-sm text-red-200">{error}</div>
        ) : link ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-white/55">One-time TV link</p>
              <span className={`text-xs font-medium ${expired ? "text-red-300" : "text-amber-300"}`}>
                {expiryLabel(link.expiresAt, now)}
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={link.url}
                onFocus={(event) => event.currentTarget.select()}
                aria-label="One-time TV link"
                className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 font-mono text-xs text-white/65 outline-none focus:border-white/25"
              />
              <button
                type="button"
                onClick={() => void copyLink()}
                disabled={expired}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-4 text-sm font-medium text-white/70 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={openTv}
                disabled={expired}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-indigo-400/25 bg-indigo-500/10 px-4 text-sm font-medium text-indigo-200 transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open TV
              </button>
            </div>
            <p className="text-xs text-white/30">Opening the link consumes it. Generate a replacement for another TV.</p>
          </div>
        ) : (
          <div className="flex min-h-28 min-w-0 flex-col items-center justify-center px-2 text-center">
            <KeyRound className="mb-2 h-5 w-5 text-white/25" aria-hidden="true" />
            <p className="text-sm font-medium text-white/60">No active link</p>
            <p className="mt-1 break-words text-xs text-white/30">Generate one when you are ready to authorize the TV.</p>
          </div>
        )}
      </div>
    </div>
  );
}
