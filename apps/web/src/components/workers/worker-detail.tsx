"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AgentDefinition } from "@triageit/shared";
import { cn } from "@/lib/utils/cn";

// ── Types ─────────────────────────────────────────────────────────────

interface Skill {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly skill_type: string;
  readonly is_active: boolean;
  readonly created_at: string;
}

interface Memory {
  readonly id: string;
  readonly summary: string;
  readonly memory_type: string;
  readonly tags: ReadonlyArray<string>;
  readonly confidence: number;
  readonly times_recalled: number;
  readonly created_at: string;
}

interface WorkerDetailProps {
  readonly agent: AgentDefinition;
}

type Tab = "overview" | "skills" | "memories";

const SKILL_TYPES = [
  { value: "instruction", label: "Instruction" },
  { value: "procedure", label: "Procedure" },
  { value: "runbook", label: "Runbook" },
  { value: "template", label: "Template" },
  { value: "context", label: "Context" },
];

const MEMORY_TYPE_COLORS: Record<string, string> = {
  resolution: "bg-emerald-500/10 text-emerald-400",
  pattern: "bg-blue-500/10 text-blue-400",
  insight: "bg-amber-500/10 text-amber-400",
  escalation: "bg-red-500/10 text-red-400",
  workaround: "bg-purple-500/10 text-purple-400",
};

// ── Main Component ────────────────────────────────────────────────────

