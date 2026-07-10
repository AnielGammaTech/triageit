"use client";

import { useState, useEffect, useCallback } from "react";
import { ListChecks, RefreshCw } from "lucide-react";

interface HaloStatus {
  readonly id: number;
  readonly name: string;
  readonly colour: string | null;
  readonly sequence: number | null;
  readonly closed: boolean;
  readonly workflow: string;
  readonly meaning: string;
}

interface Payload {
  readonly statuses: ReadonlyArray<HaloStatus>;
  readonly total: number;
}

export function HaloStatusesSection() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/halo-statuses", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as Payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-white/60">
          <ListChecks className="h-4 w-4 text-sky-400" />
          Every ticket status in Halo and how TriageIt reads it — whether it counts as open or closed,
          and what special handling it gets (paused SLA, re-triage triggers, and so on).
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          Couldn&apos;t load Halo statuses: {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/40">
            <tr>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">ID</th>
              <th className="px-4 py-2.5 font-medium">TriageIt sees</th>
              <th className="px-4 py-2.5 font-medium">What it means</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-white/40">
                  Loading statuses…
                </td>
              </tr>
            ) : (data?.statuses.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-white/40">
                  No statuses returned from Halo.
                </td>
              </tr>
            ) : (
              data!.statuses.map((s, i) => (
                <tr key={s.id} className={`border-t border-white/5 ${i % 2 ? "bg-white/[0.015]" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
                        style={{ backgroundColor: s.colour ?? "#555" }}
                      />
                      <span className="font-medium text-white/90">{s.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-white/40">{s.id}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        s.closed
                          ? "bg-white/10 text-white/50"
                          : "bg-emerald-500/15 text-emerald-400"
                      }`}
                    >
                      {s.closed ? "Closed" : "Open"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{s.meaning}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <p className="text-[11px] text-white/40">
          {data.statuses.filter((s) => !s.closed).length} open · {data.statuses.filter((s) => s.closed).length} closed ·{" "}
          {data.total} total
        </p>
      )}
    </div>
  );
}
