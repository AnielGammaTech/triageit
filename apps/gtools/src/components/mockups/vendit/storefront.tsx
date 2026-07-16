const PRODUCTS = [
  { name: "Sparkling Water — Lime", price: "$2.50", emoji: "🥤" },
  { name: "Trail Mix, 2oz", price: "$1.75", emoji: "🥜" },
  { name: "Cold Brew Coffee", price: "$3.25", emoji: "🧋" },
] as const;

/** Multi-item storefront with cart, reached from a machine's shared QR
 * code rather than a single product's. */
export function StorefrontView() {
  return (
    <div className="flex w-full max-w-[220px] flex-col gap-2">
      <span className="text-[9px] font-bold text-white">Break Room Vending</span>
      <div className="flex flex-col gap-1.5">
        {PRODUCTS.map((p) => (
          <div key={p.name} className="flex items-center gap-2 rounded-xl p-1.5" style={{ background: "var(--mock-panel)" }}>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-lg text-[10px]" style={{ background: "var(--mock-panel-2)" }}>
              {p.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[7.5px] font-medium text-white">{p.name}</span>
              <span className="block text-[8px] font-bold" style={{ color: "#10b981" }}>{p.price}</span>
            </div>
            <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[7px] font-semibold text-black" style={{ background: "#10b981" }}>
              Add
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-xl p-2 text-[7px]" style={{ background: "var(--mock-panel)" }}>
        <span className="text-[color:var(--mock-muted)]">Cart (2 items)</span>
        <span className="font-semibold text-white">$4.25</span>
      </div>
      <span className="w-full rounded-full py-1.5 text-center text-[8px] font-bold text-black" style={{ background: "#10b981" }}>
        Checkout
      </span>
    </div>
  );
}
