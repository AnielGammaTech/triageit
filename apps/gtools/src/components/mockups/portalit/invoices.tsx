const INVOICES = [
  { id: "INV-2291", date: "Jul 1", amount: "$2,140.00", status: "Paid", tone: "#059669" },
  { id: "INV-2247", date: "Jun 1", amount: "$2,140.00", status: "Paid", tone: "#059669" },
  { id: "INV-2198", date: "May 1", amount: "$1,985.00", status: "Reconciled", tone: "#2563eb" },
  { id: "INV-2150", date: "Apr 1", amount: "$1,985.00", status: "Paid", tone: "#059669" },
] as const;

/** "Invoices" nav view — full billing history, reconciled against usage. */
export function InvoicesView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold">Invoices</span>
        <span className="text-[6.5px]" style={{ color: "var(--mock-muted)" }}>Reconciled against live usage</span>
      </div>
      <div className="rounded-xl border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        {INVOICES.map((inv, i) => (
          <div
            key={inv.id}
            className={`flex items-center justify-between py-1 text-[7.5px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-panel-2)" }}
          >
            <span>
              {inv.id} <span style={{ color: "var(--mock-muted)" }}>· {inv.date}</span>
            </span>
            <span className="flex items-center gap-1">
              <b>{inv.amount}</b>
              <span className="rounded-full border px-1 py-0.5 text-[6px]" style={{ borderColor: inv.tone, color: inv.tone }}>
                {inv.status}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
