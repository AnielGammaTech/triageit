/** Signature screen: single-item QR Buy page (default view, unchanged). */
export function BuyView() {
  return (
    <div className="flex w-full max-w-[220px] flex-col gap-2">
      <div className="flex h-16 items-center justify-center rounded-2xl" style={{ background: "var(--mock-panel)" }}>
        <span className="text-[18px]">🥤</span>
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-bold text-white">Sparkling Water — Lime</span>
        <span className="text-[16px] font-extrabold" style={{ color: "#10b981" }}>$2.50</span>
      </div>

      <div className="flex items-center justify-center gap-3 rounded-full px-3 py-1" style={{ background: "var(--mock-panel-2)" }}>
        <span className="text-[9px] text-white">−</span>
        <span className="text-[8px] font-medium text-white">1</span>
        <span className="text-[9px] text-white">+</span>
      </div>

      <div className="flex flex-col gap-1 rounded-xl p-2 text-[7px]" style={{ background: "var(--mock-panel)" }}>
        <div className="flex justify-between text-[color:var(--mock-muted)]">
          <span>Items (1)</span>
          <span>$2.50</span>
        </div>
        <div className="flex justify-between text-[color:var(--mock-muted)]">
          <span>Card processing fee</span>
          <span>$0.18</span>
        </div>
        <div className="mt-1 flex justify-between border-t pt-1 font-semibold text-white" style={{ borderColor: "var(--mock-border)" }}>
          <span>Total</span>
          <span>$2.68</span>
        </div>
      </div>

      <span className="w-full rounded-full py-1.5 text-center text-[8px] font-bold text-black" style={{ background: "#10b981" }}>
        Pay $2.68
      </span>

      <span className="text-center text-[6px] text-[color:var(--mock-muted)]">
        Secure payment by Stripe · Apple Pay &amp; Google Pay supported
      </span>
    </div>
  );
}
