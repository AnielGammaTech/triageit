const STATS = [
  { label: "Today", value: "$48.20" },
  { label: "7-day", value: "$312.75" },
  { label: "All-time", value: "$4,180.50" },
] as const;

const STOCK = [
  { name: "Sparkling Water — Lime", qty: 2, status: "Low", tone: "#b45309", bg: "#fffbeb" },
  { name: "Trail Mix, 2oz", qty: 0, status: "Out", tone: "#dc2626", bg: "#fef2f2" },
  { name: "Cold Brew Coffee", qty: 14, status: "OK", tone: "#059669", bg: "#ecfdf5" },
] as const;

const BOTTOM_TABS = ["Sell", "Stock", "Products", "Sales", "Labels", "Settings"] as const;

/** "Admin" view — the light-themed companion POS/inventory dashboard
 * (a genuinely different themed surface of the real app, per its UI spec). */
export function AdminView() {
  return (
    <div className="flex w-full flex-col gap-2 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between rounded-lg border px-2 py-1" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        <span className="text-[8px] font-bold">
          VendIT <span style={{ color: "#10b981" }}>POS</span>
        </span>
        <span className="text-[6.5px] text-[color:var(--mock-muted)]">Break Room #1</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-lg border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
            <span className="block text-[6px] font-medium text-[color:var(--mock-muted)]">{s.label}</span>
            <span className="block text-[8.5px] font-semibold">{s.value}</span>
          </div>
        ))}
      </div>
      <div className="rounded-lg border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        <span className="mb-1 block text-[6.5px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">Stock</span>
        {STOCK.map((s, i) => (
          <div key={s.name} className={`flex items-center gap-2 py-1 text-[7px] ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "var(--mock-border)" }}>
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="shrink-0 text-[color:var(--mock-muted)]">{s.qty}</span>
            <span className="shrink-0 rounded-full px-1 py-0.5 text-[6px] font-medium" style={{ background: s.bg, color: s.tone }}>
              {s.status}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-around rounded-lg border py-1" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        {BOTTOM_TABS.map((t, i) => (
          <span key={t} className="text-[6px] font-medium" style={{ color: i === 0 ? "#10b981" : "var(--mock-muted)" }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
