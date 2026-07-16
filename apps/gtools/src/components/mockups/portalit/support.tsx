const TICKETS = [
  { id: "#118", subject: "Slow VPN connection from home office", status: "Open", tone: "#b45309" },
  { id: "#112", subject: "New user setup — accounting dept.", status: "In Progress", tone: "#2563eb" },
] as const;

/** "Support" nav view — the client's own open ticket list. */
export function SupportView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold">Support</span>
        <span className="rounded-full px-1.5 py-1 text-center text-[6.5px] font-medium text-white" style={{ background: "#5b21b6" }}>
          + New ticket
        </span>
      </div>
      <div className="rounded-xl border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        {TICKETS.map((t, i) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 py-1 text-[7.5px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-panel-2)" }}
          >
            <span className="shrink-0" style={{ color: "var(--mock-muted)" }}>{t.id}</span>
            <span className="min-w-0 flex-1 truncate">{t.subject}</span>
            <span
              className="shrink-0 rounded-full px-1 py-0.5 text-[6px] font-medium"
              style={{ background: "var(--mock-panel-2)", color: t.tone }}
            >
              {t.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
