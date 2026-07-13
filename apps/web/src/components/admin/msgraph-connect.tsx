"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Circle,
  Copy,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface SetupStep {
  readonly key: string;
  readonly label: string;
  readonly status: "pending" | "active" | "done" | "error";
  readonly detail?: string;
}

interface SetupSession {
  readonly id: string;
  readonly status: "awaiting_signin" | "provisioning" | "done" | "error";
  readonly user_code: string;
  readonly verification_uri: string;
  readonly expires_at: string;
  readonly steps: ReadonlyArray<SetupStep>;
  readonly error?: string;
}

interface MsGraphConnectProps {
  readonly onComplete: () => void;
}

const POLL_INTERVAL_MS = 3_000;

/**
 * One-button Microsoft 365 setup: starts a device-code sign-in, shows the
 * code, then renders live progress while the worker provisions the
 * TriageIT Calendar app and grants Calendars.ReadWrite admin consent.
 */
export function MsGraphConnect({ onComplete }: MsGraphConnectProps) {
  const [session, setSession] = useState<SetupSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const completedRef = useRef(false);

  const isRunning =
    session?.status === "awaiting_signin" || session?.status === "provisioning";
  const sessionId = session?.id;

  useEffect(() => {
    if (!sessionId || !isRunning) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/msgraph/setup/status?id=${encodeURIComponent(sessionId)}`,
        );
        if (!res.ok) return;
        const next = (await res.json()) as SetupSession;
        setSession(next);
        if (next.status === "done" && !completedRef.current) {
          completedRef.current = true;
          onComplete();
        }
      } catch {
        // Transient poll failure — keep the last known state and retry.
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [sessionId, isRunning, onComplete]);

  async function handleConnect() {
    setStarting(true);
    setStartError(null);
    setCopied(false);
    completedRef.current = false;
    try {
      const res = await fetch("/api/msgraph/setup/start", { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | (SetupSession & { error?: string })
        | null;
      if (!res.ok || !data?.id) {
        setStartError(data?.error ?? "Could not start Microsoft sign-in");
        return;
      }
      setSession(data);
    } catch (err) {
      setStartError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function handleCopyCode() {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.user_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (non-secure context) — the code is
      // visible on screen either way.
    }
  }

  return (
    <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">One-button setup</p>
          <p className="text-xs text-white/50">
            Sign in once as a Microsoft 365 admin. TriageIT creates its own
            calendar app in your tenant and grants it permission automatically —
            no Azure portal work.
          </p>
        </div>
        {!isRunning && session?.status !== "done" && (
          <button
            onClick={handleConnect}
            disabled={starting}
            className="shrink-0 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-sky-700 disabled:opacity-50"
          >
            {starting
              ? "Starting..."
              : session?.status === "error"
                ? "Try again"
                : "Connect Microsoft 365"}
          </button>
        )}
      </div>

      {startError && (
        <p className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {startError}
        </p>
      )}

      {session && (
        <div className="mt-4 space-y-4">
          {session.status === "awaiting_signin" && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <p className="mb-2 text-xs text-white/50">
                Enter this code at{" "}
                <span className="text-white/80">microsoft.com/devicelogin</span>{" "}
                and sign in with an admin account:
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg border border-white/10 bg-black/30 px-4 py-2 font-mono text-xl font-bold tracking-[0.2em] text-white">
                  {session.user_code}
                </span>
                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy code"}
                </button>
                <a
                  href={session.verification_uri}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-700"
                >
                  <ExternalLink size={14} />
                  Open Microsoft sign-in
                </a>
              </div>
            </div>
          )}

          <ul className="space-y-1.5">
            {session.steps.map((step) => (
              <li key={step.key} className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0">
                  {step.status === "done" ? (
                    <Check size={15} className="text-emerald-400" />
                  ) : step.status === "active" ? (
                    <Loader2 size={15} className="animate-spin text-sky-400" />
                  ) : step.status === "error" ? (
                    <XCircle size={15} className="text-red-400" />
                  ) : (
                    <Circle size={15} className="text-white/20" />
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "text-sm",
                      step.status === "done"
                        ? "text-white/70"
                        : step.status === "active"
                          ? "text-white"
                          : step.status === "error"
                            ? "text-red-400"
                            : "text-white/40",
                    )}
                  >
                    {step.label}
                  </span>
                  {step.detail && (
                    <span className="block truncate text-xs text-white/40">
                      {step.detail}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {session.status === "done" && (
            <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
              Microsoft 365 is connected. The Dispatch Board can now read and
              write tech Outlook calendars.
            </p>
          )}
          {session.status === "error" && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {session.error ?? "Setup failed."} You can try again, or paste app
              credentials manually below (some conditional-access policies block
              device-code sign-in).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
