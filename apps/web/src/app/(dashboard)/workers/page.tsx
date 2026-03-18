"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AGENTS } from "@triageit/shared";
import { cn } from "@/lib/utils/cn";
import { WorkerDetail } from "@/components/workers/worker-detail";

// ── Types ─────────────────────────────────────────────────────────────

interface AgentStats {
  readonly skills_count: number;
  readonly memories_count: number;
  readonly tickets_processed: number;
}

// ── Character Avatars (initials + colors) ─────────────────────────────

const AGENT_COLORS: Record<string, { bg: string; text: string }> = {
  michael_scott: { bg: "bg-amber-500/10", text: "text-amber-400" },
  ryan_howard: { bg: "bg-red-500/10", text: "text-red-400" },
  dwight_schrute: { bg: "bg-yellow-500/10", text: "text-yellow-400" },
  jim_halpert: { bg: "bg-blue-500/10", text: "text-blue-400" },
  pam_beesly: { bg: "bg-pink-500/10", text: "text-pink-400" },
  andy_bernard: { bg: "bg-green-500/10", text: "text-green-400" },
  stanley_hudson: { bg: "bg-purple-500/10", text: "text-purple-400" },
  phyllis_vance: { bg: "bg-rose-500/10", text: "text-rose-400" },
  angela_martin: { bg: "bg-slate-500/10", text: "text-slate-400" },
  oscar_martinez: { bg: "bg-indigo-500/10", text: "text-indigo-400" },
  kevin_malone: { bg: "bg-orange-500/10", text: "text-orange-400" },
  kelly_kapoor: { bg: "bg-fuchsia-500/10", text: "text-fuchsia-400" },
  toby_flenderson: { bg: "bg-stone-500/10", text: "text-stone-400" },
  meredith_palmer: { bg: "bg-teal-500/10", text: "text-teal-400" },
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const MODEL_LABELS: Record<string, { label: string; color: string }> = {
  sonnet: { label: "Sonnet", color: "text-violet-400 bg-violet-500/10" },
  haiku: { label: "Haiku", color: "text-sky-400 bg-sky-500/10" },
};

// ── Main Page ─────────────────────────────────────────────────────────

export default function WorkersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedAgent = searchParams.get("agent");
  const [stats, setStats] = useState<Record<string, AgentStats>>({});

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    const supabase = createClient();

    // Load skill counts per agent
    const { data: skillData } = await supabase
      .from("agent_skills")
      .select("agent_name")
      .eq("is_active", true);

    // Load memory counts per agent
    const { data: memoryData } = await supabase
      .from("agent_memories")
      .select("agent_name");

    // Load ticket counts per agent from logs
    const { data: logData } = await supabase
      .from("agent_logs")
      .select("agent_name")
      .eq("status", "completed");

    const result: Record<string, AgentStats> = {};

    for (const agent of AGENTS) {
      result[agent.name] = {
        skills_count: skillData?.filter((s) => s.agent_name === agent.name).length ?? 0,
        memories_count: memoryData?.filter((m) => m.agent_name === agent.name).length ?? 0,
        tickets_processed: logData?.filter((l) => l.agent_name === agent.name).length ?? 0,
      };
    }

    setStats(result);
  }

  if (selectedAgent) {
    const agent = AGENTS.find((a) => a.name === selectedAgent);
    if (!agent) {
      router.push("/workers");
      return null;
    }

    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-2 text-sm text-white/50">
          <button
            onClick={() => router.push("/workers")}
            className="transition-colors hover:text-white"
          >
            Workers
          </button>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="font-medium text-white">{agent.character}</span>
        </div>
        <WorkerDetail agent={agent} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-400" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Workers</h2>
            <p className="text-sm text-white/50">
              Manage AI triage agents — upload skills, view memories, track performance.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {AGENTS.map((agent) => {
          const agentStats = stats[agent.name];
          const colors = AGENT_COLORS[agent.name] ?? {
            bg: "bg-white/10",
            text: "text-white/60",
          };
          const modelInfo = MODEL_LABELS[agent.model];

          return (
            <button
              key={agent.name}
              onClick={() => router.push(`/workers?agent=${agent.name}`)}
              className="group flex w-full items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-left transition-all hover:border-white/20 hover:bg-white/[0.04]"
            >
              {/* Avatar */}
              <div
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold",
                  colors.bg,
                  colors.text,
                )}
              >
                {getInitials(agent.character)}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white">
                    {agent.character}
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      modelInfo.color,
                    )}
                  >
                    {modelInfo.label}
                  </span>
                  {agent.integration && (
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/30">
                      {agent.integration}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-white/40">
                  {agent.specialty}
                </p>
              </div>

              {/* Stats */}
              <div className="flex shrink-0 items-center gap-4 text-[11px] text-white/30">
                {agentStats && (
                  <>
                    <div className="text-center">
                      <p className="font-semibold text-white/60">
                        {agentStats.skills_count}
                      </p>
                      <p>skills</p>
                    </div>
                    <div className="text-center">
                      <p className="font-semibold text-white/60">
                        {agentStats.memories_count}
                      </p>
                      <p>memories</p>
                    </div>
                    <div className="text-center">
                      <p className="font-semibold text-white/60">
                        {agentStats.tickets_processed}
                      </p>
                      <p>processed</p>
                    </div>
                  </>
                )}
              </div>

              {/* Chevron */}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="shrink-0 text-white/20 transition-colors group-hover:text-white/40"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}
