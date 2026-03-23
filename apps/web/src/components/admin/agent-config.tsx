"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { AGENTS } from "@triageit/shared";
import { cn } from "@/lib/utils/cn";

// ── Provider & Model Types ──────────────────────────────────────────

type Provider = "claude" | "openai" | "moonshot";

interface ModelDef {
  readonly id: string;
  readonly provider: Provider;
  readonly label: string;
  readonly tier: "high" | "mid" | "fast";
  readonly color: string;
}

const ALL_MODELS: ReadonlyArray<ModelDef> = [
  // Claude
  { id: "claude-opus-4", provider: "claude", label: "Claude Opus 4", tier: "high", color: "bg-purple-500" },
  { id: "claude-sonnet-4", provider: "claude", label: "Claude Sonnet 4", tier: "mid", color: "bg-blue-500" },
  { id: "claude-haiku-4.5", provider: "claude", label: "Claude Haiku 4.5", tier: "fast", color: "bg-emerald-500" },
  // OpenAI
  { id: "gpt-4o", provider: "openai", label: "GPT-4o", tier: "high", color: "bg-green-500" },
  { id: "gpt-4o-mini", provider: "openai", label: "GPT-4o Mini", tier: "mid", color: "bg-lime-500" },
  { id: "o3-mini", provider: "openai", label: "o3-mini", tier: "fast", color: "bg-teal-500" },
  // Moonshot Kimi
  { id: "moonshot-v1-128k", provider: "moonshot", label: "Kimi 128K", tier: "high", color: "bg-indigo-500" },
  { id: "moonshot-v1-32k", provider: "moonshot", label: "Kimi 32K", tier: "mid", color: "bg-violet-500" },
  { id: "moonshot-v1-8k", provider: "moonshot", label: "Kimi 8K", tier: "fast", color: "bg-fuchsia-500" },
];

const PROVIDER_INFO: Record<Provider, { label: string; color: string; icon: string }> = {
  claude: { label: "Claude (Anthropic)", color: "bg-orange-500/20 text-orange-400", icon: "A" },
  openai: { label: "OpenAI", color: "bg-green-500/20 text-green-400", icon: "O" },
  moonshot: { label: "Moonshot Kimi", color: "bg-indigo-500/20 text-indigo-400", icon: "K" },
};

// ── Agent Override Types ────────────────────────────────────────────

interface AgentOverride {
  readonly primary_model: string;
  readonly secondary_model: string;
  readonly tertiary_model: string;
  readonly enabled: boolean;
  readonly temperature: number;
  readonly max_tokens: number;
  readonly custom_instructions: string;
}

type AgentOverrides = Record<string, AgentOverride>;

const ROLE_COLORS: Record<string, string> = {
  manager: "bg-amber-500/20 text-amber-400",
  classifier: "bg-blue-500/20 text-blue-400",
  documentation: "bg-emerald-500/20 text-emerald-400",
  identity: "bg-violet-500/20 text-violet-400",
  communications: "bg-pink-500/20 text-pink-400",
  endpoint: "bg-cyan-500/20 text-cyan-400",
  cloud: "bg-sky-500/20 text-sky-400",
  dns_email: "bg-orange-500/20 text-orange-400",
  security: "bg-red-500/20 text-red-400",
  reporting: "bg-indigo-500/20 text-indigo-400",
  patches: "bg-teal-500/20 text-teal-400",
  notifications: "bg-rose-500/20 text-rose-400",
  compliance: "bg-gray-500/20 text-gray-400",
  legacy: "bg-yellow-500/20 text-yellow-400",
};

const DEFAULT_MODELS: Record<string, { primary: string; secondary: string; tertiary: string }> = {
  manager: { primary: "claude-opus-4", secondary: "claude-sonnet-4", tertiary: "gpt-4o" },
  classifier: { primary: "claude-haiku-4.5", secondary: "gpt-4o-mini", tertiary: "moonshot-v1-8k" },
  _default: { primary: "claude-sonnet-4", secondary: "claude-haiku-4.5", tertiary: "gpt-4o-mini" },
};

function getDefaultOverride(agent: (typeof AGENTS)[number]): AgentOverride {
  const defaults = DEFAULT_MODELS[agent.role] ?? DEFAULT_MODELS._default;
  return {
    primary_model: defaults.primary,
    secondary_model: defaults.secondary,
    tertiary_model: defaults.tertiary,
    enabled: true,
    temperature: 0.3,
    max_tokens: agent.role === "manager" ? 4096 : 2048,
    custom_instructions: "",
  };
}

