const IMPACT = [
  { label: "Accessed", value: "3 emails", color: "#2563eb", bg: "#eff6ff" },
  { label: "Sent", value: "1 email", color: "#b45309", bg: "#fffbeb" },
  { label: "Modified", value: "2 documents", color: "#7c3aed", bg: "#f5f3ff" },
  { label: "Deleted", value: "0 items", color: "#dc2626", bg: "#fef2f2" },
] as const;

const STEPS = [
  { label: "Revoke active sessions", status: "Done", tone: "#059669", bg: "#ecfdf5" },
  { label: "Disable compromised account", status: "Required", tone: "#dc2626", bg: "#fef2f2" },
  { label: "Remove inbox forwarding rule", status: "Review", tone: "#b45309", bg: "#fffbeb" },
] as const;

/** Signature screen: Incident Detail (default view). */
export function IncidentDetailView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[7px] text-[color:var(--mock-muted)]">Michael Scott Paper Co. / Incidents</span>
          <span className="text-[10px] font-semibold">Impossible travel — token replay</span>
        </div>
        <span className="rounded-none border px-1.5 py-0.5 text-[8px] font-medium" style={{ borderColor: "#dc2626", color: "#dc2626", background: "#fef2f2" }}>
          Open
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-none border px-1.5 py-0.5 text-[7px] font-medium" style={{ borderColor: "#fecaca", color: "#dc2626", background: "#fef2f2" }}>
          Dwell Time: 2h 14m
        </span>
        <span className="rounded-none border px-1.5 py-0.5 text-[7px] font-medium" style={{ borderColor: "#fed7aa", color: "#c2410c", background: "#fff7ed" }}>
          Active Attacker
        </span>
        <span className="rounded-none border px-1.5 py-0.5 text-[7px] font-medium" style={{ borderColor: "#e2e8f0", color: "#475569" }}>
          Token Replay
        </span>
      </div>

      <div className="rounded-none border p-1.5 text-[7px]" style={{ borderColor: "#fde68a", background: "#fffbeb", color: "#92400e" }}>
        AI review: investigate — high-confidence match to known ATO pattern.
      </div>

      <div className="border p-2" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        <span className="mb-1.5 block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">
          Remediation actions
        </span>
        <div className="flex flex-col gap-1">
          {STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center gap-1.5">
              <span className="flex size-3 shrink-0 items-center justify-center rounded-full border text-[6px]" style={{ borderColor: "var(--mock-border)" }}>
                {i + 1}
              </span>
              <span className="flex-1 truncate text-[8px]">{step.label}</span>
              <span className="rounded-none px-1 py-0.5 text-[7px] font-medium" style={{ color: step.tone, background: step.bg }}>
                {step.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {IMPACT.map((tile) => (
          <div key={tile.label} className="border p-1.5" style={{ borderColor: "var(--mock-border)", background: tile.bg }}>
            <span className="block text-[7px] font-medium" style={{ color: tile.color }}>
              {tile.label}
            </span>
            <span className="block text-[8px] font-semibold">{tile.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
