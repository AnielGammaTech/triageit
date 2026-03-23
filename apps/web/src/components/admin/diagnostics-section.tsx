"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils/cn";

// ── Types ────────────────────────────────────────────────────────────

interface TestResult {
  readonly service: string;
  readonly label: string;
  readonly status: "ok" | "error" | "skipped";
  readonly message: string;
  readonly latency_ms: number | null;
  readonly details?: Record<string, unknown>;
}

// ── Constants ────────────────────────────────────────────────────────

const TEST_GROUPS: ReadonlyArray<{
  readonly title: string;
  readonly services: ReadonlyArray<string>;
}> = [
  { title: "Infrastructure", services: ["supabase", "worker", "redis"] },
  { title: "AI Providers", services: ["claude", "openai"] },
  { title: "Integrations", services: ["halo", "hudu", "datto"] },
];

const STATUS_CONFIG = {
  ok: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
    label: "Healthy",
  },
  error: {
    bg: "bg-red-500/10",
    text: "text-red-400",
    dot: "bg-red-400",
    label: "Error",
  },
  skipped: {
    bg: "bg-white/5",
    text: "text-white/40",
    dot: "bg-white/30",
    label: "Skipped",
  },
} as const;

// ── Component ────────────────────────────────────────────────────────

export function DiagnosticsSection() {
  const [results, setResults] = useState<ReadonlyArray<TestResult>>([]);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const runDiagnostics = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setResults([]);

    try {
      const res = await fetch("/api/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        const data = await res.json();
        setResults(data.results ?? []);
      } else {
        const errData = await res.json().catch(() => ({}));
        setResults([
          {
            service: "diagnostics",
            label: "Diagnostics API",
            status: "error",
            message: (errData as Record<string, string>).error ?? `HTTP ${res.status}`,
            latency_ms: null,
          },
        ]);
      }
      setLastRun(new Date().toLocaleTimeString());
    } catch (err) {
      setResults([
        {
          service: "diagnostics",
          label: "Diagnostics API",
          status: "error",
          message: err instanceof Error ? err.message : String(err),
          latency_ms: null,
        },
      ]);
    } finally {
      setRunning(false);
    }
  }, [running]);

  const getResult = (service: string): TestResult | undefined =>
    results.find((r) => r.service === service);

  const okCount = results.filter((r) => r.status === "ok").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">System Diagnostics</h3>
          <p className="text-sm text-white/50">
            Test all API keys, integrations, and infrastructure connections.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRun && (
            <span className="text-xs text-white/30">Last run: {lastRun}</span>
          )}
          <button
            onClick={runDiagnostics}
            disabled={running}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all",
              running
                ? "cursor-not-allowed bg-white/5 text-white/20"
                : "bg-[#b91c1c] text-white hover:bg-[#a31919]",
            )}
          >
            {running ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                Testing...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
                Run All Tests
              </>
            )}
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {results.length > 0 && (
        <div className={cn(
          "flex items-center gap-3 rounded-xl border px-5 py-3",
          errorCount > 0
            ? "border-red-500/20 bg-red-500/[0.05]"
            : "border-emerald-500/20 bg-emerald-500/[0.05]",
        )}>
          <div className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full",
            errorCount > 0 ? "bg-red-500/20" : "bg-emerald-500/20",
          )}>
            {errorCount > 0 ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <p className={cn("text-sm font-medium", errorCount > 0 ? "text-red-400" : "text-emerald-400")}>
              {errorCount > 0
                ? `${errorCount} service${errorCount > 1 ? "s" : ""} failed`
                : "All services healthy"}
            </p>
            <p className="text-xs text-white/40">
              {okCount} passed · {errorCount} failed · {results.length - okCount - errorCount} skipped
            </p>
          </div>
        </div>
      )}

      {/* Test groups */}
      <div className="space-y-5">
        {TEST_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
              {group.title}
            </p>
            <div className="space-y-2">
              {group.services.map((service) => {
                const result = getResult(service);
                return (
                  <ServiceTestRow
                    key={service}
                    service={service}
                    result={result}
                    running={running}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {results.length === 0 && !running && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-white/20">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          <p className="text-sm text-white/50">
            Click &quot;Run All Tests&quot; to check your API keys and connections.
          </p>
          <p className="mt-1 text-xs text-white/30">
            Tests Supabase, Worker, Redis, AI providers, and all configured integrations.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Service Test Row ─────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  supabase: "Supabase Database",
  worker: "TriageIT Worker",
  redis: "Redis (BullMQ)",
  claude: "Claude (Anthropic)",
  openai: "OpenAI",
  halo: "Halo PSA",
  hudu: "Hudu",
  datto: "Datto RMM",
};

const SERVICE_ICONS: Record<string, string> = {
  supabase: "bg-emerald-500/10",
  worker: "bg-blue-500/10",
  redis: "bg-red-500/10",
  claude: "bg-amber-500/10",
  openai: "bg-green-500/10",
  halo: "bg-indigo-500/10",
  hudu: "bg-emerald-500/10",
  datto: "bg-blue-500/10",
};

function ServiceTestRow({
  service,
  result,
  running,
}: {
  readonly service: string;
  readonly result: TestResult | undefined;
  readonly running: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = result?.label ?? SERVICE_LABELS[service] ?? service;
  const iconBg = SERVICE_ICONS[service] ?? "bg-white/10";

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      <button
        onClick={() => result && setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
      >
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconBg)}>
          <span className="text-xs font-bold text-white/60">
            {label.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">{label}</p>
          {result ? (
            <p className={cn("mt-0.5 text-xs", STATUS_CONFIG[result.status].text)}>
              {result.message}
            </p>
          ) : running ? (
            <p className="mt-0.5 text-xs text-white/30">Testing...</p>
          ) : (
            <p className="mt-0.5 text-xs text-white/20">Not tested yet</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {result?.latency_ms != null && (
            <span className="text-[10px] text-white/20">{result.latency_ms}ms</span>
          )}
          {result ? (
            <span className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold",
              STATUS_CONFIG[result.status].bg,
              STATUS_CONFIG[result.status].text,
            )}>
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", STATUS_CONFIG[result.status].dot)} />
              {STATUS_CONFIG[result.status].label}
            </span>
          ) : running ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-white/40" />
          ) : null}
          {result && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={cn("text-white/20 transition-transform", expanded && "rotate-180")}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          )}
        </div>
      </button>

      {expanded && result && (
        <div className="border-t border-white/5 px-4 py-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/30">Service:</span>
              <span className="font-mono text-white/60">{result.service}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/30">Status:</span>
              <span className={cn("font-medium", STATUS_CONFIG[result.status].text)}>
                {result.status.toUpperCase()}
              </span>
            </div>
            {result.latency_ms != null && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-white/30">Latency:</span>
                <span className="font-mono text-white/60">{result.latency_ms}ms</span>
              </div>
            )}
            {result.details && Object.keys(result.details).length > 0 && (
              <div>
                <p className="mb-1 text-xs text-white/30">Details:</p>
                <pre className="rounded-lg bg-white/5 p-3 text-[11px] text-white/50 overflow-x-auto">
                  {JSON.stringify(result.details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
