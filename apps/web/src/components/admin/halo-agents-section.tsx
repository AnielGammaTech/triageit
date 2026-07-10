"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, RefreshCw, AlertTriangle } from "lucide-react";

interface HaloAgent {
  readonly id: number | null;
  readonly name: string;
  readonly jobTitle: string | null;
  readonly team: string | null;
  readonly initials: string | null;
  readonly email: string | null;
  readonly disabled: boolean;
}

interface Payload {
  readonly agents: ReadonlyArray<HaloAgent>;
  readonly total: number;
  readonly missingTitle: number;
}

export function HaloAgentsSection() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/halo-agents", { cache: "no-store" });
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
          <Users className="h-4 w-4 text-emerald-400" />
          Every agent in Halo with their job title and team. This is the roster TriageIt uses to tell
          a technician from an account manager — keep the job titles filled in Halo so it classifies correctly.
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
          Couldn&apos;t load Halo agents: {error}
        </div>
      )}

      {data && data.missingTitle > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {data.missingTitle} active {data.missingTitle === 1 ? "agent has" : "agents have"} no job title set in Halo —
          add one in Halo (Config → Agents) so TriageIt knows their role.
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/40">
            <tr>
              <th className="px-4 py-2.5 font-medium">Agent</th>
              <th className="px-4 py-2.5 font-medium">Job Title</th>
              <th className="px-4 py-2.5 font-medium">Team</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-white/40">
                  Loading agents…
                </td>
              </tr>
            ) : (data?.agents.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-white/40">
                  No agents returned from Halo.
                </td>
              </tr>
            ) : (
              data!.agents.map((a, i) => (
                <tr
                  key={a.id ?? a.name}
                  className={`border-t border-white/5 ${a.disabled ? "opacity-45" : ""} ${i % 2 ? "bg-white/[0.015]" : ""}`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white/70">
                        {a.initials ?? a.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <div className="font-medium text-white/90">{a.name}</div>
                        {a.email && <div className="text-[11px] text-white/40">{a.email}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {a.jobTitle ? (
                      <span className="text-white/80">{a.jobTitle}</span>
                    ) : (
                      <span className="text-amber-400/80">— not set —</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.team ? (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/60">
                        {a.team}
                      </span>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.disabled ? (
                      <span className="text-[11px] text-white/40">Disabled</span>
                    ) : (
                      <span className="text-[11px] text-emerald-400">Active</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <p className="text-[11px] text-white/40">
          {data.agents.filter((a) => !a.disabled).length} active · {data.total} total
        </p>
      )}
    </div>
  );
}
