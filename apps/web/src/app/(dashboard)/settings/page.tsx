import { createClient } from "@/lib/supabase/server";
import { TriageRulesList } from "@/components/settings/triage-rules-list";

export default async function SettingsPage() {
  const supabase = await createClient();

  const { data: rules } = await supabase
    .from("triage_rules")
    .select("*")
    .order("priority", { ascending: true });

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Settings</h2>

      {/* Triage Rules */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Triage Rules</h3>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          Rules that govern how tickets are classified, routed, and escalated.
          Rules are evaluated in priority order (lowest number = highest priority).
        </p>
        <TriageRulesList rules={rules ?? []} />
      </div>

      {/* Re-Triage Configuration */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <h3 className="text-lg font-semibold mb-3">Daily Re-Triage</h3>
        <div className="space-y-3 text-sm text-[var(--muted-foreground)]">
          <div className="flex items-center justify-between">
            <span>Schedule</span>
            <span className="font-mono text-[var(--foreground)]">Daily at 6:00 AM</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Open ticket statuses</span>
            <span className="text-[var(--foreground)]">New, Scheduled, In Progress, Waiting on Customer, Customer Reply, Waiting on Tech, Waiting on Parts, Needs Quote</span>
          </div>
          <div className="flex items-center justify-between">
            <span>WOT alert threshold</span>
            <span className="font-mono text-red-400">24 hours</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Customer Reply alert threshold</span>
            <span className="font-mono text-red-400">24 hours (immediate Teams alert)</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Summary delivery</span>
            <span className="text-[var(--foreground)]">Microsoft Teams</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Mode</span>
            <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">Recommend only</span>
          </div>
        </div>
      </div>
    </div>
  );
}