// ── Model Selector Component ────────────────────────────────────────

function ModelSelector({
  label,
  sublabel,
  value,
  onChange,
}: {
  readonly label: string;
  readonly sublabel: string;
  readonly value: string;
  readonly onChange: (modelId: string) => void;
}) {
  const selected = ALL_MODELS.find((m) => m.id === value);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-medium text-white">{label}</p>
          <p className="text-[10px] text-white/30">{sublabel}</p>
        </div>
        {selected && (
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", PROVIDER_INFO[selected.provider].color)}>
            {PROVIDER_INFO[selected.provider].label}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {ALL_MODELS.map((model) => (
          <button
            key={model.id}
            onClick={() => onChange(model.id)}
            className={cn(
              "rounded-lg border px-2.5 py-2 text-left transition-all",
              value === model.id
                ? "border-[#6366f1] bg-[#dc2626]/10"
                : "border-white/10 hover:border-white/20 hover:bg-white/[0.04]",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", model.color)} />
              <span className="text-[11px] font-medium text-white truncate">{model.label}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function AgentConfigSection() {
  const [overrides, setOverrides] = useState<AgentOverrides>({});
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    const supabase = createClient();
    const { data } = await supabase
      .from("integrations")
      .select("config")
      .eq("service", "ai-provider")
      .single();

    if (data?.config) {
      const config = data.config as { agent_overrides?: AgentOverrides };
      if (config.agent_overrides) {
        setOverrides(config.agent_overrides);
      }
    }
    setLoading(false);
  }

  function getAgentConfig(agentName: string): AgentOverride {
    const agent = AGENTS.find((a) => a.name === agentName);
    if (!agent) {
      return {
        primary_model: "claude-sonnet-4",
        secondary_model: "claude-haiku-4.5",
        tertiary_model: "gpt-4o-mini",
        enabled: true,
        temperature: 0.3,
        max_tokens: 2048,
        custom_instructions: "",
      };
    }
    return overrides[agentName] ?? getDefaultOverride(agent);
  }

  function updateAgent(agentName: string, updates: Partial<AgentOverride>) {
    const current = getAgentConfig(agentName);
    const updated: AgentOverrides = {
      ...overrides,
      [agentName]: { ...current, ...updates },
    };
    setOverrides(updated);
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    const supabase = createClient();

    const { data: existing } = await supabase
      .from("integrations")
      .select("id, config")
      .eq("service", "ai-provider")
      .single();

    const existingConfig = (existing?.config as Record<string, unknown>) ?? {};
    const newConfig = { ...existingConfig, agent_overrides: overrides };

    if (existing) {
      await supabase
        .from("integrations")
        .update({ config: newConfig })
        .eq("id", existing.id);
    } else {
      await supabase.from("integrations").insert({
        service: "ai-provider",
        is_active: true,
        config: newConfig,
      });
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Agent Configuration</h3>
          <p className="mt-1 text-sm text-white/50">
            Configure AI models (primary, fallback, tertiary), behavior, and custom instructions.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium transition-all",
            saved
              ? "bg-red-500/20 text-red-300"
              : "bg-[#dc2626] text-white hover:bg-[#b91c1c]",
            saving && "opacity-50 cursor-not-allowed",
          )}
        >
          {saving ? "Saving..." : saved ? "Saved" : "Save Changes"}
        </button>
      </div>

      {/* Provider legend */}
      <div className="flex items-center gap-4 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
        <span className="text-xs font-medium text-white/40">Providers:</span>
        {(["claude", "openai", "moonshot"] as const).map((p) => (
          <div key={p} className="flex items-center gap-1.5">
            <span className={cn("flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold", PROVIDER_INFO[p].color)}>
              {PROVIDER_INFO[p].icon}
            </span>
            <span className="text-xs text-white/50">{PROVIDER_INFO[p].label}</span>
          </div>
        ))}
      </div>

      {/* Agent list */}
      <div className="space-y-2">
        {AGENTS.map((agent) => {
          const config = getAgentConfig(agent.name);
          const isExpanded = expandedAgent === agent.name;
          const primaryModel = ALL_MODELS.find((m) => m.id === config.primary_model);
          const secondaryModel = ALL_MODELS.find((m) => m.id === config.secondary_model);
          const tertiaryModel = ALL_MODELS.find((m) => m.id === config.tertiary_model);

          return (
            <div
              key={agent.name}
              className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"
            >
              {/* Collapsed row */}
              <button
                onClick={() => setExpandedAgent(isExpanded ? null : agent.name)}
                className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.04]"
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",
                    config.enabled ? "bg-[#dc2626]" : "bg-white/10",
                  )}
                >
                  {agent.character.split(" ").map((w) => w[0]).join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{agent.character}</p>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", ROLE_COLORS[agent.role] ?? "bg-white/10 text-white/50")}>
                      {agent.specialty}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3">
                    {/* Model chain preview */}
                    <div className="flex items-center gap-1">
                      {[primaryModel, secondaryModel, tertiaryModel].map((m, i) => (
                        m && (
                          <div key={m.id} className="flex items-center gap-1">
                            {i > 0 && <span className="text-white/20 text-[9px]">&rarr;</span>}
                            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", m.color)} />
                            <span className="text-[10px] text-white/40">{m.label}</span>
                          </div>
                        )
                      ))}
                    </div>
                    {!config.enabled && (
                      <span className="text-[10px] text-red-400/60">Disabled</span>
                    )}
                  </div>
                </div>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={cn("shrink-0 text-white/30 transition-transform", isExpanded && "rotate-180")}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {/* Expanded panel */}
              {isExpanded && (
                <div className="border-t border-white/10 px-5 py-5 space-y-6">
                  {/* Enable toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">Enabled</p>
                      <p className="text-xs text-white/40">
                        When disabled, this agent will be skipped during triage.
                      </p>
                    </div>
                    <button
                      onClick={() => updateAgent(agent.name, { enabled: !config.enabled })}
                      className={cn(
                        "relative h-6 w-11 rounded-full transition-colors",
                        config.enabled ? "bg-[#dc2626]" : "bg-white/10",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                          config.enabled ? "left-[22px]" : "left-0.5",
                        )}
                      />
                    </button>
                  </div>

                  {/* Primary model */}
                  <ModelSelector
                    label="Primary Model"
                    sublabel="Used first for this agent"
                    value={config.primary_model}
                    onChange={(id) => updateAgent(agent.name, { primary_model: id })}
                  />

                  {/* Secondary model */}
                  <ModelSelector
                    label="Secondary Model (Fallback)"
                    sublabel="Used if primary fails or is unavailable"
                    value={config.secondary_model}
                    onChange={(id) => updateAgent(agent.name, { secondary_model: id })}
                  />

                  {/* Tertiary model */}
                  <ModelSelector
                    label="Tertiary Model (Last Resort)"
                    sublabel="Used if both primary and secondary fail"
                    value={config.tertiary_model}
                    onChange={(id) => updateAgent(agent.name, { tertiary_model: id })}
                  />

                  {/* Temperature */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-white">Temperature</p>
                      <span className="text-xs font-mono text-white/50">{config.temperature.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={config.temperature}
                      onChange={(e) => updateAgent(agent.name, { temperature: parseFloat(e.target.value) })}
                      className="w-full accent-[#6366f1]"
                    />
                    <div className="flex justify-between text-[10px] text-white/30 mt-1">
                      <span>Precise (0.0)</span>
                      <span>Creative (1.0)</span>
                    </div>
                  </div>

                  {/* Max tokens */}
                  <div>
                    <p className="mb-2 text-sm font-medium text-white">Max Output Tokens</p>
                    <div className="flex gap-2">
                      {[1024, 2048, 4096, 8192].map((val) => (
                        <button
                          key={val}
                          onClick={() => updateAgent(agent.name, { max_tokens: val })}
                          className={cn(
                            "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                            config.max_tokens === val
                              ? "border-[#6366f1] bg-[#dc2626]/10 text-white"
                              : "border-white/10 text-white/50 hover:border-white/20",
                          )}
                        >
                          {val.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom instructions */}
                  <div>
                    <p className="mb-2 text-sm font-medium text-white">Custom Instructions</p>
                    <textarea
                      value={config.custom_instructions}
                      onChange={(e) => updateAgent(agent.name, { custom_instructions: e.target.value })}
                      placeholder={`Additional instructions for ${agent.character}...`}
                      rows={3}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-[#6366f1]"
                    />
                    <p className="mt-1 text-[10px] text-white/30">
                      These instructions are appended to the agent&apos;s system prompt during triage.
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
