"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { IntegrationItem } from "./adminland-constants";

interface Suggestion {
  readonly integration_id: string;
  readonly service: string;
  readonly display_name: string;
  readonly external_id: string;
  readonly external_name: string;
  readonly halo_id: string;
  readonly halo_name: string;
  readonly confidence: number;
  readonly match_type: "exact" | "normalized" | "fuzzy";
}

interface Unmatched {
  readonly integration_id: string;
  readonly service: string;
  readonly display_name: string;
  readonly external_id: string;
  readonly external_name: string;
}

interface AutoMapperConfigProps {
  readonly item: IntegrationItem;
  readonly onBack: () => void;
}

export function AutoMapperConfig({ item, onBack }: AutoMapperConfigProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ReadonlyArray<Suggestion>>([]);
  const [unmatched, setUnmatched] = useState<ReadonlyArray<Unmatched>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [approvedCount, setApprovedCount] = useState(0);
  const [stats, setStats] = useState<{
    halo_customer_count: number;
    integration_count: number;
  } | null>(null);

  async function runAutoMapper() {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setUnmatched([]);
    setSelected(new Set());

    try {
      const res = await fetch("/api/integrations/automapper", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "AutoMapper failed");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setUnmatched(data.unmatched ?? []);
      setStats({
        halo_customer_count: data.halo_customer_count,
        integration_count: data.integration_count,
      });

      // Auto-select exact and normalized matches
      const autoSelect = new Set<string>();
      for (const s of data.suggestions ?? []) {
        if (s.match_type === "exact" || s.match_type === "normalized") {
          autoSelect.add(`${s.integration_id}:${s.external_id}`);
        }
      }
      setSelected(autoSelect);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  function toggleSelection(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(
      new Set(suggestions.map((s) => `${s.integration_id}:${s.external_id}`)),
    );
  }

  function deselectAll() {
    setSelected(new Set());
  }

  async function approveSelected() {
    const toApprove = suggestions.filter((s) =>
      selected.has(`${s.integration_id}:${s.external_id}`),
    );
    if (toApprove.length === 0) return;

    setApproving(true);
    try {
      const res = await fetch("/api/integrations/automapper", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mappings: toApprove.map((s) => ({
            integration_id: s.integration_id,
            service: s.service,
            external_id: s.external_id,
            external_name: s.external_name,
            halo_id: s.halo_id,
            halo_name: s.halo_name,
          })),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setApprovedCount((prev) => prev + data.approved);
        // Remove approved from suggestions
        setSuggestions((prev) =>
          prev.filter((s) => !selected.has(`${s.integration_id}:${s.external_id}`)),
        );
        setSelected(new Set());
      } else {
        const data = await res.json();
        setError(data.error ?? "Failed to approve mappings");
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setApproving(false);
  }

  const matchTypeStyle = {
    exact: "bg-emerald-500/20 text-emerald-400",
    normalized: "bg-blue-500/20 text-blue-400",
    fuzzy: "bg-amber-500/20 text-amber-400",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/5 hover:text-white"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", item.iconBg)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={item.iconColor}>
            <path d="M8 3H5a2 2 0 00-2 2v3" />
            <path d="M21 8V5a2 2 0 00-2-2h-3" />
            <path d="M3 16v3a2 2 0 002 2h3" />
            <path d="M16 21h3a2 2 0 002-2v-3" />
            <path d="M12 8v8" />
            <path d="M8 12h8" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">{item.label}</h3>
          <p className="text-sm text-white/50">{item.desc}</p>
        </div>
      </div>

      {/* Description */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/70 leading-relaxed">
        AutoMapper fetches customer lists from all connected integrations and matches them
        against your Halo PSA customers by name. It uses exact, normalized (strips Inc/LLC/etc),
        and fuzzy matching. Review the suggestions below and approve the ones that look correct.
      </div>

      {/* Run button */}
      <button
        onClick={runAutoMapper}
        disabled={loading}
        className="flex items-center gap-2 rounded-lg bg-[#b91c1c] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#a31919] disabled:opacity-50"
      >
        {loading ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Scanning integrations...
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            Run AutoMapper
          </>
        )}
      </button>

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* Stats */}
      {stats && (
        <div className="flex gap-4">
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-2xl font-bold text-white">{stats.halo_customer_count}</p>
            <p className="text-xs text-white/50">Halo customers</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-2xl font-bold text-white">{stats.integration_count}</p>
            <p className="text-xs text-white/50">Integrations scanned</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-2xl font-bold text-emerald-400">{suggestions.length}</p>
            <p className="text-xs text-white/50">Matches found</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-2xl font-bold text-amber-400">{unmatched.length}</p>
            <p className="text-xs text-white/50">Unmatched</p>
          </div>
          {approvedCount > 0 && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
              <p className="text-2xl font-bold text-emerald-400">{approvedCount}</p>
              <p className="text-xs text-emerald-400/70">Approved</p>
            </div>
          )}
        </div>
      )}

      {/* Suggestions table */}
      {suggestions.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-medium text-white/70">
              Suggested Mappings
              <span className="ml-2 text-xs text-white/30">
                {selected.size} of {suggestions.length} selected
              </span>
            </h4>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white"
              >
                Select All
              </button>
              <button
                onClick={deselectAll}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white"
              >
                Deselect All
              </button>
              <button
                onClick={approveSelected}
                disabled={selected.size === 0 || approving}
                className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
              >
                {approving
                  ? "Approving..."
                  : `Approve ${selected.size} mapping${selected.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.size === suggestions.length}
                      onChange={() =>
                        selected.size === suggestions.length
                          ? deselectAll()
                          : selectAll()
                      }
                      className="h-3.5 w-3.5 rounded border-white/30 bg-white/10"
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-white/50">
                    Integration
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-white/50">
                    External Customer
                  </th>
                  <th className="px-4 py-2.5 text-center font-medium text-white/50">
                    Match
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-white/50">
                    Halo Customer
                  </th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => {
                  const key = `${s.integration_id}:${s.external_id}`;
                  const isSelected = selected.has(key);
                  return (
                    <tr
                      key={key}
                      onClick={() => toggleSelection(key)}
                      className={cn(
                        "border-b border-white/5 transition-colors cursor-pointer",
                        isSelected
                          ? "bg-[#b91c1c]/5"
                          : "hover:bg-white/5",
                      )}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelection(key)}
                          className="h-3.5 w-3.5 rounded border-white/30 bg-white/10"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/60">
                          {s.display_name}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-white">{s.external_name}</p>
                        <p className="text-xs text-white/30">ID: {s.external_id}</p>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            matchTypeStyle[s.match_type],
                          )}
                        >
                          {s.confidence}%
                          <span className="text-[10px] opacity-70">
                            {s.match_type}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-white/70">{s.halo_name}</p>
                        <p className="text-xs text-white/30">ID: {s.halo_id}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Unmatched */}
      {unmatched.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-white/70">
            Unmatched Customers
            <span className="ml-2 text-xs text-white/30">
              {unmatched.length} — map these manually in each integration
            </span>
          </h4>
          <div className="max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.02] p-2">
            {unmatched.map((u) => (
              <div
                key={`${u.integration_id}:${u.external_id}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/5"
              >
                <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/50">
                  {u.display_name}
                </span>
                <span className="text-sm text-white/70">{u.external_name}</span>
                <span className="text-xs text-white/20">#{u.external_id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
