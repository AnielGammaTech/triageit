const STOCK = [
  { name: "Managed switch, 24-port PoE", qty: 6, status: "In Stock", tone: "#10b981" },
  { name: "Firewall appliance — 60F", qty: 1, status: "Low", tone: "#f59e0b" },
  { name: "Cat6 cable spool (1000ft)", qty: 0, status: "Out of Stock", tone: "#dc2626" },
  { name: "Wireless AP, indoor", qty: 12, status: "In Stock", tone: "#10b981" },
] as const;

/** "Stock" nav view — IT asset inventory levels. */
export function StockView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold">Stock</span>
        <span className="text-[7px] text-[color:var(--mock-muted)]">4 SKUs tracked</span>
      </div>
      <div className="rounded-lg border bg-[color:var(--mock-panel)]" style={{ borderColor: "var(--mock-border)" }}>
        {STOCK.map((item, i) => (
          <div
            key={item.name}
            className={`flex items-center gap-2 px-2 py-1.5 text-[8px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-border)" }}
          >
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            <span className="w-6 shrink-0 text-right font-medium text-[color:var(--mock-muted)]">{item.qty}</span>
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 text-[6.5px] font-medium text-white"
              style={{ background: item.tone }}
            >
              {item.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
