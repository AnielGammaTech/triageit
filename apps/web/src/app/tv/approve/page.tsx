"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MonitorUp, ShieldCheck, TriangleAlert } from "lucide-react";

type ApprovalState = "ready" | "approving" | "approved" | "invalid" | "error";

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || fallback;
}

export default function TvApprovePage() {
  const [requestId, setRequestId] = useState("");
  const [secret, setSecret] = useState("");
  const [state, setState] = useState<ApprovalState>("ready");
  const [error, setError] = useState("");
  const [trustNetwork, setTrustNetwork] = useState(true);
  const [networkTrusted, setNetworkTrusted] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextRequestId = params.get("request") || "";
    const nextSecret = params.get("secret") || "";
    setRequestId(nextRequestId);
    setSecret(nextSecret);
    if (!nextRequestId || !nextSecret) setState("invalid");
  }, []);

  async function approve() {
    if (!requestId || !secret) return;
    setState("approving");
    setError("");
    try {
      const response = await fetch("/api/tv/pairing/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, secret, trustNetwork }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not approve this TV"));
      const result = (await response.json()) as { trustedNetwork?: boolean };
      setNetworkTrusted(result.trustedNetwork === true);
      setState("approved");
      window.history.replaceState({}, "", "/tv/approve");
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "Could not approve this TV");
      setState("error");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080405] px-5 py-10 text-white">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#120a0d] shadow-2xl shadow-black/60">
        <div className="border-b border-white/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10 text-red-300">
              <MonitorUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/35">TriageIT Command</p>
              <h1 className="mt-0.5 text-xl font-bold">Approve office TV</h1>
            </div>
          </div>
        </div>

        <div className="p-6">
          {state === "approved" ? (
            <div className="py-5 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
              <h2 className="mt-4 text-lg font-semibold">TV approved</h2>
              <p className="mt-2 text-sm leading-6 text-white/50">The wallboard will activate automatically within a few seconds. You can close this page.</p>
              {networkTrusted && <p className="mt-3 text-xs font-medium text-emerald-300">This office network is now trusted for automatic TV access.</p>}
            </div>
          ) : state === "invalid" ? (
            <div className="py-5 text-center">
              <TriangleAlert className="mx-auto h-11 w-11 text-amber-300" />
              <h2 className="mt-4 text-lg font-semibold">Invalid QR code</h2>
              <p className="mt-2 text-sm leading-6 text-white/50">Return to the TV and scan its current QR code.</p>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/[0.06] p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-100">TV-only access</p>
                    <p className="mt-1 text-xs leading-5 text-white/45">This approves the command wallboard only. It does not sign your staff account into the TV or expose Adminland.</p>
                  </div>
                </div>
              </div>

              {error && <div className="mt-4 rounded-lg border border-red-400/20 bg-red-500/[0.08] px-4 py-3 text-sm text-red-200">{error}</div>}

              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <input
                  type="checkbox"
                  checked={trustNetwork}
                  onChange={(event) => setTrustNetwork(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-red-600"
                />
                <span>
                  <span className="block text-sm font-semibold text-white/80">Trust this office network</span>
                  <span className="mt-1 block text-xs leading-5 text-white/40">Future TVs on this public IP can open the wallboard automatically without another QR scan.</span>
                </span>
              </label>

              <button
                type="button"
                onClick={() => void approve()}
                disabled={state === "approving" || !requestId || !secret}
                className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-700 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {state === "approving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {state === "approving" ? "Approving TV..." : state === "error" ? "Try approval again" : "Approve this TV"}
              </button>
              <p className="mt-3 text-center text-xs text-white/30">Only approve the TV you are standing in front of.</p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
