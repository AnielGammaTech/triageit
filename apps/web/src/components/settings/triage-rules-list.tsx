"use client";

import { cn } from "@/lib/utils/cn";

interface TriageRule {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly rule_type?: string;
  readonly conditions: Record<string, unknown>;
  readonly actions: Record<string, unknown>;
  readonly priority: number;
  readonly is_active: boolean;
}

interface TriageRulesListProps {
  readonly rules: ReadonlyArray<TriageRule>;
}

const RULE_TYPE_STYLES: Record<string, string> = {
  classification: "bg-blue-500/20 text-blue-400",
  routing: "bg-purple-500/20 text-purple-400",
  notification: "bg-cyan-500/20 text-cyan-400",
  sla: "bg-orange-500/20 text-orange-400",
  escalation: "bg-red-500/20 text-red-400",
};

export function TriageRulesList({ rules }: TriageRulesListProps) {
  if (rules.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 text-center">
        <p className="text-[var(--muted-foreground)]">
          No triage rules configured. Run the migration to seed default rules.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rules.map((rule) => {
        const ruleType = rule.rule_type ?? "classification";
        const typeStyle =
          RULE_TYPE_STYLES[ruleType] ?? "bg-gray-500/20 text-gray-400";

        return (
          <div
            key={rule.id}
            className={cn(
              "rounded-lg border bg-[var(--card)] p-4 transition-opacity",
              rule.is_active
                ? "border-[var(--border)]"
                : "border-[var(--border)] opacity-50",
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold">{rule.name}</h4>
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                      typeStyle,
                    )}
                  >
                    {ruleType}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    Priority: {rule.priority}
                  </span>
                </div>
                {rule.description && (
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {rule.description}
                  </p>
                )}
                <div className="mt-2 flex gap-4">
                  <div>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      Conditions:{" "}
                    </span>
                    <code className="text-xs text-amber-300">
                      {JSON.stringify(rule.conditions)}
                    </code>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      Actions:{" "}
                    </span>
                    <code className="text-xs text-green-300">
                      {JSON.stringify(rule.actions)}
                    </code>
                  </div>
                </div>
              </div>
              <div
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  rule.is_active
                    ? "bg-green-500/20 text-green-400"
                    : "bg-gray-500/20 text-gray-400",
                )}
              >
                {rule.is_active ? "Active" : "Disabled"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
