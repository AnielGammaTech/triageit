"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Clock3,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  MonitorUp,
  Network,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

interface GeneratedAccessCode {
  readonly id: string;
  readonly tvUrl: string;
  readonly accessCode: string;
  readonly setupUrl: string;
  readonly expiresAt: string;
  readonly singleUse: true;
}

interface ActiveAccessCode {
  readonly id: string;
  readonly code_hint: string | null;
  readonly created_at: string;
  readonly expires_at: string;
}

interface TrustedIp {
  readonly id: string;
  readonly ip_address: string;
  readonly label: string;
  readonly created_at: string;
}

function expiryLabel(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  if (seconds === 0) return "Expired";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")} remaining`;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function TvAccessSection() {
  const [generated, setGenerated] = useState<GeneratedAccessCode | null>(null);
  const [tvUrl, setTvUrl] = useState("");
  const [activeCodes, setActiveCodes] = useState<ReadonlyArray<ActiveAccessCode>>([]);
  const [trustedIps, setTrustedIps] = useState<ReadonlyArray<TrustedIp>>([]);
  const [currentIp, setCurrentIp] = useState<string | null>(null);
  const [ipDraft, setIpDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingIp, setSavingIp] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const loadAccessState = useCallback(async () => {
    try {
      const [codesResponse, ipsResponse] = await Promise.all([
        fetch("/api/tv/link", { cache: "no-store" }),
        fetch("/api/tv/trusted-ips", { cache: "no-store" }),
      ]);
      if (!codesResponse.ok) throw new Error(await responseError(codesResponse, "Could not load TV access codes"));
      if (!ipsResponse.ok) throw new Error(await responseError(ipsResponse, "Could not load trusted IPs"));

      const codes = (await codesResponse.json()) as { tvUrl: string; links: ReadonlyArray<ActiveAccessCode> };
      const ips = (await ipsResponse.json()) as { currentIp: string | null; trustedIps: ReadonlyArray<TrustedIp> };
      setTvUrl(codes.tvUrl);
      setActiveCodes(codes.links);
      setTrustedIps(ips.trustedIps);
      setCurrentIp(ips.currentIp);
      setIpDraft((existing) => existing || ips.currentIp || "");
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load TV access settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccessState();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [loadAccessState]);

  const generatedExpired = generated ? new Date(generated.expiresAt).getTime() <= now : false;

  async function generateCode() {
    setGenerating(true);
    setError(null);
    setCopiedTarget(null);
    try {
      const response = await fetch("/api/tv/link", { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, "Could not generate an access code"));
      const body = (await response.json()) as GeneratedAccessCode;
      setGenerated(body);
      setTvUrl(body.tvUrl);
      setNow(Date.now());
      await loadAccessState();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not generate an access code");
    } finally {
      setGenerating(false);
    }
  }

  async function copyValue(target: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedTarget(target);
      window.setTimeout(() => setCopiedTarget((current) => (current === target ? null : current)), 2000);
    } catch {
      setError("Clipboard access was blocked. Select and copy the value manually.");
    }
  }

  function openTv() {
    if (!generated || generatedExpired) return;
    window.open(generated.setupUrl, "_blank", "noopener");
    window.setTimeout(() => void loadAccessState(), 1000);
  }

  async function revokeCode(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/tv/link?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "Could not expire the access code"));
      setActiveCodes((codes) => codes.filter((code) => code.id !== id));
      if (generated?.id === id) setGenerated(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not expire the access code");
    } finally {
      setBusyId(null);
    }
  }

  async function trustIp() {
    const ipAddress = ipDraft.trim();
    if (!ipAddress) return;
    setSavingIp(true);
    setError(null);
    try {
      const response = await fetch("/api/tv/trusted-ips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ipAddress, label: "Office TV network" }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not trust that IP address"));
      await loadAccessState();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not trust that IP address");
    } finally {
      setSavingIp(false);
    }
  }

  async function removeTrustedIp(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/tv/trusted-ips?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "Could not remove that trusted IP"));
      setTrustedIps((ips) => ips.filter((ip) => ip.id !== id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not remove that trusted IP");
    } finally {
      setBusyId(null);
    }
  }

  const copyIcon = (target: string) => (
    copiedTarget === target
      ? <Check className="h-4 w-4 text-emerald-300" aria-hidden="true" />
      : <Copy className="h-4 w-4" aria-hidden="true" />
  );

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.015]">
      <div className="flex flex-col gap-4 border-b border-white/[0.08] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300">
            <MonitorUp className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white">Command wallboard access</h2>
            <p className="mt-0.5 break-words text-sm text-white/40">Authorize TVs, expire unused codes, and manage the office network.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void generateCode()}
          disabled={generating}
          className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
        >
          <RefreshCw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} aria-hidden="true" />
          Generate one-time code
        </button>
      </div>

      <div className="grid border-b border-white/[0.08] sm:grid-cols-3 sm:divide-x sm:divide-white/[0.08]">
        {[
          { icon: KeyRound, label: "Single use", detail: "A code stops working after redemption" },
          { icon: Clock3, label: "15 minute expiry", detail: "Unused codes expire automatically" },
          { icon: ShieldCheck, label: "Revoke anytime", detail: "Expire any active code immediately" },
        ].map((item) => (
          <div key={item.label} className="flex min-w-0 items-start gap-3 border-t border-white/[0.08] px-5 py-4 first:border-t-0 sm:border-t-0">
            <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-white/35" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white/75">{item.label}</p>
              <p className="mt-0.5 break-words text-xs leading-5 text-white/35">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="m-5 mb-0 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      <section className="border-b border-white/[0.08] p-5">
        <div className="mb-3 flex items-center gap-2">
          <Link2 className="h-4 w-4 text-white/35" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-white/75">TV address</h3>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            value={loading ? "Loading..." : tvUrl}
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Public TV address"
            className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 font-mono text-xs text-white/65 outline-none focus:border-white/25"
          />
          <button
            type="button"
            onClick={() => void copyValue("tv-url", tvUrl)}
            disabled={!tvUrl}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-4 text-sm font-medium text-white/70 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-40"
          >
            {copyIcon("tv-url")}
            Copy address
          </button>
        </div>
        <p className="mt-2 text-xs text-white/30">Open this address on the TV. Trusted office IPs activate automatically; other TVs display a QR approval code.</p>
      </section>

      <section className="border-b border-white/[0.08] p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-white/35" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-white/75">New access code</h3>
          </div>
          {generated && (
            <span className={`text-xs font-medium ${generatedExpired ? "text-red-300" : "text-amber-300"}`}>
              {expiryLabel(generated.expiresAt, now)}
            </span>
          )}
        </div>

        {generated ? (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-xs text-white/35">One-time access code</span>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={generated.accessCode}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-11 min-w-0 flex-1 rounded-lg border border-indigo-400/20 bg-indigo-500/[0.07] px-3 text-center font-mono text-lg font-semibold tracking-widest text-indigo-100 outline-none focus:border-indigo-400/40"
                />
                <button
                  type="button"
                  onClick={() => void copyValue("access-code", generated.accessCode)}
                  disabled={generatedExpired}
                  aria-label="Copy access code"
                  title="Copy access code"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-white/65 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-40"
                >
                  {copyIcon("access-code")}
                </button>
              </div>
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void copyValue("setup-link", generated.setupUrl)}
                disabled={generatedExpired}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-4 text-sm font-medium text-white/70 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-40"
              >
                {copyIcon("setup-link")}
                Copy full setup link
              </button>
              <button
                type="button"
                onClick={openTv}
                disabled={generatedExpired}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-indigo-400/25 bg-indigo-500/10 px-4 text-sm font-medium text-indigo-200 transition hover:bg-indigo-500/20 disabled:opacity-40"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open TV
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-20 flex-col items-center justify-center rounded-lg border border-dashed border-white/10 text-center">
            <p className="text-sm font-medium text-white/55">No new code displayed</p>
            <p className="mt-1 text-xs text-white/30">Generate a code when the TV is ready.</p>
          </div>
        )}
      </section>

      <section className="border-b border-white/[0.08] p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white/75">Active access codes</h3>
            <p className="mt-0.5 text-xs text-white/30">Only unused, unexpired codes appear here.</p>
          </div>
          <span className="text-xs text-white/35">{activeCodes.length} active</span>
        </div>
        <div className="divide-y divide-white/[0.07] overflow-hidden rounded-lg border border-white/[0.08]">
          {activeCodes.length ? activeCodes.map((code) => (
            <div key={code.id} className="flex min-w-0 items-center gap-3 px-3 py-3">
              <KeyRound className="h-4 w-4 shrink-0 text-amber-300/70" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-medium text-white/70">XXXX-{code.code_hint ?? "XXXX"}</p>
                <p className="mt-0.5 text-xs text-white/30">{expiryLabel(code.expires_at, now)}</p>
              </div>
              <button
                type="button"
                onClick={() => void revokeCode(code.id)}
                disabled={busyId === code.id}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 text-xs font-medium text-red-200 transition hover:bg-red-500/15 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Expire now
              </button>
            </div>
          )) : (
            <div className="px-4 py-5 text-center text-xs text-white/30">No active access codes.</div>
          )}
        </div>
      </section>

      <section className="p-5">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300">
            <Network className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white/75">Trusted office IPs</h3>
            <p className="mt-0.5 text-xs leading-5 text-white/35">Automatically authorizes the wallboard on this public IP and keeps its TV-only device session renewed. Only trust controlled office networks.</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={ipDraft}
            onChange={(event) => setIpDraft(event.target.value)}
            placeholder="Public IP address"
            aria-label="Trusted public IP address"
            className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 font-mono text-xs text-white/65 outline-none placeholder:text-white/25 focus:border-white/25"
          />
          <button
            type="button"
            onClick={() => void trustIp()}
            disabled={savingIp || !ipDraft.trim()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-4 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Trust IP
          </button>
        </div>
        {currentIp && <p className="mt-2 text-xs text-white/30">Detected for this browser: <span className="font-mono text-white/45">{currentIp}</span></p>}

        {trustedIps.length > 0 && (
          <div className="mt-4 divide-y divide-white/[0.07] overflow-hidden rounded-lg border border-white/[0.08]">
            {trustedIps.map((ip) => (
              <div key={ip.id} className="flex min-w-0 items-center gap-3 px-3 py-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-white/70">{ip.ip_address}</p>
                  <p className="mt-0.5 text-xs text-white/30">{ip.label}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeTrustedIp(ip.id)}
                  disabled={busyId === ip.id}
                  aria-label={`Remove trusted IP ${ip.ip_address}`}
                  title="Remove trusted IP"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/35 transition hover:bg-red-500/10 hover:text-red-200 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
