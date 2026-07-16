const TICKETS = [
  { id: "#4821", subject: "VPN down for remote staff", client: "Dunder Mifflin", priority: "P2", color: "#f97316", status: "Escalation" },
  { id: "#4816", subject: "Phishing report — invoice email", client: "Schrute Farms", priority: "P1", color: "#ef4444", status: "Security" },
  { id: "#4809", subject: "Printer offline, branch office", client: "Vance Refrigeration", priority: "P4", color: "#10b981", status: "Assigned" },
  { id: "#4802", subject: "New hire onboarding — laptop", client: "WUPHF.com", priority: "P5", color: "#9ca3af", status: "Scheduled" },
] as const;

/** "Dispatch" nav view — Bryanna's open-ticket queue. */
export function TicketsListView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="font-display text-[11px] font-semibold">Dispatch Queue</span>
        <span className="text-[8px] text-[color:var(--mock-muted)]">4 of 37 · Gamma Default</span>
      </div>
      <div className="rounded-lg border" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        {TICKETS.map((t, i) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 px-2 py-1.5 text-[8px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-border)" }}
          >
            <span className="w-8 shrink-0 font-mono text-[color:var(--mock-muted)]">{t.id}</span>
            <span className="min-w-0 flex-1 truncate">{t.subject}</span>
            <span className="w-24 shrink-0 truncate text-[color:var(--mock-muted)]">{t.client}</span>
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 text-[7px] font-medium text-white"
              style={{ background: t.color }}
            >
              {t.priority}
            </span>
            <span className="w-16 shrink-0 truncate text-right text-[color:var(--mock-muted)]">{t.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