export function WorkerDetail({ agent }: WorkerDetailProps) {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [skills, setSkills] = useState<ReadonlyArray<Skill>>([]);
  const [memories, setMemories] = useState<ReadonlyArray<Memory>>([]);
  const [ticketCount, setTicketCount] = useState(0);

  useEffect(() => {
    loadData();
  }, [agent.name]);

  async function loadData() {
    const [skillsRes, memoriesRes, logsRes] = await Promise.all([
      supabase
        .from("agent_skills")
        .select("id, title, content, skill_type, is_active, created_at")
        .eq("agent_name", agent.name)
        .order("created_at", { ascending: false }),
      supabase
        .from("agent_memories")
        .select("id, summary, memory_type, tags, confidence, times_recalled, created_at")
        .eq("agent_name", agent.name)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("agent_logs")
        .select("id", { count: "exact" })
        .eq("agent_name", agent.name)
        .eq("status", "completed"),
    ]);

    setSkills((skillsRes.data ?? []) as ReadonlyArray<Skill>);
    setMemories((memoriesRes.data ?? []) as ReadonlyArray<Memory>);
    setTicketCount(logsRes.count ?? 0);
  }

  return (
    <div className="space-y-6">
      {/* Agent Header */}
      <div
        className="rounded-xl border border-white/10 p-6"
        style={{ backgroundColor: "#1a0f35" }}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-amber-500/10 text-lg font-bold text-amber-400">
            {agent.character
              .split(" ")
              .map((w) => w[0])
              .join("")}
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">
              {agent.character}
            </h3>
            <p className="text-sm text-white/50">{agent.specialty}</p>
            <p className="mt-1 text-xs text-white/30">{agent.description}</p>
          </div>
          <div className="flex gap-6 text-center">
            <div>
              <p className="text-2xl font-bold text-white">{skills.filter((s) => s.is_active).length}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/30">Skills</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{memories.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/30">Memories</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{ticketCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/30">Processed</p>
            </div>
          </div>
        </div>

        {/* Model & Integration badges */}
        <div className="mt-4 flex gap-2">
          <span className={cn(
            "rounded-full px-3 py-1 text-xs font-medium",
            agent.model === "sonnet"
              ? "bg-violet-500/10 text-violet-400"
              : "bg-sky-500/10 text-sky-400",
          )}>
            {agent.model === "sonnet" ? "Claude Sonnet" : "Claude Haiku"}
          </span>
          {agent.integration && (
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/40">
              {agent.integration}
            </span>
          )}
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/40">
            {agent.role}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10">
        {(["overview", "skills", "memories"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium capitalize transition-colors",
              activeTab === tab
                ? "border-b-2 border-[#6366f1] text-white"
                : "text-white/50 hover:text-white",
            )}
          >
            {tab}
            {tab === "skills" && skills.length > 0 && (
              <span className="ml-2 rounded-full bg-[#6366f1]/20 px-2 py-0.5 text-xs text-[#6366f1]">
                {skills.length}
              </span>
            )}
            {tab === "memories" && memories.length > 0 && (
              <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                {memories.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <OverviewTab agent={agent} skills={skills} memories={memories} ticketCount={ticketCount} />
      )}
      {activeTab === "skills" && (
        <SkillsTab agentName={agent.name} skills={skills} onRefresh={loadData} />
      )}
      {activeTab === "memories" && (
        <MemoriesTab memories={memories} onRefresh={loadData} />
      )}
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────

function OverviewTab({
  skills,
  memories,
}: {
  readonly agent: AgentDefinition;
  readonly skills: ReadonlyArray<Skill>;
  readonly memories: ReadonlyArray<Memory>;
  readonly ticketCount: number;
}) {
  const recentMemories = memories.slice(0, 5);
  const topSkills = skills.filter((s) => s.is_active).slice(0, 3);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Recent Skills */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h4 className="mb-3 text-sm font-semibold text-white">Active Skills</h4>
        {topSkills.length === 0 ? (
          <p className="text-xs text-white/30">No skills uploaded yet. Add skills to enhance this agent.</p>
        ) : (
          <div className="space-y-2">
            {topSkills.map((skill) => (
              <div key={skill.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
                <span className="rounded bg-[#6366f1]/20 px-1.5 py-0.5 text-[10px] font-medium text-[#6366f1]">
                  {skill.skill_type}
                </span>
                <p className="truncate text-xs text-white/70">{skill.title}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Memories */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h4 className="mb-3 text-sm font-semibold text-white">Recent Memories</h4>
        {recentMemories.length === 0 ? (
          <p className="text-xs text-white/30">No memories yet. This agent will learn as it processes tickets.</p>
        ) : (
          <div className="space-y-2">
            {recentMemories.map((mem) => (
              <div key={mem.id} className="rounded-lg bg-white/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium",
                    MEMORY_TYPE_COLORS[mem.memory_type] ?? "bg-white/10 text-white/50",
                  )}>
                    {mem.memory_type}
                  </span>
                  <span className="text-[10px] text-white/20">
                    recalled {mem.times_recalled}×
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-white/60">{mem.summary}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Skills Tab ────────────────────────────────────────────────────────

function SkillsTab({
  agentName,
  skills,
  onRefresh,
}: {
  readonly agentName: string;
  readonly skills: ReadonlyArray<Skill>;
  readonly onRefresh: () => void;
}) {
  const supabase = createClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [skillType, setSkillType] = useState("instruction");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);

    await supabase.from("agent_skills").insert({
      agent_name: agentName,
      title: title.trim(),
      content: content.trim(),
      skill_type: skillType,
      is_active: true,
    });

    setTitle("");
    setContent("");
    setSkillType("instruction");
    setShowForm(false);
    setSaving(false);
    onRefresh();
  }

  async function handleToggle(skillId: string, isActive: boolean) {
    await supabase
      .from("agent_skills")
      .update({ is_active: !isActive })
      .eq("id", skillId);
    onRefresh();
  }

  async function handleDelete(skillId: string) {
    await supabase.from("agent_skills").delete().eq("id", skillId);
    onRefresh();
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    setContent(text);
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^/.]+$/, ""));
    }
    setShowForm(true);
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex gap-2">
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-[#6366f1] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5558e6]"
        >
          {showForm ? "Cancel" : "Add Skill"}
        </button>
        <label className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10">
          Upload File
          <input
            type="file"
            accept=".txt,.md,.json"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>
      </div>

      {/* Add skill form */}
      {showForm && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/50">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Password Reset Procedure"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6366f1]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/50">Type</label>
              <select
                value={skillType}
                onChange={(e) => setSkillType(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#6366f1]"
              >
                {SKILL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-white/50">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste the skill content here... (instructions, procedures, runbooks, etc.)"
              rows={8}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6366f1] font-mono"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !content.trim()}
            className="rounded-lg bg-[#6366f1] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5558e6] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Skill"}
          </button>
        </div>
      )}

      {/* Skills list */}
      {skills.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <p className="text-sm text-white/50">
            No skills yet. Upload instructions, procedures, or runbooks to enhance this agent.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className={cn(
                "rounded-xl border border-white/10 p-4 transition-all",
                skill.is_active ? "bg-white/[0.02]" : "bg-white/[0.01] opacity-50",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{skill.title}</p>
                    <span className="rounded bg-[#6366f1]/20 px-1.5 py-0.5 text-[10px] font-medium text-[#6366f1]">
                      {skill.skill_type}
                    </span>
                    {!skill.is_active && (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/30">
                        disabled
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-white/40">
                    {skill.content}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => handleToggle(skill.id, skill.is_active)}
                    className="rounded px-2 py-1 text-xs text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {skill.is_active ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => handleDelete(skill.id)}
                    className="rounded px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Memories Tab ──────────────────────────────────────────────────────

function MemoriesTab({
  memories,
  onRefresh,
}: {
  readonly memories: ReadonlyArray<Memory>;
  readonly onRefresh: () => void;
}) {
  const supabase = createClient();
  const [filterType, setFilterType] = useState<string>("all");

  const filtered =
    filterType === "all"
      ? memories
      : memories.filter((m) => m.memory_type === filterType);

  async function handleDelete(memoryId: string) {
    await supabase.from("agent_memories").delete().eq("id", memoryId);
    onRefresh();
  }

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex gap-2">
        {["all", "resolution", "pattern", "insight", "escalation", "workaround"].map(
          (type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                filterType === type
                  ? "bg-[#6366f1] text-white"
                  : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white",
              )}
            >
              {type}
            </button>
          ),
        )}
      </div>

      {/* Memories list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <p className="text-sm text-white/50">
            {memories.length === 0
              ? "No memories yet. This agent will learn as it processes tickets."
              : "No memories match the selected filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((memory) => (
            <div
              key={memory.id}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        MEMORY_TYPE_COLORS[memory.memory_type] ??
                          "bg-white/10 text-white/50",
                      )}
                    >
                      {memory.memory_type}
                    </span>
                    <span className="text-[10px] text-white/20">
                      {(memory.confidence * 100).toFixed(0)}% confidence
                    </span>
                    <span className="text-[10px] text-white/20">
                      recalled {memory.times_recalled}×
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-white/70">{memory.summary}</p>
                  {memory.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {memory.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/30"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(memory.id)}
                  className="shrink-0 rounded px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
