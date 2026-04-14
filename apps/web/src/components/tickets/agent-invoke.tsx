"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils/cn";

// ── Types ───────────────────────────────────────────────────────────

interface AgentInvokeProps {
  readonly haloId: number;
  readonly ticketId: string;
}

interface AgentOption {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly color: string;
}

interface AgentResultData {
  readonly agent_name: string;
  readonly summary: string;
  readonly data: Record<string, unknown>;
  readonly confidence: number;
}

// ── Constants ───────────────────────────────────────────────────────

const AGENTS: ReadonlyArray<AgentOption> = [
  { id: "dwight_schrute", name: "Dwight Schrute", role: "Hudu", color: "emerald" },
  { id: "jim_halpert", name: "Jim Halpert", role: "JumpCloud", color: "violet" },
  { id: "andy_bernard", name: "Andy Bernard", role: "Datto", color: "cyan" },
  { id: "angela_martin", name: "Angela Martin", role: "Security", color: "red" },
  { id: "kelly_kapoor", name: "Kelly Kapoor", role: "3CX", color: "fuchsia" },
  { id: "stanley_hudson", name: "Stanley Hudson", role: "Vultr", color: "sky" },
  { id: "phyllis_vance", name: "Phyllis Vance", role: "Email/DNS", color: "orange" },
  { id: "meredith_palmer", name: "Meredith Palmer", role: "Spanning", color: "purple" },
  { id: "oscar_martinez", name: "Oscar Martinez", role: "Cove", color: "teal" },
  { id: "darryl_philbin", name: "Darryl Philbin", role: "CIPP", color: "blue" },
  { id: "creed_bratton", name: "Creed Bratton", role: "UniFi", color: "sky" },
  { id: "holly_flax", name: "Holly Flax", role: "Pax8", color: "pink" },
  { id: "pam_beesly", name: "Pam Beesly", role: "Docs", color: "rose" },
];

const AGENT_BG: Record<string, string> = {
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  cyan: "bg-cyan-500",
  red: "bg-red-500",
  fuchsia: "bg-fuchsia-500",
  sky: "bg-sky-500",
  orange: "bg-orange-500",
  purple: "bg-purple-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  pink: "bg-pink-500",
  rose: "bg-rose-500",
};

// ── Icons ───────────────────────────────────────────────────────────

function ChevronDownIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CloseIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function UsersIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// ── Component ───────────────────────────────────────────────────────

export function AgentInvoke({ haloId, ticketId }: AgentInvokeProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResultData | null>(null);

  const selectedOption = AGENTS.find((a) => a.id === selectedAgent) ?? null;

  const handleRun = useCallback(async () => {
    if (!selectedAgent || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/agent/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          halo_id: haloId,
          agent_name: selectedAgent,
          prompt: prompt.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const message = typeof data?.error === "string"
          ? data.error
          : "Agent invocation failed. Please try again.";
        setError(message);
        return;
      }

      setResult({
        agent_name: data.agent_name ?? selectedAgent,
        summary: data.summary ?? "No summary returned.",
        data: data.data ?? {},
        confidence: data.confidence ?? 0,
      });
    } catch {
      setError("Network error — could not reach the server. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [haloId, selectedAgent, prompt, loading]);

  const handleClear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const agentInitials = (name: string): string =>
    name.split(" ").map((w) => w[0]).join("").slice(0, 2);

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-2">
          <UsersIcon className="h-3.5 w-3.5 text-indigo-400" />
          <span className="text-xs font-semibold text-white/70">Run Specialist Agent</span>
          {loading && (
            <div className="h-2.5 w-2.5 animate-spin rounded-full border border-indigo-400/30 border-t-indigo-400" />
          )}
        </div>
        <ChevronDownIcon
          className={cn(
            "h-3.5 w-3.5 text-white/30 transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* Expandable body */}
      {expanded && (
        <div className="border-t border-white/5 px-4 pb-4 pt-3 space-y-3">
          {/* Agent selector */}
          <div>
            <label htmlFor={`agent-select-${ticketId}`} className="block text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1.5">
              Select Agent
            </label>
            <select
              id={`agent-select-${ticketId}`}
              value={selectedAgent}
              onChange={(e) => {
                setSelectedAgent(e.target.value);
                setError(null);
              }}
              disabled={loading}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 outline-none focus:border-white/20 disabled:opacity-50 appearance-none cursor-pointer"
            >
              <option value="" className="bg-[#1a1a2e]">-- Choose an agent --</option>
              {AGENTS.map((agent) => (
                <option key={agent.id} value={agent.id} className="bg-[#1a1a2e]">
                  {agent.name} — {agent.role}
                </option>
              ))}
            </select>
          </div>

          {/* Selected agent badge */}
          {selectedOption && (
            <div className="flex items-center gap-2">
              <div className={cn("h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white", AGENT_BG[selectedOption.color] ?? "bg-indigo-500")}>
                {agentInitials(selectedOption.name)}
              </div>
              <span className="text-xs text-white/50">{selectedOption.name}</span>
              <span className="text-[10px] text-white/30">{selectedOption.role}</span>
            </div>
          )}

          {/* Prompt input */}
          <div>
            <label htmlFor={`agent-prompt-${ticketId}`} className="block text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1.5">
              Prompt (optional)
            </label>
            <input
              id={`agent-prompt-${ticketId}`}
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={loading}
              placeholder="Ask the agent something specific..."
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 placeholder-white/20 outline-none focus:border-white/20 disabled:opacity-50"
            />
          </div>

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={!selectedAgent || loading}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium transition-colors",
              !selectedAgent || loading
                ? "cursor-not-allowed bg-white/5 text-white/20"
                : "bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25",
            )}
          >
            {loading ? (
              <>
                <div className="h-3 w-3 animate-spin rounded-full border border-indigo-400/30 border-t-indigo-400" />
                Running...
              </>
            ) : (
              "Run Agent"
            )}
          </button>

          {/* Error display */}
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400/60 mb-1">Error</p>
              <p className="text-xs text-red-300/80">{error}</p>
            </div>
          )}

          {/* Result display */}
          {result && (
            <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/[0.03] p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={cn("h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white", AGENT_BG[selectedOption?.color ?? ""] ?? "bg-indigo-500")}>
                    {agentInitials(AGENTS.find((a) => a.id === result.agent_name)?.name ?? result.agent_name)}
                  </div>
                  <span className="text-xs font-semibold text-indigo-400">
                    {AGENTS.find((a) => a.id === result.agent_name)?.name ?? result.agent_name}
                  </span>
                  <span className="text-[10px] text-indigo-400/40">
                    Confidence: {(result.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <button
                  onClick={handleClear}
                  className="text-white/20 hover:text-white/40 transition-colors"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">
                {result.summary}
              </div>
              {result.data && Object.keys(result.data).length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[10px] text-indigo-400/40 hover:text-indigo-400/60">
                    Show raw data
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-black/20 p-3 text-[10px] text-white/40">
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
