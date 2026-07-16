const QUOTES = [
  { id: "Q-2047", customer: "WUPHF.com", total: "$8,450", status: "Sent", tone: "#1d4ed8", bg: "#eff6ff" },
  { id: "Q-2039", customer: "Dunder Mifflin", total: "$3,200", status: "Accepted", tone: "#047857", bg: "#ecfdf5" },
  { id: "Q-2031", customer: "Athlead", total: "$14,900", status: "Viewed", tone: "#b45309", bg: "#fffbeb" },
  { id: "Q-2018", customer: "Vance Refrigeration", total: "$2,150", status: "Declined", tone: "#b91c1c", bg: "#fef2f2" },
] as const;

/** "Quotes" nav view — every quote and its real status pill. */
export function QuotesView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold">Quotes</span>
        <span className="text-[7px]" style={{ color: "var(--mock-muted)" }}>4 of 31</span>
      </div>
      <div className="rounded-lg border" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        {QUOTES.map((q, i) => (
          <div
            key={q.id}
            className={`flex items-center gap-2 px-2 py-1.5 text-[8px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-panel-2)" }}
          >
            <span className="w-11 shrink-0 font-mono text-[color:var(--mock-muted)]">{q.id}</span>
            <span className="min-w-0 flex-1 truncate">{q.customer}</span>
            <span className="w-12 shrink-0 text-right font-medium">{q.total}</span>
            <span
              className="w-16 shrink-0 rounded-full px-1 py-0.5 text-center text-[6.5px] font-medium"
              style={{ background: q.bg, color: q.tone }}
            >
              {q.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
