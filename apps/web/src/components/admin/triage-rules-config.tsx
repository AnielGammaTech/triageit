"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils/cn";

// ── Types ─────────────────────────────────────────────────────────────

interface TriageRule {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly rule_type: string;
  readonly conditions: Record<string, unknown>;
  readonly actions: Record<string, unknown>;
  readonly priority: number;
  readonly is_active: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

const RULE_TYPES = [
  { value: "classification", label: "Classification", color: "bg-blue-500/20 text-blue-400" },
  { value: "routing", label: "Routing", color: "bg-emerald-500/20 text-emerald-400" },
  { value: "notification", label: "Notification", color: "bg-pink-500/20 text-pink-400" },
  { value: "sla", label: "SLA", color: "bg-amber-500/20 text-amber-400" },
  { value: "escalation", label: "Escalation", color: "bg-red-500/20 text-red-400" },
] as const;

function getRuleTypeStyle(ruleType: string): string {
  const found = RULE_TYPES.find((t) => t.value === ruleType);
  return found?.color ?? "bg-white/10 text-white/50";
}

function getRuleTypeLabel(ruleType: string): string {
  const found = RULE_TYPES.find((t) => t.value === ruleType);
  return found?.label ?? ruleType;
}

// ── Editable Rule Form ────────────────────────────────────────────────

function RuleEditor({
  rule,
  onSave,
  onCancel,
}: {
  readonly rule: Partial<TriageRule> | null;
  readonly onSave: (data: {
    name: string;
    description: string;
    rule_type: string;
    conditions: Record<string, unknown>;
    actions: Record<string, unknown>;
    priority: number;
    is_active: boolean;
  }) => void;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [ruleType, setRuleType] = useState(rule?.rule_type ?? "classification");
  const [conditionsJson, setConditionsJson] = useState(
    JSON.stringify(rule?.conditions ?? {}, null, 2),
  );
  const [actionsJson, setActionsJson] = useState(
    JSON.stringify(rule?.actions ?? {}, null, 2),
  );
  const [priority, setPriority] = useState(rule?.priority ?? 1);
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [jsonError, setJsonError] = useState<string | null>(null);

  function handleSave() {
    try {
      const conditions = JSON.parse(conditionsJson) as Record<string, unknown>;
      const actions = JSON.parse(actionsJson) as Record<string, unknown>;
      setJsonError(null);
      onSave({ name, description, rule_type: ruleType, conditions, actions, priority, is_active: isActive });
    } catch (err) {
      setJsonError(`Invalid JSON: ${(err as Error).message}`);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">
          {rule?.id ? "Edit Rule" : "New Rule"}
        </h4>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="rounded-lg bg-[#6366f1] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#5558e6] disabled:opacity-50"
          >
            {rule?.id ? "Update" : "Create"}
          </button>
        </div>
      </div>

      {jsonError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {jsonError}
        </div>
      )}

      {/* Name */}
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#6366f1]"
          placeholder="Rule name"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#6366f1]"
          placeholder="What does this rule do?"
        />
      </div>

      {/* Rule Type & Priority row */}
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-white/50">Type</label>
          <div className="flex flex-wrap gap-1.5">
            {RULE_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setRuleType(t.value)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                  ruleType === t.value
                    ? "border-[#6366f1] bg-[#6366f1]/10 text-white"
                    : "border-white/10 text-white/50 hover:border-white/20",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="w-24">
          <label className="mb-1 block text-xs font-medium text-white/50">Priority</label>
          <input
            type="number"
            min={1}
            max={10}
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value, 10) || 1)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#6366f1]"
          />
        </div>
      </div>

      {/* Active toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-white">Active</p>
          <p className="text-[10px] text-white/30">Inactive rules are ignored during triage.</p>
        </div>
        <button
          onClick={() => setIsActive(!isActive)}
          className={cn(
            "relative h-6 w-11 rounded-full transition-colors",
            isActive ? "bg-[#6366f1]" : "bg-white/10",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
              isActive ? "left-[22px]" : "left-0.5",
            )}
          />
        </button>
      </div>

      {/* Conditions JSON */}
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Conditions (JSON)</label>
        <textarea
          value={conditionsJson}
          onChange={(e) => setConditionsJson(e.target.value)}
          rows={4}
          spellCheck={false}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white placeholder-white/30 outline-none focus:border-[#6366f1]"
        />
      </div>

      {/* Actions JSON */}
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Actions (JSON)</label>
        <textarea
          value={actionsJson}
          onChange={(e) => setActionsJson(e.target.value)}
          rows={4}
          spellCheck={false}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white placeholder-white/30 outline-none focus:border-[#6366f1]"
        />
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────

export function TriageRulesSection() {
  const [rules, setRules] = useState<ReadonlyArray<TriageRule>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<Partial<TriageRule> | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadRules();
  }, []);

  async function loadRules() {
    try {
      const res = await fetch("/api/triage-rules");
      if (!res.ok) throw new Error(`Failed to load rules: ${res.status}`);
      const data = (await res.json()) as { rules: TriageRule[] };
      setRules(data.rules);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  async function handleSave(data: {
    name: string;
    description: string;
    rule_type: string;
    conditions: Record<string, unknown>;
    actions: Record<string, unknown>;
    priority: number;
    is_active: boolean;
  }) {
    try {
      if (editingRule?.id) {
        // Update
        const res = await fetch(`/api/triage-rules?id=${editingRule.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to update rule");
      } else {
        // Create
        const res = await fetch("/api/triage-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to create rule");
      }
      setEditingRule(null);
      setIsCreating(false);
      await loadRules();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/triage-rules?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete rule");
      await loadRules();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleToggle(rule: TriageRule) {
    try {
      const res = await fetch(`/api/triage-rules?id=${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !rule.is_active }),
      });
      if (!res.ok) throw new Error("Failed to toggle rule");
      await loadRules();
    } catch (err) {
      setError((err as Error).message);
    }
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
          <h3 className="text-lg font-semibold text-white">Triage Rules</h3>
          <p className="mt-1 text-sm text-white/50">
            Configure classification, routing, notification, SLA, and escalation rules.
          </p>
        </div>
        <button
          onClick={() => {
            setIsCreating(true);
            setEditingRule({});
          }}
          className="rounded-lg bg-[#6366f1] px-4 py-2 text-sm font-medium text-white hover:bg-[#5558e6]"
        >
          + Add Rule
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-xs opacity-60 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* Create / Edit form */}
      {(isCreating || editingRule?.id) && (
        <RuleEditor
          rule={editingRule}
          onSave={handleSave}
          onCancel={() => {
            setEditingRule(null);
            setIsCreating(false);
          }}
        />
      )}

      {/* Rule type legend */}
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
        <span className="text-xs font-medium text-white/40">Types:</span>
        {RULE_TYPES.map((t) => (
          <span key={t.value} className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", t.color)}>
            {t.label}
          </span>
        ))}
      </div>

      {/* Rules list */}
      {rules.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <p className="text-sm text-white/50">No triage rules configured yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => {
            const isExpanded = expandedId === rule.id;

            return (
              <div
                key={rule.id}
                className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"
              >
                {/* Row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.04]"
                >
                  {/* Active indicator */}
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      rule.is_active ? "bg-emerald-400" : "bg-white/20",
                    )}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn("text-sm font-medium", rule.is_active ? "text-white" : "text-white/40")}>
                        {rule.name}
                      </p>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", getRuleTypeStyle(rule.rule_type))}>
                        {getRuleTypeLabel(rule.rule_type)}
                      </span>
                      <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/30">
                        P{rule.priority}
                      </span>
                    </div>
                    {rule.description && (
                      <p className="mt-0.5 truncate text-xs text-white/40">{rule.description}</p>
                    )}
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

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-white/10 px-5 py-4 space-y-4">
                    {/* Conditions */}
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">Conditions</p>
                      <pre className="rounded-lg bg-white/5 p-3 text-xs text-white/70 overflow-x-auto">
                        {JSON.stringify(rule.conditions, null, 2)}
                      </pre>
                    </div>

                    {/* Actions */}
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">Actions</p>
                      <pre className="rounded-lg bg-white/5 p-3 text-xs text-white/70 overflow-x-auto">
                        {JSON.stringify(rule.actions, null, 2)}
                      </pre>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggle(rule);
                        }}
                        className={cn(
                          "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                          rule.is_active
                            ? "border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                            : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10",
                        )}
                      >
                        {rule.is_active ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingRule(rule);
                          setIsCreating(false);
                          setExpandedId(null);
                        }}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 hover:bg-white/5"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete rule "${rule.name}"?`)) {
                            handleDelete(rule.id);
                          }
                        }}
                        className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
