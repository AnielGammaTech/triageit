const ACCOUNTS = [
  { name: "Dunder Mifflin", mrr: "$1,850", contacts: 4, health: "Healthy", tone: "#059669" },
  { name: "Vance Refrigeration", mrr: "$980", contacts: 2, health: "At Risk", tone: "#dc2626" },
  { name: "Schrute Farms", mrr: "$640", contacts: 1, health: "Healthy", tone: "#059669" },
  { name: "Michael Scott Paper Co.", mrr: "$1,200", contacts: 3, health: "Healthy", tone: "#059669" },
] as const;

const CARD = { borderColor: "var(--mock-border)", background: "var(--mock-panel)" };

/** "Accounts" nav view — full account roster. */
export function AccountsView() {
  return (
    <div className="flex flex-col gap-1.5 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold">Accounts</span>
        <span className="text-[6.5px] text-[color:var(--mock-muted)]">42 total</span>
      </div>
      <div className="rounded-xl border" style={CARD}>
        {ACCOUNTS.map((a, i) => (
          <div
            key={a.name}
            className={`flex items-center gap-2 px-2 py-1.5 text-[7.5px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-border)" }}
          >
            <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
            <span className="w-11 shrink-0 text-right text-[color:var(--mock-muted)]">{a.mrr}/mo</span>
            <span className="w-10 shrink-0 text-right text-[color:var(--mock-muted)]">{a.contacts} ctc</span>
            <span
              className="w-14 shrink-0 rounded-full px-1 py-0.5 text-center text-[6px] font-medium"
              style={{ background: a.tone === "#dc2626" ? "#fef2f2" : "#ecfdf5", color: a.tone }}
            >
              {a.health}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
