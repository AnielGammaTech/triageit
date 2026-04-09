"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils/cn";

// ── Types ────────────────────────────────────────────────────────────

interface ActionState {
  readonly loading: boolean;
  readonly result: {
    readonly success: boolean;
    readonly message: string;
  } | null;
  readonly lastRun: string | null;
}

interface HealthAction {
  readonly id: string;
  readonly label: string;
  readonly desc: string;
  readonly endpoint: string;
  readonly buttonLabel: string;
  readonly loadingLabel: string;
  readonly iconColor: string;
  readonly iconBg: string;
}

// ── Constants ────────────────────────────────────────────────────────

const HEALTH_ACTIONS: ReadonlyArray<HealthAction> = [
  {
    id: "sync-tickets",
    label: "Sync Tickets from Halo",
    desc: "Full reconciliation — pulls open tickets, closes resolved ones, catches missed webhooks",
    endpoint: "/api/halo/pull-tickets",
    buttonLabel: "Sync Now",
    loadingLabel: "Syncing...",
    iconColor: "text-indigo-400",
    iconBg: "bg-indigo-500/10",
  },
  {
    id: "diagnostics",
    label: "Run Diagnostics",
    desc: "Test all connections — Supabase, Worker, Redis, Claude, and integrations",
    endpoint: "/api/diagnostics",
    buttonLabel: "Run Tests",
    loadingLabel: "Testing...",
    iconColor: "text-sky-400",
    iconBg: "bg-sky-500/10",
  },
  {
    id: "evict-memories",
    label: "Evict Stale Memories",
    desc: "Garbage-collect old, unused, or low-confidence agent memories",
    endpoint: "/api/admin/health/evict-memories",
    buttonLabel: "Clean Up",
    loadingLabel: "Evicting...",
    iconColor: "text-amber-400",
    iconBg: "bg-amber-500/10",
  },
  {
    id: "toby-analyze",
    label: "Trigger Toby Analysis",
    desc: "Run Toby Flenderson's daily learning analysis — tech profiles, customer insights, trends",
    endpoint: "/api/admin/health/toby-analyze",
    buttonLabel: "Run Toby",
    loadingLabel: "Analyzing...",
    iconColor: "text-purple-400",
    iconBg: "bg-purple-500/10",
  },
];

// ── Icons ────────────────────────────────────────────────────────────

const ICONS: Record<string, React.ReactNode> = {
  "sync-tickets": (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  ),
  diagnostics: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  "evict-memories": (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  ),
  "toby-analyze": (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
};

const SPINNER = (
  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
);

// ── Component ────────────────────────────────────────────────────────

export function HealthSection() {
  const [states, setStates] = useState<Record<string, ActionState>>({});

  const getState = (id: string): ActionState =>
    states[id] ?? { loading: false, result: null, lastRun: null };

  const runAction = useCallback(async (action: HealthAction) => {
    const current = states[action.id];
    if (current?.loading) return;

    setStates((prev) => ({
      ...prev,
      [action.id]: { loading: true, result: null, lastRun: prev[action.id]?.lastRun ?? null },
    }));

    try {
      const res = await fetch(action.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      const success = res.ok && (data as Record<string, unknown>).success !== false;
      const message = (data as Record<string, string>).message
        ?? (data as Record<string, string>).error
        ?? (success ? "Done" : `Failed (${res.status})`);

      setStates((prev) => ({
        ...prev,
        [action.id]: {
          loading: false,
          result: { success, message },
          lastRun: new Date().toLocaleTimeString(),
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      setStates((prev) => ({
        ...prev,
        [action.id]: {
          loading: false,
          result: { success: false, message },
          lastRun: new Date().toLocaleTimeString(),
        },
      }));
    }
  }, [states]);

  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-white">Health & Maintenance</h3>
        <p className="mt-1 text-sm text-white/50">
          System operations, cleanup tasks, and manual triggers.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {HEALTH_ACTIONS.map((action) => {
          const state = getState(action.id);

          return (
            <div
              key={action.id}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-5"
            >
              <div className="flex items-start gap-4">
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", action.iconBg)}>
                  <span className={action.iconColor}>
                    {ICONS[action.id]}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{action.label}</p>
                      <p className="mt-0.5 text-xs text-white/40">{action.desc}</p>
                    </div>

                    <button
                      onClick={() => runAction(action)}
                      disabled={state.loading}
                      className={cn(
                        "flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
                        state.loading
                          ? "cursor-not-allowed bg-white/5 text-white/20"
                          : "bg-[#b91c1c] text-white hover:bg-[#a31919]",
                      )}
                    >
                      {state.loading ? (
                        <>
                          {SPINNER}
                          {action.loadingLabel}
                        </>
                      ) : (
                        action.buttonLabel
                      )}
                    </button>
                  </div>

                  {state.result && (
                    <div
                      className={cn(
                        "mt-3 rounded-lg border px-3 py-2 text-xs",
                        state.result.success
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                          : "border-red-500/20 bg-red-500/10 text-red-400",
                      )}
                    >
                      {state.result.message}
                      {state.lastRun && (
                        <span className="ml-2 text-white/30">at {state.lastRun}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
